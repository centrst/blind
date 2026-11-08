/**
 * Deno (and Deno Deploy): blind as the first layer in front of your own service.
 *
 *   CALLER_TOKEN=... UPSTREAM_URL=https://your-service.example/process deno run --allow-net --allow-env examples/deno.ts
 *
 * Callers send `Authorization: Bearer <CALLER_TOKEN>`. Without CALLER_TOKEN every request gets a 401.
 *
 * Add RECEIPT_KEY (an Ed25519 private JWK) and RUNTIME_DIGEST to run in proxy mode.
 * Import `@centrst/blind` from npm: `import { blind } from 'npm:@centrst/blind'`, or map it in deno.json.
 */
import { importReceiptKeys, type ReceiptJwk } from '@centrst/blind';
import { bearerToken, createBlindHandler, forwardJson, publicKeyResponse } from './shared/handler.js';

export async function makeHandler(env: (name: string) => string | undefined): Promise<(request: Request) => Promise<Response>> {
  const upstream = env('UPSTREAM_URL');
  if (!upstream) throw new Error('UPSTREAM_URL is not set');
  const key = env('RECEIPT_KEY');
  const signer = key ? { keys: await importReceiptKeys(JSON.parse(key) as ReceiptJwk), runtime: env('RUNTIME_DIGEST') ?? 'unpinned' } : undefined;
  const handle = createBlindHandler({ authenticate: bearerToken(env('CALLER_TOKEN')), forward: forwardJson(upstream, env('UPSTREAM_TOKEN')), signer });
  return (request) => {
    if (new URL(request.url).pathname === '/.well-known/blind-receipt-key') {
      return signer ? publicKeyResponse(signer) : Promise.resolve(new Response('not in proxy mode', { status: 404 }));
    }
    return handle(request);
  };
}

if (typeof Deno !== 'undefined' && import.meta.main) {
  Deno.serve(await makeHandler((name) => Deno?.env.get(name)));
}
