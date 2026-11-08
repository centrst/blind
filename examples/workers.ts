/**
 * Cloudflare Worker: blind as the first layer in front of your own service.
 *
 *   wrangler secret put CALLER_TOKEN        # required: callers send Authorization: Bearer <it>; unset refuses everyone
 *   wrangler secret put UPSTREAM_TOKEN      # optional, sent to UPSTREAM_URL
 *   wrangler secret put RECEIPT_KEY         # optional, an Ed25519 private JWK: turns on proxy mode
 *   vars: UPSTREAM_URL, RUNTIME_DIGEST      # RUNTIME_DIGEST: what callers pin, e.g. the bundle's SHA-256
 *
 * POST /            blinds, forwards, unblinds (see shared/handler.ts for the body)
 * GET  /.well-known/blind-receipt-key   the public key and runtime digest, in proxy mode
 */
import { importReceiptKeys, type ReceiptJwk } from '@centrst/blind';
import { bearerToken, createBlindHandler, forwardJson, publicKeyResponse, type Signer } from './shared/handler.js';

export interface Env {
  UPSTREAM_URL: string;
  /** The bearer token callers must send. Unset, every request gets a 401. */
  CALLER_TOKEN?: string;
  UPSTREAM_TOKEN?: string;
  RECEIPT_KEY?: string;
  RUNTIME_DIGEST?: string;
}

// Keys are imported once per isolate, not per request.
let signer: Promise<Signer | undefined> | undefined;
const signerFor = (env: Env): Promise<Signer | undefined> =>
  (signer ??= env.RECEIPT_KEY
    ? importReceiptKeys(JSON.parse(env.RECEIPT_KEY) as ReceiptJwk).then((keys) => ({ keys, runtime: env.RUNTIME_DIGEST ?? 'unpinned' }))
    : Promise.resolve(undefined));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const s = await signerFor(env);
    if (new URL(request.url).pathname === '/.well-known/blind-receipt-key') {
      return s ? publicKeyResponse(s) : new Response('not in proxy mode', { status: 404 });
    }
    return createBlindHandler({ authenticate: bearerToken(env.CALLER_TOKEN), forward: forwardJson(env.UPSTREAM_URL, env.UPSTREAM_TOKEN), signer: s })(request);
  },
};
