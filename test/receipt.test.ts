import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  blind, canonicalJson, exportReceiptKeys, generateReceiptKeys, importReceiptKeys, importReceiptPublicKey, receiptKeyId, sha256Hex,
  signReceipt, verifyReceipt, VERSION,
  type BlindResult, type Receipt, type ReceiptJwk,
} from '../src/index.js';
import { containsWord } from './support/corpus.js';
import { emailCase, seedArb } from './support/gen.js';
import { numRuns, seedOf } from './support/properties.js';

const text = 'From: Ana Ruiz <ana@gestoria.example>\nTotal: 247,80 € antes del 3 de marzo de 2026. DNI 12345678Z.';

async function issued(): Promise<{ receipt: Receipt; keys: Awaited<ReturnType<typeof generateReceiptKeys>>; sent: string[]; returned: string }> {
  const keys = await generateReceiptKeys();
  const result = blind([text], { seed: 'receipt' });
  // The blind answer, what the upstream sent back before unblind.
  const returned = `Recibido: ${result.texts[0] as string}`;
  const receipt = await signReceipt({ result, returned, runtime: 'sha256:bundle-1', ...keys, issuedAt: new Date('2026-10-24T00:00:00Z'), requestId: 'req-1' });
  return { receipt, keys, sent: result.texts, returned };
}

describe('receipts', () => {
  it('C23: a receipt verifies with its key and binds what was sent, what came back and the runtime', async () => {
    const { receipt, keys, sent, returned } = await issued();
    expect(receipt.body).toMatchObject({ v: 2, requestId: 'req-1', lib: `@centrst/blind@${VERSION}`, runtime: 'sha256:bundle-1', leaksOk: true, issuedAt: '2026-10-24T00:00:00.000Z' });
    expect(receipt.body.replaced).toEqual({ person: 1, email: 1, amount: 1, date: 1, id: 1 });
    expect(receipt.keyId).toBe(await receiptKeyId(keys.publicKey));
    expect(await verifyReceipt(receipt, keys.publicKey)).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { sent, returned, runtimes: ['sha256:bundle-1'] })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { sent: [`${sent[0] as string} `] })).toBe(false);
    expect(await verifyReceipt(receipt, keys.publicKey, { returned: `${returned}.` })).toBe(false);
    expect(await verifyReceipt(receipt, keys.publicKey, { runtimes: ['sha256:other'] })).toBe(false);
  });

  it('C23: any change to the body, the key id or the signature fails verification, and nothing throws', async () => {
    const { receipt, keys } = await issued();
    const other = await generateReceiptKeys();
    expect(await verifyReceipt(receipt, other.publicKey)).toBe(false);
    expect(await verifyReceipt({ ...receipt, keyId: await receiptKeyId(other.publicKey) }, keys.publicKey)).toBe(false);
    // The first character carries six full bits of the signature, so changing it always changes the bytes.
    const flipped = `${receipt.sig[0] === 'A' ? 'B' : 'A'}${receipt.sig.slice(1)}`;
    expect(await verifyReceipt({ ...receipt, sig: flipped }, keys.publicKey)).toBe(false);
    expect(await verifyReceipt({ ...receipt, sig: 'not base64!' }, keys.publicKey)).toBe(false);
    expect(await verifyReceipt(null as unknown as Receipt, keys.publicKey)).toBe(false);
    expect(await verifyReceipt({ ...receipt, body: { ...receipt.body, v: 1 as 2 } }, keys.publicKey)).toBe(false);
    const tampered: Array<Partial<Receipt['body']>> = [
      { runtime: 'sha256:bundle-2' }, { issuedAt: '2026-10-25T00:00:00.000Z' }, { leaksOk: false }, { sent: '0'.repeat(64) },
      { returned: '0'.repeat(64) }, { lib: '@centrst/blind@9.9.9' }, { replaced: {} }, { requestId: 'req-2' },
    ];
    for (const change of tampered) {
      expect(await verifyReceipt({ ...receipt, body: { ...receipt.body, ...change } }, keys.publicKey), JSON.stringify(change)).toBe(false);
    }
  });

  it('C23: a receipt carries hashes and counts, never a value', async () => {
    const keys = await generateReceiptKeys();
    const samples = fc.sample(fc.tuple(emailCase, seedArb), { numRuns: Math.min(200, numRuns()), seed: seedOf() });
    for (const [c, seed] of samples) {
      const result = blind([c.text], { known: c.known, seed, dateOrder: c.dateOrder });
      const receipt = await signReceipt({ result, returned: c.text, runtime: 'r', ...keys });
      const dump = JSON.stringify(receipt);
      // Name tokens and whole values. A bare year can match the issue time by chance, so number fragments are not checked alone.
      for (const sp of c.spans) {
        const parts = [sp.value, ...sp.value.split(/\s+/).filter((t) => t.length >= 4 && /\p{L}/u.test(t))];
        for (const part of parts) expect(containsWord(dump, part), `${sp.kind} in receipt`).toBe(false);
      }
    }
  });

  it('C23: canonical JSON ignores key order and undefined fields, and hashes are SHA-256 hex', async () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe('{"a":{"d":[1,{"x":1,"y":2}]},"b":1}');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(['a', 'b'])).toBe(await sha256Hex('["a","b"]'));
    expect(await sha256Hex(['a', 'b'])).not.toBe(await sha256Hex(['a\u0000b']));
  });
});

describe('receipt freshness and request id', () => {
  it('C34: maxAgeMs refuses a receipt issued too long before now, so an old one cannot be replayed', async () => {
    const { receipt, keys } = await issued();
    const issuedAt = Date.parse('2026-10-24T00:00:00Z');
    const fresh = { maxAgeMs: 60_000 };
    expect(await verifyReceipt(receipt, keys.publicKey, { ...fresh, now: issuedAt + 60_000 })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { ...fresh, now: new Date(issuedAt + 1_000) })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { ...fresh, now: issuedAt + 60_001 })).toBe(false);
    // Without `now` the check counts back from the current time, long after 2026-10-24.
    expect(await verifyReceipt(receipt, keys.publicKey, fresh)).toBe(false);
    const recent = await signReceipt({ result: blind(['Ana Ruiz'], { seed: 'r' }), returned: 'ok', runtime: 'r', ...keys });
    expect(await verifyReceipt(recent, keys.publicKey, fresh)).toBe(true);
    // A nonsense age or clock refuses instead of passing or throwing.
    for (const bad of [{ maxAgeMs: Number.NaN, now: issuedAt }, { maxAgeMs: -1, now: issuedAt }, { maxAgeMs: 1, now: Number.NaN }]) {
      expect(await verifyReceipt(receipt, keys.publicKey, bad)).toBe(false);
    }
    expect(await verifyReceipt({ ...receipt, body: { ...receipt.body, issuedAt: 'not a date' } }, keys.publicKey, { maxAgeMs: 1e15, now: issuedAt })).toBe(false);
  });

  it('C34: requestId refuses a receipt made for another request, and a receipt without a caller id gets a random one', async () => {
    const { receipt, keys } = await issued();
    expect(await verifyReceipt(receipt, keys.publicKey, { requestId: 'req-1' })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { requestId: 'req-2' })).toBe(false);
    expect(await verifyReceipt(receipt, keys.publicKey, { requestId: '' })).toBe(false);
    const result = blind([text], { seed: 'id' });
    const [a, b] = await Promise.all([1, 2].map(() => signReceipt({ result, returned: 'ok', runtime: 'r', ...keys })));
    expect(a!.body.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(a!.body.requestId).not.toBe(b!.body.requestId);
  });

  it('C34: returned hashes the blind answer, so the real answer does not confirm against it', async () => {
    const keys = await generateReceiptKeys();
    const result = blind([text], { seed: 'returned' });
    const blindAnswer = `Recibido: ${result.texts[0] as string}`;
    const receipt = await signReceipt({ result, returned: blindAnswer, runtime: 'r', ...keys });
    expect(receipt.body.returned).toBe(await sha256Hex(blindAnswer));
    expect(await verifyReceipt(receipt, keys.publicKey, { returned: blindAnswer })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { returned: `Recibido: ${text}` })).toBe(false);
  });
});

describe('receipt clock skew', () => {
  it('C45: maxAgeMs refuses a receipt dated after now by more than the default skew of 60 s, and accepts one within it', async () => {
    const { receipt, keys } = await issued();
    const issuedAt = Date.parse('2026-10-24T00:00:00Z');
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, now: issuedAt - 60_000 })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, now: issuedAt - 60_001 })).toBe(false);
    // A receipt dated in 2099 is not fresh today, however short maxAgeMs is.
    const future = await signReceipt({ result: blind([text], { seed: 'future' }), returned: 'ok', runtime: 'r', ...keys, issuedAt: new Date('2099-01-01T00:00:00Z') });
    expect(await verifyReceipt(future, keys.publicKey, { maxAgeMs: 60_000, now: Date.parse('2026-11-05T00:00:00Z') })).toBe(false);
    expect(await verifyReceipt(future, keys.publicKey)).toBe(true);
  });

  it('C45: maxSkewMs sets the skew allowed, alone it checks only the future side, and a nonsense skew refuses', async () => {
    const { receipt, keys } = await issued();
    const issuedAt = Date.parse('2026-10-24T00:00:00Z');
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, maxSkewMs: 5_000, now: issuedAt - 5_000 })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, maxSkewMs: 5_000, now: issuedAt - 5_001 })).toBe(false);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, maxSkewMs: 0, now: issuedAt })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, maxSkewMs: 0, now: issuedAt - 1 })).toBe(false);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, maxSkewMs: 600_000, now: issuedAt - 600_000 })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxSkewMs: 1_000, now: issuedAt + 1e12 })).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey, { maxSkewMs: 1_000, now: issuedAt - 1_001 })).toBe(false);
    for (const maxSkewMs of [Number.NaN, -1]) {
      expect(await verifyReceipt(receipt, keys.publicKey, { maxAgeMs: 60_000, maxSkewMs, now: issuedAt })).toBe(false);
    }
  });

  it('C45: without now, maxAgeMs and the skew count from the real clock', async () => {
    const keys = await generateReceiptKeys();
    const result = blind([text], { seed: 'clock' });
    const at = (ms: number) => signReceipt({ result, returned: 'ok', runtime: 'r', ...keys, issuedAt: new Date(Date.now() + ms) });
    expect(await verifyReceipt(await at(0), keys.publicKey, { maxAgeMs: 60_000 })).toBe(true);
    expect(await verifyReceipt(await at(30_000), keys.publicKey, { maxAgeMs: 60_000 })).toBe(true);
    expect(await verifyReceipt(await at(120_000), keys.publicKey, { maxAgeMs: 60_000 })).toBe(false);
    expect(await verifyReceipt(await at(-120_000), keys.publicKey, { maxAgeMs: 60_000 })).toBe(false);
  });
});

/** RFC 8032 section 7.1, TEST 1: a published test key, so the fixture signature below is reproducible anywhere. */
const RFC8032_KEY: ReceiptJwk = { kty: 'OKP', crv: 'Ed25519', d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };

/** A receipt from that key, also checked by the Python snippet in docs/PROXY.md. Synthetic values only. */
const FIXTURE: Receipt = {
  body: {
    v: 2, lib: '@centrst/blind@0.1.0', runtime: 'sha256:bundle-1', issuedAt: '2026-11-05T09:00:00.000Z', requestId: 'req-0001',
    sent: 'c92dbc14114872fc354640651e516c319f6daedb7e12c486727c78bbaeeba6ea',
    returned: '77646285b5129f2ad20b0e1e31f82d6ae379f109edc011143757228f6c8d60d7',
    leaksOk: true, replaced: { person: 1, amount: 1 },
  },
  keyId: '21fe31dfa154a261',
  sig: 'i-ewpAyT82ubXv7kIFtUZRVohEGmXZFbn8zMHG9iWHVPBHpmrdzatPBaWlauVDwR2Veux1O7KdPUh6XOMp9EBw',
};
const FIXTURE_SENT = ['Hola Naomi Holloway, el total es 263,40 €.'];
const FIXTURE_RETURNED = 'Naomi Holloway debe 263,40 €.';

/** The double whose IEEE 754 bits are `bits`, as RFC 8785 Appendix B lists them. */
function fromBits(bits: string): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, BigInt(`0x${bits}`));
  return view.getFloat64(0);
}

describe('receipt canonical form (RFC 8785)', () => {
  it('C35: sorts keys by UTF-16 code units, as in RFC 8785 section 3.2.3', () => {
    const input = JSON.parse('{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}') as Record<string, string>;
    // JSON.parse would list the integer key "1" first again, so the order is read from the bytes.
    const keys = [...canonicalJson(input).matchAll(/"((?:[^"\\]|\\.)*)":/g)].map((m) => JSON.parse(`"${m[1]}"`) as string);
    expect(keys.map((k) => input[k])).toEqual([
      'Carriage Return', 'One', 'Control', 'Latin Small Letter O With Diaeresis', 'Euro Sign', 'Emoji: Grinning Face', 'Hebrew Letter Dalet With Dagesh',
    ]);
  });

  it('C35: escapes strings and writes numbers as in RFC 8785 section 3.2.4 and Appendix B', () => {
    const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}') as unknown;
    expect(canonicalJson(input)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
    const appendixB: Array<[string, string]> = [
      ['0000000000000000', '0'], ['8000000000000000', '0'], ['0000000000000001', '5e-324'], ['8000000000000001', '-5e-324'],
      ['7fefffffffffffff', '1.7976931348623157e+308'], ['4340000000000000', '9007199254740992'], ['c340000000000000', '-9007199254740992'],
      ['4430000000000000', '295147905179352830000'], ['44b52d02c7e14af5', '9.999999999999997e+22'], ['44b52d02c7e14af6', '1e+23'],
      ['3eb0c6f7a0b5ed8d', '0.000001'], ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ];
    for (const [bits, out] of appendixB) expect(canonicalJson(fromBits(bits)), bits).toBe(out);
  });

  it('C35: refuses what JSON cannot hold instead of signing something else', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, fromBits('7ff0000000000000'), '\ud800', 'a\udc00b', { k: '\ud83d' }, [undefined], 1n, () => 1]) {
      expect(() => canonicalJson(bad), String(typeof bad)).toThrow(/canonicalJson/);
    }
    expect(canonicalJson({ a: undefined, b: '😀' })).toBe('{"b":"😀"}');
  });

  it('C35: a fixture receipt pins its canonical bytes and signature, and signing the same inputs gives the same receipt', async () => {
    expect(canonicalJson(FIXTURE.body)).toBe(
      '{"issuedAt":"2026-11-05T09:00:00.000Z","leaksOk":true,"lib":"@centrst/blind@0.1.0","replaced":{"amount":1,"person":1},"requestId":"req-0001",' +
      '"returned":"77646285b5129f2ad20b0e1e31f82d6ae379f109edc011143757228f6c8d60d7","runtime":"sha256:bundle-1",' +
      '"sent":"c92dbc14114872fc354640651e516c319f6daedb7e12c486727c78bbaeeba6ea","v":2}',
    );
    const keys = await importReceiptKeys(RFC8032_KEY);
    const pub = await importReceiptPublicKey({ kty: 'OKP', crv: 'Ed25519', x: RFC8032_KEY.x });
    expect(await verifyReceipt(FIXTURE, pub, { sent: FIXTURE_SENT, returned: FIXTURE_RETURNED, requestId: 'req-0001', runtimes: ['sha256:bundle-1'] })).toBe(true);
    // Ed25519 signatures are deterministic, so the library signs these inputs to exactly the fixture (the lib field aside).
    const result = { texts: FIXTURE_SENT, leaks: { ok: true }, replaced: { person: 1, amount: 1 } } as unknown as BlindResult;
    const again = await signReceipt({ result, returned: FIXTURE_RETURNED, requestId: 'req-0001', runtime: 'sha256:bundle-1', ...keys, issuedAt: new Date('2026-11-05T09:00:00Z') });
    expect(again.body).toEqual({ ...FIXTURE.body, lib: `@centrst/blind@${VERSION}` });
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(canonicalJson(FIXTURE.body)));
    expect(Buffer.from(sig).toString('base64url')).toBe(FIXTURE.sig);
  });
});

/** The Python verifier in docs/PROXY.md, read from the doc so the test runs exactly what readers copy. */
function proxyDocPython(): string {
  const doc = readFileSync(new URL('../docs/PROXY.md', import.meta.url), 'utf8');
  const section = doc.slice(doc.indexOf('### Verifying in another language'));
  const block = /```python\n([\s\S]*?)```/.exec(section);
  if (!block) throw new Error('docs/PROXY.md: no python block under "Verifying in another language"');
  return block[1] as string;
}

/** Why the Python test cannot run here, or null when python3 and the `cryptography` package are present. */
function pythonMissing(): string | null {
  const probe = spawnSync('python3', ['-I', '-c', 'import cryptography'], { encoding: 'utf8' });
  if (probe.error) return 'python3 is not on PATH';
  if (probe.status !== 0) return 'python3 has no `cryptography` package';
  return null;
}
const noPython = pythonMissing();
if (noPython) console.warn(`receipt.test.ts: skipping the docs/PROXY.md Python verifier test: ${noPython}`);

describe('receipt verifier in Python', () => {
  it.skipIf(noPython !== null)(`C35: the Python verifier in docs/PROXY.md accepts the fixture receipt and refuses changed ones${noPython ? ` (skipped: ${noPython})` : ''}`, () => {
    const driver = `${proxyDocPython()}
import sys
case = json.loads(sys.stdin.read())
print(json.dumps([verify_receipt(r, case["jwk"], sent=case["sent"], returned=case["returned"], request_id=case["requestId"]) for r in case["receipts"]]))
`;
    const changed = (body: Partial<Receipt['body']>): Receipt => ({ ...FIXTURE, body: { ...FIXTURE.body, ...body } });
    const receipts = [
      FIXTURE,
      changed({ leaksOk: false }),
      changed({ requestId: 'req-0002' }),
      { ...FIXTURE, sig: `${FIXTURE.sig.slice(0, -2)}AA` },
      { ...FIXTURE, keyId: '0000000000000000' },
    ];
    const input = JSON.stringify({ jwk: { kty: 'OKP', crv: 'Ed25519', x: RFC8032_KEY.x }, sent: FIXTURE_SENT, returned: FIXTURE_RETURNED, requestId: 'req-0001', receipts });
    const run = spawnSync('python3', ['-I', '-c', driver], { input, encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual([true, false, false, false, false]);
    // The same snippet checks the hashes: other sent texts or another answer fail.
    const other = spawnSync('python3', ['-I', '-c', driver], { input: JSON.stringify({ ...JSON.parse(input), sent: ['x'], returned: 'y' }), encoding: 'utf8' });
    expect(JSON.parse(other.stdout)).toEqual([false, false, false, false, false]);
  });
});

describe('receipt counts', () => {
  it('C23: counts what this request replaced, every occurrence, and nothing from earlier turns', async () => {
    const keys = await generateReceiptKeys();
    const first = blind(['Dr. Elara Voss saw Dr. Elara Voss again.'], { seed: 'counts' });
    expect(first.replaced).toEqual({ person: 2 });
    const second = blind(['Nothing private here.'], { mapping: first.mapping });
    expect(second.replaced).toEqual({});
    const receipt = await signReceipt({ result: second, returned: 'ok', runtime: 'r', ...keys });
    expect(receipt.body.replaced).toEqual({});
  });
});

describe('receipt keys', () => {
  it('C23: keys round trip through JWK, the public half has no private part, and wrong keys are refused', async () => {
    const keys = await generateReceiptKeys();
    const { privateJwk, publicJwk } = await exportReceiptKeys(keys);
    expect(publicJwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: privateJwk.x });
    expect(privateJwk.d).toBeTruthy();
    const back = await importReceiptKeys(privateJwk);
    const result = blind(['Ana Ruiz <ana@gestoria.example>'], { seed: 'jwk' });
    const receipt = await signReceipt({ result, returned: 'ok', runtime: 'r', ...back });
    expect(await verifyReceipt(receipt, await importReceiptPublicKey(publicJwk))).toBe(true);
    expect(await verifyReceipt(receipt, keys.publicKey)).toBe(true);
    await expect(importReceiptKeys(publicJwk)).rejects.toThrow('private JWK');
    await expect(importReceiptKeys({ ...privateJwk, crv: 'X25519' as 'Ed25519' })).rejects.toThrow('private JWK');
    await expect(importReceiptPublicKey({ ...publicJwk, kty: 'EC' as 'OKP' })).rejects.toThrow('public JWK');
  });
});
