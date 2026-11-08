/**
 * AWS Lambda behind a function URL or an API Gateway HTTP API (payload 2.0):
 * blind as the first layer in front of your own service.
 *
 *   environment: UPSTREAM_URL, CALLER_TOKEN (required: callers send Authorization: Bearer <it>;
 *                unset, every request gets a 401), UPSTREAM_TOKEN (optional),
 *                RECEIPT_KEY and RUNTIME_DIGEST (optional, proxy mode; keep the key in Secrets Manager)
 *
 * The handler turns the event into a web `Request`, runs the shared handler and
 * turns the `Response` back into what Lambda expects. Node 22 runtime or newer.
 */
import { importReceiptKeys, type ReceiptJwk } from '@centrst/blind';
import { bearerToken, createBlindHandler, forwardJson, publicKeyResponse, type Signer } from './shared/handler.js';

/** The parts of a function URL or HTTP API v2 event this handler reads. */
export interface HttpEvent {
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function build(env: Record<string, string | undefined>): Promise<(request: Request) => Promise<Response>> {
  return (async () => {
    const upstream = env.UPSTREAM_URL;
    if (!upstream) throw new Error('UPSTREAM_URL is not set');
    const signer: Signer | undefined = env.RECEIPT_KEY
      ? { keys: await importReceiptKeys(JSON.parse(env.RECEIPT_KEY) as ReceiptJwk), runtime: env.RUNTIME_DIGEST ?? 'unpinned' }
      : undefined;
    const handle = createBlindHandler({ authenticate: bearerToken(env.CALLER_TOKEN), forward: forwardJson(upstream, env.UPSTREAM_TOKEN), signer });
    return (request: Request) => {
      if (new URL(request.url).pathname === '/.well-known/blind-receipt-key') {
        return signer ? publicKeyResponse(signer) : Promise.resolve(new Response('not in proxy mode', { status: 404 }));
      }
      return handle(request);
    };
  })();
}

/** Base64 to UTF-8 text. `atob` alone gives one character per byte, which mangles anything outside ASCII. */
function fromBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

/** A Lambda handler built from `env`. The keys are imported once, on the first event. */
export function createLambdaHandler(env: Record<string, string | undefined>): (event: HttpEvent) => Promise<HttpResult> {
  let handle: Promise<(request: Request) => Promise<Response>> | undefined;
  return async (event) => {
    handle ??= build(env);
    const body = event.body === undefined ? undefined : event.isBase64Encoded ? fromBase64(event.body) : event.body;
    const headers = new Headers();
    for (const [k, v] of Object.entries(event.headers ?? {})) if (v !== undefined) headers.set(k, v);
    const request = new Request(`https://lambda.invalid${event.rawPath ?? '/'}`, {
      method: event.requestContext?.http?.method ?? 'POST',
      headers,
      body,
    });
    const response = await (await handle)(request);
    return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: await response.text() };
  };
}

let fromEnvironment: ((event: HttpEvent) => Promise<HttpResult>) | undefined;

/** The entry point Lambda calls as `handler(event, context)`. Settings come from the function's environment. */
export function handler(event: HttpEvent, _context?: unknown): Promise<HttpResult> {
  fromEnvironment ??= createLambdaHandler(process.env);
  return fromEnvironment(event);
}
