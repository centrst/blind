/**
 * Signed receipts for a runtime that blinds on someone else's behalf (proxy
 * mode). A receipt binds the hash of exactly what left for the model, the hash
 * of the blind answer that came back, the leak check result (for the values
 * blind found or was given in `known` and `deny`), how many values of
 * each kind were replaced, a request id and the time it was issued, under the
 * runtime's Ed25519 key. It holds hashes and counts, never a value. The body is
 * signed in its RFC 8785 canonical form. Web Crypto only, so it runs wherever
 * the library runs.
 *
 * What a signature proves: the holder of this key issued this receipt. It does
 * not prove which code ran. That needs the key to live only inside an attested
 * runtime; see the proxy section of the README.
 */
import type { BlindResult, Kind } from './types.js';
import { VERSION } from './version.js';

/** The receipt format. 2 added `requestId` and made `returned` the hash of the blind answer. */
export const RECEIPT_FORMAT = 2;

export interface ReceiptBody {
  v: typeof RECEIPT_FORMAT;
  /** Library name and version that blinded the request. */
  lib: string;
  /** What the operator says is running, for example the SHA-256 of the deployed bundle. */
  runtime: string;
  /** ISO 8601 time the receipt was issued. */
  issuedAt: string;
  /** The caller's request id, or one the signer generated. Lets a caller tie a receipt to its own request. */
  requestId: string;
  /** SHA-256 (hex) of the JSON array of blind texts that left for the model. */
  sent: string;
  /**
   * SHA-256 (hex) of the blind answer, what the upstream returned before the
   * real values went back in. A hash of the real answer would let anyone holding
   * the receipt test guesses against a short answer.
   */
  returned: string;
  /**
   * The leak check result for what was sent: true when the leak check found no
   * hit; a `known` entry the check enforces only as written or in capitals, or a
   * two-syllable Korean one only where a word starts, is listed in the response's
   * `unenforced` and does not change it. A private value nothing found and nobody
   * listed is not covered.
   */
  leaksOk: boolean;
  /** How many spans of each kind this request replaced, every occurrence counted. Counts only. */
  replaced: Partial<Record<Kind, number>>;
}

export interface Receipt {
  body: ReceiptBody;
  /** First 16 hex characters of the SHA-256 of the raw public key. */
  keyId: string;
  /** Ed25519 signature over the canonical JSON of `body`, base64url. */
  sig: string;
}

/** A Web Crypto key, typed from the global so it works with DOM and Node typings alike. */
export type ReceiptKey = Parameters<typeof globalThis.crypto.subtle.sign>[1];

export interface ReceiptKeyPair {
  publicKey: ReceiptKey;
  privateKey: ReceiptKey;
}

const ED25519 = { name: 'Ed25519' } as const;
const enc = new TextEncoder();

const hex = (buf: ArrayBuffer): string => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function canonicalString(s: string): string {
  if (LONE_SURROGATE.test(s)) throw new Error('canonicalJson: a string holds a lone surrogate');
  // ES JSON.stringify escapes exactly as RFC 8785 asks: \b \t \n \f \r \" \\ in short form,
  // other controls as lowercase \u00xx, everything else as is.
  return JSON.stringify(s);
}

/**
 * The RFC 8785 (JSON Canonicalization Scheme) form of a JSON value, so signer
 * and verifier, in any language with a JCS library, sign the same bytes. Keys
 * are sorted by UTF-16 code units at every level, numbers are written as ES
 * `Number.prototype.toString` writes them, strings are escaped as the RFC says,
 * and there is no whitespace. Object fields that are `undefined` are left out.
 * Throws on what JSON cannot hold: a non-finite number, a lone surrogate, or a
 * value that is not null, a boolean, a number, a string, an array or an object.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalJson: a number is not finite');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return canonicalString(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error(`canonicalJson: a ${typeof value} is not JSON`);
  const obj = value as Record<string, unknown>;
  // Array.prototype.sort with no comparator orders strings by UTF-16 code units, as RFC 8785 asks.
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${canonicalString(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/**
 * SHA-256 of a string, or of a list of strings as its JSON array (so ["a", "b"]
 * and ["a\u0000b"] hash differently), as hex.
 */
export async function sha256Hex(input: string | string[]): Promise<string> {
  const text = Array.isArray(input) ? JSON.stringify(input) : input;
  return hex(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text)));
}

/** A fresh Ed25519 key pair for signing receipts. Keep the private key in the runtime's secret store. */
export async function generateReceiptKeys(): Promise<ReceiptKeyPair> {
  return (await globalThis.crypto.subtle.generateKey(ED25519, true, ['sign', 'verify'])) as ReceiptKeyPair;
}

/** An Ed25519 key as JSON Web Key. A private key also carries `d`. */
export interface ReceiptJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d?: string;
}

/** Both halves of a key pair as JWK, to store the private half as a secret and publish the public half. */
export async function exportReceiptKeys(keys: ReceiptKeyPair): Promise<{ privateJwk: ReceiptJwk; publicJwk: ReceiptJwk }> {
  const privateJwk = (await globalThis.crypto.subtle.exportKey('jwk', keys.privateKey)) as ReceiptJwk;
  const { kty, crv, x } = privateJwk;
  return { privateJwk: { kty, crv, x, d: privateJwk.d }, publicJwk: { kty, crv, x } };
}

/** The key pair from a stored private JWK (which also holds the public half), for a runtime that signs. */
export async function importReceiptKeys(privateJwk: ReceiptJwk): Promise<ReceiptKeyPair> {
  if (privateJwk.kty !== 'OKP' || privateJwk.crv !== 'Ed25519' || !privateJwk.d) throw new Error('receipt: expected an Ed25519 private JWK');
  const { kty, crv, x, d } = privateJwk;
  const privateKey = await globalThis.crypto.subtle.importKey('jwk', { kty, crv, x, d }, ED25519, true, ['sign']);
  return { privateKey, publicKey: await importReceiptPublicKey({ kty, crv, x }) };
}

/** A published public JWK, for a caller that verifies. */
export async function importReceiptPublicKey(publicJwk: ReceiptJwk): Promise<ReceiptKey> {
  if (publicJwk.kty !== 'OKP' || publicJwk.crv !== 'Ed25519') throw new Error('receipt: expected an Ed25519 public JWK');
  return globalThis.crypto.subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: publicJwk.x }, ED25519, true, ['verify']);
}

export async function receiptKeyId(publicKey: ReceiptKey): Promise<string> {
  const raw = await globalThis.crypto.subtle.exportKey('raw', publicKey);
  return hex(await globalThis.crypto.subtle.digest('SHA-256', raw)).slice(0, 16);
}

/** How many spans of each kind this `blind` call replaced, counting every occurrence. */
export function replacedCounts(result: BlindResult): Partial<Record<Kind, number>> {
  return { ...result.replaced };
}

export interface ReceiptInput {
  /** The result of the `blind` call whose texts were sent. */
  result: BlindResult;
  /** The blind answer: what the upstream returned, before `unblind` put the real values back. */
  returned: string;
  /** The caller's id for this request. Defaults to 32 random hex characters. */
  requestId?: string;
  /** What the operator says is running. */
  runtime: string;
  privateKey: ReceiptKey;
  publicKey: ReceiptKey;
  /** Defaults to now. */
  issuedAt?: Date;
}

const randomId = (): string => hex(globalThis.crypto.getRandomValues(new Uint8Array(16)).buffer);

export async function signReceipt(input: ReceiptInput): Promise<Receipt> {
  const body: ReceiptBody = {
    v: RECEIPT_FORMAT,
    lib: `@centrst/blind@${VERSION}`,
    runtime: input.runtime,
    issuedAt: (input.issuedAt ?? new Date()).toISOString(),
    requestId: input.requestId ?? randomId(),
    sent: await sha256Hex(input.result.texts),
    returned: await sha256Hex(input.returned),
    leaksOk: input.result.leaks.ok,
    replaced: replacedCounts(input.result),
  };
  const sig = await globalThis.crypto.subtle.sign(ED25519, input.privateKey, enc.encode(canonicalJson(body)));
  return { body, keyId: await receiptKeyId(input.publicKey), sig: b64url(sig) };
}

export interface VerifyOptions {
  /** The blind texts the runtime says it sent, to check against `body.sent`. */
  sent?: string[];
  /** The blind answer the runtime says came back from the upstream, to check against `body.returned`. */
  returned?: string;
  /** Runtime digests the caller accepts. */
  runtimes?: string[];
  /** The request id the caller sent, to check against `body.requestId`. */
  requestId?: string;
  /** Refuse a receipt issued more than this many milliseconds before `now`. */
  maxAgeMs?: number;
  /**
   * With `maxAgeMs`, also refuse a receipt issued more than this many
   * milliseconds after `now`, the clock skew allowed between caller and signer.
   * Defaults to 60,000. Passing it alone turns on only this check.
   */
  maxSkewMs?: number;
  /** The time `maxAgeMs` and `maxSkewMs` count from. Defaults to the current time. */
  now?: Date | number;
}

/** The clock skew `verifyReceipt` allows for an `issuedAt` after `now` when no `maxSkewMs` is given. */
const DEFAULT_MAX_SKEW_MS = 60_000;

/**
 * True when the signature is valid for `publicKey`, the key id matches, and
 * every check passed in `opts` holds. A freshness check (`maxAgeMs` or
 * `maxSkewMs`) refuses a receipt dated too far before or after `now`. Never
 * throws on a malformed receipt.
 */
export async function verifyReceipt(receipt: Receipt, publicKey: ReceiptKey, opts: VerifyOptions = {}): Promise<boolean> {
  try {
    if (!receipt || receipt.body?.v !== RECEIPT_FORMAT) return false;
    if (receipt.keyId !== (await receiptKeyId(publicKey))) return false;
    const sig = unb64url(receipt.sig);
    if (!sig) return false;
    if (!(await globalThis.crypto.subtle.verify(ED25519, publicKey, sig, enc.encode(canonicalJson(receipt.body))))) return false;
    if (opts.sent && (await sha256Hex(opts.sent)) !== receipt.body.sent) return false;
    if (opts.returned !== undefined && (await sha256Hex(opts.returned)) !== receipt.body.returned) return false;
    if (opts.runtimes && !opts.runtimes.includes(receipt.body.runtime)) return false;
    if (opts.requestId !== undefined && opts.requestId !== receipt.body.requestId) return false;
    if (opts.maxAgeMs !== undefined || opts.maxSkewMs !== undefined) {
      const issued = Date.parse(receipt.body.issuedAt);
      const now = opts.now === undefined ? Date.now() : +opts.now;
      const skew = opts.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
      if (!Number.isFinite(issued) || !Number.isFinite(now) || !(skew >= 0) || issued - now > skew) return false;
      if (opts.maxAgeMs !== undefined && (!(opts.maxAgeMs >= 0) || now - issued > opts.maxAgeMs)) return false;
    }
    return true;
  } catch {
    return false;
  }
}
