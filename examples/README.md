# Examples

Put blind at the start of a request when your service needs to process private text. The shared handler rewrites the text before forwarding it, then restores the real values in the answer. Each runtime example uses [shared/handler.ts](shared/handler.ts), which works anywhere web `Request` and `Response` are available.

| File | Runtime | Run it |
| --- | --- | --- |
| [workers.ts](workers.ts) | Cloudflare Workers | `wrangler deploy examples/workers.ts`, with `UPSTREAM_URL` set |
| [deno.ts](deno.ts) | Deno, Deno Deploy | `UPSTREAM_URL=... deno run --allow-net --allow-env examples/deno.ts` |
| [lambda.ts](lambda.ts) | AWS Lambda (function URL or HTTP API) | bundle it with the library, handler `handler`, Node 22 runtime |

All three read the same settings:

| Variable | Meaning |
| --- | --- |
| `CALLER_TOKEN` | Required. Callers send `Authorization: Bearer <CALLER_TOKEN>`, compared in constant time. When it is unset, every request gets a 401, so an example never runs open. |
| `UPSTREAM_URL` | Your service. It receives `{ "texts": [...] }` with blind text only, and answers with `{ "text": "..." }` or plain text. |
| `UPSTREAM_TOKEN` | Optional bearer token sent to `UPSTREAM_URL`. |
| `RECEIPT_KEY` | Optional. An Ed25519 private JWK from `pnpm receipt:keys`. Turns on proxy mode: every answer carries a signed receipt. |
| `RUNTIME_DIGEST` | Optional. What callers pin, such as the SHA-256 of the deployed bundle. |

The shared handler bounds every request. A body over 1 MB gets a 413 (`maxBodyBytes`), an upstream call that takes longer than 10 seconds is aborted with a 504 (`timeoutMs`), a bad `known` entry gets a 400 that names its index, and an error inside `blind` or `unblind` gets a 500 with a fixed message and none of the input. Set the options where the adapter calls `createBlindHandler`, and pass your own `authenticate(request)` there to use something other than a bearer token.

In proxy mode, the receipt's `returned` is the hash of the blind answer the upstream gave, which the response also returns as `returned`. The receipt also carries the caller's `requestId` (or a random one) and `issuedAt`, so a caller can refuse a replayed receipt with `verifyReceipt(..., { requestId, maxAgeMs })`. The body is signed in its RFC 8785 canonical form.

See [docs/PROXY.md](../docs/PROXY.md) for the request and response format, the limits and receipt verification, with a Python verifier.

The examples import `@centrst/blind` by name, as your code would. In this repository, that name points at `src/`. `test/examples.test.ts` runs every example against a stub upstream and checks that only blind text crosses, real values come back, a leak stops forwarding, receipts verify, and a missing credential, an oversized body, a bad `known` entry, a slow upstream and an internal error each get their status without echoing input.

Your upstream can be a model call, a ticket classifier, a search index or a log pipeline. It receives the blind text so it can process it without receiving the values that were rewritten.
