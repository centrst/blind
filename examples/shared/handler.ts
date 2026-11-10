/**
 * A blind redaction layer for any runtime that speaks web `Request` and
 * `Response` (Cloudflare Workers, Deno, Bun, Vercel and Netlify functions, and
 * Node through an adapter). It blinds the incoming text, refuses to go on if the
 * leak check fires, hands only the blind copy to `forward`, and puts the real
 * values back into the answer before it returns.
 *
 * With a `signer` it runs in proxy mode: every answer carries a receipt signed
 * by the runtime's key, so the caller can check what left and what came back.
 *
 * Every request must pass `authenticate` first. `bearerToken(secret)` is the
 * one the adapters use: it wants `Authorization: Bearer <secret>` and refuses
 * every request when the secret is not set, so a deployment is never open.
 *
 * Request body (JSON, at most `maxBodyBytes`, 1 MB by default):
 *   { "texts": ["..."], "known"?: [{ "kind", "value" }], "deny"?: ["..."],
 *     "mapping"?: <mapping from the previous turn>, "returnMapping"?: true,
 *     "replaceWith"?: "fake" | "placeholder" | "random", "requestId"?: "..." }
 *
 * Response body (JSON), status 200:
 *   { "answer": "...", "invented": ["..."], "sent": ["<blind texts>"],
 *     "returned": "<the blind answer>", "unenforced": [{ "kind", "index", "reason" }],
 *     "mapping"?: <when returnMapping>, "receipt"?: <in proxy mode> }
 *
 * `unenforced` names, by the index in the request's `known` and kind, each entry
 * the leak check enforces only as written or in capitals (a stop word such as
 * `Al`, or a full name with one such part) or, for a two-syllable Korean value,
 * only where a word starts. It is also in the 422 body.
 *
 * Status 401 without a valid credential, 405 for anything but POST, 413 for a
 * body over the limit, 400 for a bad body (a bad `known` entry names its index),
 * a mapping that breaks blind's invariants or a `replaceWith` that differs from
 * the mapping's, 422 when the leak check fires (kinds and offsets only, nothing
 * was forwarded), 502 when `forward` fails, 504 when it takes longer than
 * `timeoutMs` (10 s by default), 500 for anything else. No status or log line
 * ever carries a value.
 */
import {
  assertNoLeaks, blind, checkMapping, exportReceiptKeys, LeakError, signReceipt, unblind,
  type KnownKind, type KnownValue, type Mapping, type Receipt, type ReceiptKeyPair, type ReplaceWith, type UnenforcedKnown,
} from '@centrst/blind';

const MODES: readonly ReplaceWith[] = ['fake', 'placeholder', 'random'];
const KNOWN_KINDS: readonly KnownKind[] = ['person', 'org', 'email', 'domain', 'phone', 'place', 'id'];
/** The longest `known` value accepted, in UTF-16 code units. */
export const MAX_KNOWN_LENGTH = 1000;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Sends the blind texts on and returns the downstream answer. Only blind text
 * ever reaches it. `signal` aborts when the handler's timeout runs out: pass it
 * to `fetch`.
 */
export type Forward = (sent: string[], request: Request, signal: AbortSignal) => Promise<string>;

/** Decides whether a request may use the proxy. Resolve `true` to let it through. */
export type Authenticate = (request: Request) => boolean | Promise<boolean>;

export interface Signer {
  keys: ReceiptKeyPair;
  /** What is running, for example the SHA-256 of the deployed bundle. Callers pin it. */
  runtime: string;
}

export interface BlindHandlerOptions {
  /**
   * Who may call. Required: without it every request gets a 401. Use
   * `bearerToken(secret)`, or your own check (mTLS, a signed JWT, a platform
   * identity). Never `() => true` on anything reachable from outside.
   */
  authenticate: Authenticate;
  forward: Forward;
  /** The largest request body read, in bytes. Default 1,000,000. Past it the answer is 413. */
  maxBodyBytes?: number;
  /** How long `forward` may take, in milliseconds. Default 10,000. Past it the answer is 504. */
  timeoutMs?: number;
  /** Values the operator always treats as private, added to each request's own `known`. */
  known?: KnownValue[];
  /** Strings that must never leave, added to each request's own `deny`. */
  deny?: string[];
  /** Proxy mode: sign every answer. */
  signer?: Signer;
  /** What found values become when a request does not say. Default `fake`. */
  replaceWith?: ReplaceWith;
}

export interface BlindRequestBody {
  texts: string[];
  known?: KnownValue[];
  deny?: string[];
  mapping?: Mapping;
  returnMapping?: boolean;
  replaceWith?: ReplaceWith;
  /** Goes into the receipt, so the caller can tie it to this request. Letters, digits and . _ : - only, up to 128. */
  requestId?: string;
}

export interface BlindResponseBody {
  answer: string;
  invented: string[];
  sent: string[];
  /** The blind answer the upstream returned. The receipt's `returned` is its hash. */
  returned: string;
  /** The request's `known` entries the leak check enforces only in part, by index and kind. */
  unenforced: UnenforcedKnown[];
  mapping?: Mapping;
  receipt?: Receipt;
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

const badBody = (): Response => json({ error: 'body', message: 'expected { "texts": [string, ...] }, replaceWith one of fake, placeholder, random, and requestId of up to 128 letters, digits and . _ : -' }, 400);

/** The index of the first `known` entry that is not `{ kind, value }` with a known kind and a non-empty value of bounded length. */
function badKnownEntry(known: unknown[]): number {
  return known.findIndex((k) => {
    if (!k || typeof k !== 'object' || Array.isArray(k)) return true;
    const { kind, value } = k as Record<string, unknown>;
    return !KNOWN_KINDS.includes(kind as KnownKind) || typeof value !== 'string' || value.trim() === '' || value.length > MAX_KNOWN_LENGTH;
  });
}

/** The parsed body, a `known` index to refuse, or null for a bad shape. */
function parseBody(raw: unknown): BlindRequestBody | { knownIndex: number } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (!Array.isArray(b.texts) || b.texts.length === 0 || !b.texts.every((t) => typeof t === 'string')) return null;
  if (b.known !== undefined && !Array.isArray(b.known)) return null;
  if (b.deny !== undefined && !(Array.isArray(b.deny) && b.deny.every((d) => typeof d === 'string'))) return null;
  if (b.replaceWith !== undefined && !MODES.includes(b.replaceWith as ReplaceWith)) return null;
  if (b.requestId !== undefined && !(typeof b.requestId === 'string' && REQUEST_ID.test(b.requestId))) return null;
  const knownIndex = b.known ? badKnownEntry(b.known as unknown[]) : -1;
  if (knownIndex >= 0) return { knownIndex };
  return b as unknown as BlindRequestBody;
}

const TOO_LARGE = Symbol('too large');

/** The body as text, read no further than `limit` bytes. */
async function readBody(request: Request, limit: number): Promise<string | typeof TOO_LARGE> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) return TOO_LARGE;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) (bytes.set(c, at), (at += c.byteLength));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Rejects once `signal` aborts, so a `forward` that ignores the signal still stops the request. */
const whenAborted = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));

const enc = new TextEncoder();
const digest = async (s: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/**
 * An `Authenticate` that wants `Authorization: Bearer <secret>`. The token is
 * compared in constant time (both sides hashed, then every byte compared), and
 * every request is refused when `secret` is unset or empty.
 */
export function bearerToken(secret: string | undefined): Authenticate {
  const expected = secret ? digest(secret) : undefined;
  return async (request) => {
    if (!expected) return false;
    const m = /^Bearer[ ]+(\S+)[ ]*$/i.exec(request.headers.get('authorization') ?? '');
    if (!m) return false;
    const [a, b] = await Promise.all([digest(m[1] as string), expected]);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
    return diff === 0;
  };
}

export function createBlindHandler(opts: BlindHandlerOptions): (request: Request) => Promise<Response> {
  const maxBodyBytes = opts.maxBodyBytes ?? 1_000_000;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return async (request) => {
    let allowed = false;
    try {
      allowed = typeof opts.authenticate === 'function' && (await opts.authenticate(request)) === true;
    } catch {
      allowed = false;
    }
    if (!allowed) return json({ error: 'auth', message: 'a valid credential is required' }, 401, { 'www-authenticate': 'Bearer' });
    if (request.method !== 'POST') return json({ error: 'method', message: 'POST a JSON body' }, 405);
    let parsed: ReturnType<typeof parseBody>;
    try {
      const raw = await readBody(request, maxBodyBytes);
      if (raw === TOO_LARGE) return json({ error: 'size', message: `the body is over ${maxBodyBytes} bytes` }, 413);
      parsed = parseBody(JSON.parse(raw));
    } catch {
      parsed = null;
    }
    if (!parsed) return badBody();
    if ('knownIndex' in parsed) {
      return json({ error: 'known', index: parsed.knownIndex, message: `known[${parsed.knownIndex}] must be { kind, value } with kind one of ${KNOWN_KINDS.join(', ')} and a value of 1 to ${MAX_KNOWN_LENGTH} characters` }, 400);
    }
    try {
      return await handle(parsed, request);
    } catch {
      // blind, unblind or signing failed. Their messages can quote the input, so none of it goes out.
      return json({ error: 'internal', message: 'the request could not be processed' }, 500);
    }
  };

  async function handle(body: BlindRequestBody, request: Request): Promise<Response> {
    if (body.mapping !== undefined) {
      // A mapping from the caller must keep blind's invariants, or a crafted one (factor 1, no shift)
      // would let real amounts and dates through. The message names the field, never a value.
      try {
        checkMapping(body.mapping);
      } catch (e) {
        return json({ error: 'mapping', message: e instanceof Error ? e.message : 'invalid mapping' }, 400);
      }
      // This handler never makes a mapping that keeps kinds as written. One from a caller would switch
      // replacement off for those kinds while the receipt still says the leak check passed.
      if (body.mapping.keep !== undefined) return json({ error: 'mapping', message: 'blind: the mapping is not valid (keep)' }, 400);
    }

    // A continued conversation keeps its mapping's mode, so the operator default only applies to a new one.
    const kept = body.mapping ? (body.mapping.replaceWith ?? 'fake') : undefined;
    if (kept && body.replaceWith && body.replaceWith !== kept) {
      return json({ error: 'replaceWith', message: `replaceWith is '${body.replaceWith}' but the mapping was made with '${kept}'` }, 400);
    }
    const result = blind(body.texts, {
      known: [...(opts.known ?? []), ...(body.known ?? [])],
      deny: [...(opts.deny ?? []), ...(body.deny ?? [])],
      mapping: body.mapping,
      replaceWith: body.replaceWith ?? kept ?? opts.replaceWith,
    });
    // Indexed in the request's own `known`: the operator's entries come first and are not the caller's to see.
    const offset = opts.known?.length ?? 0;
    const unenforced = result.leaks.unenforced.filter((u) => u.index >= offset).map((u) => ({ ...u, index: u.index - offset }));
    try {
      assertNoLeaks(result);
    } catch (e) {
      if (e instanceof LeakError) return json({ error: 'leak', hits: e.report.hits, unenforced }, 422);
      throw e;
    }

    let downstream: string;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      downstream = await Promise.race([opts.forward(result.texts, request, signal), whenAborted(signal)]);
    } catch {
      if (signal.aborted) return json({ error: 'timeout', message: `the downstream call took longer than ${timeoutMs} ms` }, 504);
      return json({ error: 'upstream', message: 'the downstream call failed' }, 502);
    }

    const { text: answer, invented } = unblind(downstream, result.mapping);
    const out: BlindResponseBody = { answer, invented, sent: result.texts, returned: downstream, unenforced };
    if (body.returnMapping) out.mapping = result.mapping;
    if (opts.signer) {
      out.receipt = await signReceipt({ result, returned: downstream, requestId: body.requestId, runtime: opts.signer.runtime, ...opts.signer.keys });
    }
    return json(out);
  }
}

/**
 * The public half of the signing key and the runtime it vouches for, to serve
 * at a well-known path so callers can fetch and pin it.
 */
export async function publicKeyResponse(signer: Signer): Promise<Response> {
  const { publicJwk } = await exportReceiptKeys(signer.keys);
  return json({ key: publicJwk, runtime: signer.runtime });
}

/**
 * A `Forward` that POSTs `{ "texts": [...] }` to `url` and reads the answer
 * from a JSON `{ "text": "..." }` or a plain-text body. Point it at your own
 * service: a model call, a ticket classifier, anything that should only ever
 * see blind text.
 */
export function forwardJson(url: string, token?: string, fetchImpl: typeof fetch = fetch): Forward {
  return async (sent, _request, signal) => {
    const res = await fetchImpl(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ texts: sent }),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('application/json')) {
      const data = (await res.json()) as { text?: unknown };
      if (typeof data.text !== 'string') throw new Error('upstream answer has no text');
      return data.text;
    }
    return res.text();
  };
}
