/**
 * The examples in examples/ run end to end against a stub upstream: only blind
 * text crosses the boundary, real values come back, a leak stops the request
 * before anything is forwarded, and proxy mode returns a receipt the caller can
 * verify. No network: every upstream is an in-process function.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  exportReceiptKeys, generateReceiptKeys, importReceiptPublicKey, verifyReceipt, type KnownValue, type Mapping, type ReceiptJwk,
} from '../src/index.js';
import { makeHandler } from '../examples/deno.js';
import { createLambdaHandler, handler as lambdaEntry } from '../examples/lambda.js';
import { bearerToken, createBlindHandler, forwardJson, type BlindResponseBody, type Forward } from '../examples/shared/handler.js';
import workers from '../examples/workers.js';
import { FAKES } from '../src/names.js';

const REAL = 'From: Ana Ruiz <ana@gestoria.example>\nHola, soy Ana. Pagamos 247,80 € el 23 de marzo de 2026. DNI 12345678Z.';
// A two-digit day with its year: in random mode the date fake is any date within a year either side, and
// '3 de marzo' sat inside '13 de marzo de 2026' and '3 de marzo de 2025', so the check failed by chance.
const SECRETS = ['Ana', 'Ruiz', 'gestoria', '247,80', '23 de marzo de 2026', '12345678Z'];

/** An upstream that records what it saw and answers by quoting it back. */
function echo(): { forward: Forward; seen: string[][] } {
  const seen: string[][] = [];
  return { seen, forward: async (sent) => (seen.push(sent), `Resumen: ${sent[0] as string}`) };
}

/** The caller credential every test handler and adapter is set up with. */
const TOKEN = 'caller-token-for-tests';
const AUTH = bearerToken(TOKEN);
const bearer = { authorization: `Bearer ${TOKEN}` };

const post = (body: unknown, url = 'https://blind.example/', headers: Record<string, string> = bearer): Request =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('examples: the shared handler', () => {
  it('C24: only blind text reaches the upstream and the answer comes back with real values', async () => {
    const up = echo();
    const res = await createBlindHandler({ authenticate: AUTH, forward: up.forward })(post({ texts: [REAL] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as BlindResponseBody;
    for (const s of SECRETS) expect(up.seen[0]![0], s).not.toContain(s);
    expect(body.sent).toEqual(up.seen[0]);
    expect(body.answer).toBe(`Resumen: ${REAL}`);
    expect(body.invented).toEqual([]);
    expect(body.mapping).toBeUndefined();
    expect(body.receipt).toBeUndefined();
  });

  it('C24: a leak stops the request with kinds and offsets only, and nothing is forwarded', async () => {
    const up = echo();
    // "rosa" is also an ordinary word here, so the bare first name is not carried; the leak check still knows it.
    const text = 'From: Rosa Paz <rosa@x.example>\n\nHola Rosa, la pintura rosa ya llegó.';
    const res = await createBlindHandler({ authenticate: AUTH, forward: up.forward })(post({ texts: [text] }));
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw).not.toMatch(/rosa|paz/i);
    const report = JSON.parse(raw) as { error: string; hits: Array<{ kind: string; textIndex: number; offset: number }> };
    expect(report.error).toBe('leak');
    expect(report.hits.length).toBeGreaterThan(0);
    for (const h of report.hits) expect(Object.keys(h).sort()).toEqual(['kind', 'offset', 'textIndex']);
    expect(up.seen).toEqual([]);
  });

  it('C3/C24: the response names a known entry with a stop-word part by its index in the request and its kind, never its value', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward, known: [{ kind: 'person', value: 'Al' }] });
    const res = await h(post({ texts: ['Al Brenner vino. Hablé con al ayer.'], known: [{ kind: 'person', value: 'Li Na' }, { kind: 'person', value: 'Al Brenner' }] }));
    expect(res.status).toBe(200);
    // The answer carries the real values back by design; the list beside it never does.
    const body = (await res.json()) as { unenforced: unknown; sent: string[] };
    expect(JSON.stringify(body.unenforced)).not.toMatch(/Brenner|\bAl\b|\bLi\b|\bNa\b/);
    expect(body.sent[0]).not.toContain('Brenner');
    expect(body.unenforced).toEqual([{ kind: 'person', index: 1, reason: 'stop-word-part' }]);
    const leak = await createBlindHandler({ authenticate: AUTH, forward: up.forward, deny: ['Proyecto Halcón'] })(post({ texts: ['Al vino. Proyecto Halcón.'], known: [{ kind: 'person', value: 'Al' }] }));
    expect(leak.status).toBe(422);
    expect(await leak.json()).toMatchObject({ error: 'leak', unenforced: [{ kind: 'person', index: 0, reason: 'stop-word' }] });
  });

  it('C24: operator deny lists apply to every request', async () => {
    const up = echo();
    const res = await createBlindHandler({ authenticate: AUTH, forward: up.forward, deny: ['Proyecto Halcón'] })(post({ texts: ['Sobre el Proyecto Halcón, nada nuevo.'] }));
    expect(res.status).toBe(422);
    expect(up.seen).toEqual([]);
  });

  it('C24: rejects bad bodies and methods, and hides upstream errors', async () => {
    const h = createBlindHandler({ authenticate: AUTH, forward: async () => { throw new Error(`upstream said ${REAL}`); } });
    expect((await h(new Request('https://b.example/', { method: 'GET', headers: bearer }))).status).toBe(405);
    expect((await h(new Request('https://b.example/', { method: 'POST', headers: bearer, body: 'not json' }))).status).toBe(400);
    for (const bad of [{}, { texts: [] }, { texts: [1] }, { texts: ['a'], known: 'x' }, { texts: ['a'], deny: [1] }, null]) {
      expect((await h(post(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    const res = await h(post({ texts: [REAL] }));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('Ana');
  });

  it('C24: carries a conversation when the caller sends the mapping back', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward });
    const first = (await (await h(post({ texts: [REAL], returnMapping: true }))).json()) as BlindResponseBody;
    expect(first.mapping).toBeDefined();
    const second = (await (await h(post({ texts: ['¿Ana ya pagó?'], mapping: first.mapping as Mapping, returnMapping: true }))).json()) as BlindResponseBody;
    expect(up.seen[1]![0]).not.toContain('Ana');
    expect(second.answer).toBe('Resumen: ¿Ana ya pagó?');
  });

  it('C24: refuses a caller mapping that would switch scaling or shifting off, without echoing it', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward });
    const first = (await (await h(post({ texts: [REAL], returnMapping: true }))).json()) as BlindResponseBody;
    const m = first.mapping as Mapping;
    for (const bad of [{ ...m, factor: 1, pairs: [] }, { ...m, dayShift: 0 }, { ...m, pairs: [{ kind: 'person', real: 'Ana', fake: 'Ana' }] }]) {
      const res = await h(post({ texts: ['Pagamos 250,00 € el 3 de marzo de 2026, Ana.'], mapping: bad }));
      expect(res.status).toBe(400);
      expect(await res.text()).not.toMatch(/Ana|250/);
    }
    expect(up.seen.length).toBe(1);
  });

  it('C29: the handler takes replaceWith, keeps the mode of the mapping on the next turn, and refuses a request that asks for another', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward });
    const first = (await (await h(post({ texts: [REAL], replaceWith: 'placeholder', returnMapping: true }))).json()) as BlindResponseBody;
    expect(up.seen[0]![0]).toContain('From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>');
    for (const s of SECRETS) expect(up.seen[0]![0], s).not.toContain(s);
    expect(first.answer).toBe(`Resumen: ${REAL}`);
    const second = (await (await h(post({ texts: ['¿Ana Ruiz ya pagó?'], mapping: first.mapping as Mapping, returnMapping: true }))).json()) as BlindResponseBody;
    expect(up.seen[1]![0]).toBe('¿[REDACTED_PERSON_1] ya pagó?');
    expect(second.mapping?.replaceWith).toBe('placeholder');
    const conflict = await h(post({ texts: ['x'], mapping: first.mapping as Mapping, replaceWith: 'random' }));
    expect(conflict.status).toBe(400);
    expect(await conflict.text()).toContain('replaceWith');
    expect((await h(post({ texts: ['x'], replaceWith: 'mask' }))).status).toBe(400);
    expect(up.seen.length).toBe(2);
    // The operator's default applies to a new conversation only.
    const op = echo();
    await createBlindHandler({ authenticate: AUTH, forward: op.forward, replaceWith: 'random' })(post({ texts: [REAL] }));
    for (const s of SECRETS) expect(op.seen[0]![0], s).not.toContain(s);
    expect(op.seen[0]![0]).not.toContain('REDACTED');
  });

  it('C25: proxy mode signs a receipt the caller verifies against what was sent and what came back', async () => {
    const keys = await generateReceiptKeys();
    const signer = { keys, runtime: 'sha256:bundle-1' };
    const body = (await (await createBlindHandler({ authenticate: AUTH, forward: echo().forward, signer })(post({ texts: [REAL] }))).json()) as BlindResponseBody;
    const { publicJwk } = await exportReceiptKeys(keys);
    const pub = await importReceiptPublicKey(publicJwk);
    expect(body.returned).toBe(`Resumen: ${body.sent[0] as string}`);
    expect(await verifyReceipt(body.receipt!, pub, { sent: body.sent, returned: body.returned, runtimes: ['sha256:bundle-1'] })).toBe(true);
    expect(await verifyReceipt(body.receipt!, pub, { returned: `${body.returned} ` })).toBe(false);
    // `returned` hashes the blind answer, so a guess at the real answer does not confirm against it.
    expect(await verifyReceipt(body.receipt!, pub, { returned: body.answer })).toBe(false);
    // The signature is random base64url, which can spell "Ana" by chance, so only the rest is searched.
    const { sig, ...signed } = body.receipt!;
    expect(sig).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(JSON.stringify(signed)).not.toMatch(/Ana|Ruiz|247,80/);
  });

  it('C24: forwardJson posts the blind texts and reads JSON or plain text answers', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (reply: Response): typeof fetch => (async (url: string | URL | Request, init?: RequestInit) => (calls.push({ url: String(url), init: init! }), reply)) as typeof fetch;
    expect(await forwardJson('https://svc.example/p', 'tok', fake(Response.json({ text: 'ok' })))(['a'], post({}), AbortSignal.timeout(1000))).toBe('ok');
    expect(calls[0]).toMatchObject({ url: 'https://svc.example/p', init: { method: 'POST', body: '{"texts":["a"]}' } });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(await forwardJson('https://svc.example/p', undefined, fake(new Response('plain')))(['a'], post({}), AbortSignal.timeout(1000))).toBe('plain');
    await expect(forwardJson('u', undefined, fake(new Response('x', { status: 500 })))(['a'], post({}), AbortSignal.timeout(1000))).rejects.toThrow('upstream 500');
    await expect(forwardJson('u', undefined, fake(Response.json({ nope: 1 })))(['a'], post({}), AbortSignal.timeout(1000))).rejects.toThrow('no text');
  });
});

describe('examples: the handler is not an open relay', () => {
  it('C33: refuses a missing or wrong credential with 401 before reading the body, and an unset secret refuses everyone', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward });
    for (const headers of [{} as Record<string, string>, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${TOKEN}x` }, { authorization: TOKEN }, { authorization: `Basic ${TOKEN}` }]) {
      const res = await h(post({ texts: [REAL] }, undefined, headers));
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.headers.get('www-authenticate')).toBe('Bearer');
      expect(await res.text()).not.toMatch(/Ana|caller-token/);
    }
    expect((await h(new Request('https://b.example/', { method: 'GET' }))).status).toBe(401);
    for (const secret of [undefined, '']) {
      expect((await createBlindHandler({ authenticate: bearerToken(secret), forward: up.forward })(post({ texts: [REAL] }))).status).toBe(401);
    }
    // A handler built without authenticate, from plain JavaScript, refuses too.
    const open = createBlindHandler({ forward: up.forward } as unknown as Parameters<typeof createBlindHandler>[0]);
    expect((await open(post({ texts: [REAL] }))).status).toBe(401);
    const throws = createBlindHandler({ authenticate: () => { throw new Error('auth backend down'); }, forward: up.forward });
    expect((await throws(post({ texts: [REAL] }))).status).toBe(401);
    expect(up.seen).toEqual([]);
    // The Deno and Lambda adapters refuse when CALLER_TOKEN is not set (the Workers test checks its own).
    const env = { UPSTREAM_URL: 'https://svc.example/p' };
    expect((await (await makeHandler((n) => (env as Record<string, string>)[n]))(post({ texts: [REAL] }))).status).toBe(401);
    const event = { rawPath: '/', requestContext: { http: { method: 'POST' } }, headers: { 'content-type': 'application/json', ...bearer }, body: JSON.stringify({ texts: ['x'] }) };
    expect((await createLambdaHandler(env)(event)).statusCode).toBe(401);
  });

  // The operator's own private values, set on the handler and never sent by the caller.
  const OPERATOR: KnownValue[] = [
    { kind: 'person', value: 'Rosalind Vexmoor' }, { kind: 'person', value: 'Odalys Penhallow' },
    { kind: 'org', value: 'Quillmarsh Tarnby' }, { kind: 'place', value: 'Brackwater Fen' },
  ];
  const OPERATOR_WORDS = /rosalind|vexmoor|odalys|penhallow|quillmarsh|tarnby|brackwater|\bfen\b/i;
  /** Every first name and surname blind draws fakes from, so an answer that names one of a known value's fakes is caught. */
  const EVERY_FAKE_NAME = Object.values(FAKES).flatMap((l) => [...l.female, ...l.male, ...l.last]).join(', ');

  it('C33: operator known values the caller text does not contain reach no part of the response, with or without the mapping', async () => {
    const seen: string[][] = [];
    // An upstream that quotes the blind text and then names every fake name there is.
    const forward: Forward = async (sent) => (seen.push(sent), `Resumen: ${sent[0] as string}\n${EVERY_FAKE_NAME}`);
    const h = createBlindHandler({ authenticate: AUTH, forward, known: OPERATOR });
    for (const text of ['Hello from the caller, nothing private here.', REAL]) {
      const res = await h(post({ texts: [text], returnMapping: true }));
      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(raw).not.toMatch(OPERATOR_WORDS);
      const body = JSON.parse(raw) as BlindResponseBody;
      expect(body.mapping).toBeDefined();
      for (const p of body.mapping!.pairs) expect(p.real).not.toMatch(OPERATOR_WORDS);
      expect(body.answer.startsWith(`Resumen: ${text}\n`)).toBe(true);
    }
    expect(seen.flat().join('\n')).not.toMatch(OPERATOR_WORDS);
  });

  it('C33: an operator known value the caller text does contain is still replaced, and the answer and the next turn round trip', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward, known: OPERATOR });
    const text = 'Rosalind Vexmoor asked about the invoice. Rosalind said Ana Ruiz has it.';
    const first = (await (await h(post({ texts: [text], known: [{ kind: 'person', value: 'Ana Ruiz' }], returnMapping: true }))).json()) as BlindResponseBody;
    expect(up.seen[0]![0]).not.toMatch(/\b(?:rosalind|vexmoor|ana|ruiz)\b/i);
    expect(first.sent).toEqual(up.seen[0]);
    expect(first.answer).toBe(`Resumen: ${text}`);
    const reals = first.mapping!.pairs.map((p) => p.real);
    expect(reals).toEqual(expect.arrayContaining(['Rosalind', 'Vexmoor']));
    // Only what the text wrote: the operator's other entries stay out.
    expect(reals.join(' ')).not.toMatch(/odalys|penhallow|quillmarsh|tarnby|brackwater/i);

    const next = 'Did Rosalind reply?';
    const second = (await (await h(post({ texts: [next], mapping: first.mapping, returnMapping: true }))).json()) as BlindResponseBody;
    expect(up.seen[1]![0]).not.toMatch(/rosalind/i);
    expect(second.answer).toBe(`Resumen: ${next}`);
    expect(JSON.stringify(second)).not.toMatch(/odalys|penhallow|quillmarsh|tarnby|brackwater/i);
  });

  it('C33: a 422 leak body carries none of the operator known values', async () => {
    const up = echo();
    // "rosa" is also an ordinary word here, so the bare first name is not carried and the leak check fires.
    const text = 'From: Rosa Paz <rosa@x.example>\n\nHola Rosa, la pintura rosa ya llegó. Rosalind Vexmoor lo sabe.';
    const res = await createBlindHandler({ authenticate: AUTH, forward: up.forward, known: OPERATOR })(post({ texts: [text], returnMapping: true }));
    expect(res.status).toBe(422);
    const raw = await res.text();
    expect(raw).not.toMatch(OPERATOR_WORDS);
    expect(raw).not.toMatch(/rosa|paz/i);
    expect(Object.keys(JSON.parse(raw) as object).sort()).toEqual(['error', 'hits', 'unenforced']);
    expect(up.seen).toEqual([]);
  });

  it('C33: a bad known entry gets a 400 that names its index and never its value', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward });
    const good = { kind: 'person', value: 'Ana Ruiz' };
    const cases: Array<[unknown[], number]> = [
      [[good, { kind: 'person', value: 5 }], 1],
      [[{ kind: 'amount', value: 'Ana Ruiz Secreta' }], 0],
      [[good, good, null], 2],
      [[{ kind: 'person', value: '  ' }], 0],
      [[{ kind: 'person' }], 0],
      [['Ana Ruiz Secreta'], 0],
      [[[good]], 0],
      [[good, { kind: 'person', value: `Ana Ruiz Secreta ${'x'.repeat(1000)}` }], 1],
    ];
    for (const [known, index] of cases) {
      const res = await h(post({ texts: [REAL], known }));
      expect(res.status, JSON.stringify(known).slice(0, 80)).toBe(400);
      const raw = await res.text();
      expect(raw).not.toMatch(/Ana|Ruiz|Secreta|xxxx/);
      expect(JSON.parse(raw)).toMatchObject({ error: 'known', index });
    }
    expect((await h(post({ texts: [REAL], known: [good, { kind: 'org', value: 'x'.repeat(1000) }] }))).status).toBe(200);
    expect(up.seen.length).toBe(1);
  });

  it('C33: a body over the size limit gets a 413, whether or not it declares its length', async () => {
    const up = echo();
    const h = createBlindHandler({ authenticate: AUTH, forward: up.forward, maxBodyBytes: 200 });
    expect((await h(post({ texts: ['x'.repeat(150)] }))).status).toBe(200);
    expect((await h(post({ texts: ['x'.repeat(250)] }))).status).toBe(413);
    // No content-length: the body arrives as a stream and reading stops at the limit.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new TextEncoder().encode(pulled === 1 ? '{"texts":["' : 'x'.repeat(64)));
      },
    });
    const streamed = new Request('https://b.example/', { method: 'POST', headers: bearer, body: stream, duplex: 'half' } as RequestInit);
    expect(streamed.headers.get('content-length')).toBeNull();
    const res = await h(streamed);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
    // The default limit is 1 MB.
    const big = await createBlindHandler({ authenticate: AUTH, forward: up.forward })(post({ texts: ['x'.repeat(1_000_001)] }));
    expect(big.status).toBe(413);
    expect(await big.text()).not.toContain('xxxx');
    expect(up.seen.length).toBe(1);
  });

  it('C33: an upstream that runs past the timeout gets a 504, through forwardJson and through a forward that ignores the signal', async () => {
    const hang: Forward = () => new Promise(() => {});
    const res = await createBlindHandler({ authenticate: AUTH, forward: hang, timeoutMs: 30 })(post({ texts: [REAL] }));
    expect(res.status).toBe(504);
    expect(await res.text()).not.toMatch(/Ana|Ruiz/);
    let aborted = false;
    const slowFetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => ((aborted = true), reject(init.signal?.reason)));
    })) as typeof fetch;
    const viaFetch = await createBlindHandler({ authenticate: AUTH, forward: forwardJson('https://svc.example/p', undefined, slowFetch), timeoutMs: 30 })(post({ texts: [REAL] }));
    expect(viaFetch.status).toBe(504);
    expect(aborted).toBe(true);
    // A fast upstream is not affected, and a failing one is still a 502.
    expect((await createBlindHandler({ authenticate: AUTH, forward: echo().forward, timeoutMs: 30 })(post({ texts: [REAL] }))).status).toBe(200);
    expect((await createBlindHandler({ authenticate: AUTH, forward: async () => { throw new Error('down'); }, timeoutMs: 30 })(post({ texts: [REAL] }))).status).toBe(502);
  });

  it('C33: a throw from blind or unblind gets a 500 with a fixed message and none of the input', async () => {
    const up = echo();
    // An operator known value that is not a string makes blind throw on every request.
    const broken = createBlindHandler({ authenticate: AUTH, forward: up.forward, known: [{ kind: 'person', value: 5 as unknown as string }] });
    const res = await broken(post({ texts: [REAL], known: [{ kind: 'person', value: 'Ana Ruiz' }] }));
    expect(res.status).toBe(500);
    const raw = await res.text();
    for (const s of SECRETS) expect(raw, s).not.toContain(s);
    expect(JSON.parse(raw)).toEqual({ error: 'internal', message: 'the request could not be processed' });
    expect(up.seen).toEqual([]);
    // An upstream that answers with something that is not text makes unblind throw.
    const odd = createBlindHandler({ authenticate: AUTH, forward: async () => ({ text: REAL }) as unknown as string });
    const res2 = await odd(post({ texts: [REAL] }));
    expect(res2.status).toBe(500);
    expect(await res2.text()).not.toMatch(/Ana|Ruiz|247,80/);
  });

  it('C34: the caller request id goes into the receipt, a bad one is refused, and none gives a fresh random id', async () => {
    const keys = await generateReceiptKeys();
    const h = createBlindHandler({ authenticate: AUTH, forward: echo().forward, signer: { keys, runtime: 'r' } });
    const body = (await (await h(post({ texts: [REAL], requestId: 'req-2026.11:05_a' }))).json()) as BlindResponseBody;
    expect(body.receipt!.body.requestId).toBe('req-2026.11:05_a');
    expect(await verifyReceipt(body.receipt!, keys.publicKey, { requestId: 'req-2026.11:05_a', sent: body.sent, returned: body.returned, maxAgeMs: 60_000 })).toBe(true);
    expect(await verifyReceipt(body.receipt!, keys.publicKey, { requestId: 'req-2026.11:05_b' })).toBe(false);
    for (const bad of ['', 'Ana Ruiz', 'x'.repeat(129), 7]) expect((await h(post({ texts: [REAL], requestId: bad }))).status).toBe(400);
    const a = (await (await h(post({ texts: [REAL] }))).json()) as BlindResponseBody;
    const b = (await (await h(post({ texts: [REAL] }))).json()) as BlindResponseBody;
    expect(a.receipt!.body.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.receipt!.body.requestId).not.toBe(b.receipt!.body.requestId);
  });
});

describe('examples: platform adapters', () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  const stubUpstream = (): void => {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const { texts } = JSON.parse(String(init?.body)) as { texts: string[] };
      seen.push(...texts);
      return Response.json({ text: `Resumen: ${texts[0] as string}` });
    }) as typeof fetch;
  };
  afterEach(() => {
    globalThis.fetch = realFetch;
    seen.length = 0;
  });

  it('C24: the Workers example blinds, forwards and serves its public key in proxy mode', async () => {
    stubUpstream();
    const keys = await generateReceiptKeys();
    const { privateJwk } = await exportReceiptKeys(keys);
    const env = { UPSTREAM_URL: 'https://svc.example/p', CALLER_TOKEN: TOKEN, RECEIPT_KEY: JSON.stringify(privateJwk), RUNTIME_DIGEST: 'sha256:w1' };
    const res = await workers.fetch(post({ texts: [REAL] }), env);
    const body = (await res.json()) as BlindResponseBody;
    expect(body.answer).toBe(`Resumen: ${REAL}`);
    for (const s of SECRETS) expect(seen.join('\n')).not.toContain(s);
    const published = (await (await workers.fetch(new Request('https://blind.example/.well-known/blind-receipt-key'), env)).json()) as { key: ReceiptJwk; runtime: string };
    expect(published.key.d).toBeUndefined();
    expect(published.runtime).toBe('sha256:w1');
    expect((await workers.fetch(post({ texts: [REAL] }), { ...env, CALLER_TOKEN: undefined })).status).toBe(401);
    expect(await verifyReceipt(body.receipt!, await importReceiptPublicKey(published.key), { sent: body.sent, returned: body.returned })).toBe(true);
  });

  it('C24: the Deno example builds the same handler from its environment', async () => {
    stubUpstream();
    await expect(makeHandler(() => undefined)).rejects.toThrow('UPSTREAM_URL');
    const h = await makeHandler((n) => ({ UPSTREAM_URL: 'https://svc.example/p', CALLER_TOKEN: TOKEN })[n]);
    const body = (await (await h(post({ texts: [REAL] }))).json()) as BlindResponseBody;
    expect(body.answer).toBe(`Resumen: ${REAL}`);
    expect((await h(new Request('https://d.example/.well-known/blind-receipt-key'))).status).toBe(404);
  });

  it('C24: the Lambda example maps a function URL event to the handler and back', async () => {
    stubUpstream();
    const event = { rawPath: '/', requestContext: { http: { method: 'POST' } }, headers: { 'content-type': 'application/json', ...bearer }, isBase64Encoded: true, body: btoa(unescape(encodeURIComponent(JSON.stringify({ texts: ['Pagamos 247,80 € a Ana Ruiz <ana@gestoria.example>.'] })))) };
    const out = await createLambdaHandler({ UPSTREAM_URL: 'https://svc.example/p', CALLER_TOKEN: TOKEN })(event);
    expect(out.statusCode).toBe(200);
    expect(out.headers['content-type']).toContain('application/json');
    expect((JSON.parse(out.body) as BlindResponseBody).answer).toBe('Resumen: Pagamos 247,80 € a Ana Ruiz <ana@gestoria.example>.');
    expect(seen.join('\n')).not.toMatch(/Ana|Ruiz|247,80/);
    await expect(createLambdaHandler({})(event)).rejects.toThrow('UPSTREAM_URL');
    const keys = await generateReceiptKeys();
    const { privateJwk } = await exportReceiptKeys(keys);
    const signed = createLambdaHandler({ UPSTREAM_URL: 'https://svc.example/p', RECEIPT_KEY: JSON.stringify(privateJwk), RUNTIME_DIGEST: 'sha256:l1' });
    const pub = await signed({ rawPath: '/.well-known/blind-receipt-key', requestContext: { http: { method: 'GET' } } });
    expect(JSON.parse(pub.body)).toMatchObject({ runtime: 'sha256:l1', key: { kty: 'OKP', crv: 'Ed25519' } });
    expect((await createLambdaHandler({ UPSTREAM_URL: 'u' })({ rawPath: '/.well-known/blind-receipt-key' })).statusCode).toBe(404);
    // Lambda calls handler(event, context): settings come from process.env, not the second argument.
    const saved = process.env.UPSTREAM_URL;
    const savedToken = process.env.CALLER_TOKEN;
    process.env.UPSTREAM_URL = 'https://svc.example/p';
    process.env.CALLER_TOKEN = TOKEN;
    try {
      expect((await lambdaEntry(event, { awsRequestId: 'x', functionName: 'f' })).statusCode).toBe(200);
    } finally {
      if (saved === undefined) delete process.env.UPSTREAM_URL;
      else process.env.UPSTREAM_URL = saved;
      if (savedToken === undefined) delete process.env.CALLER_TOKEN;
      else process.env.CALLER_TOKEN = savedToken;
    }
  });
});
