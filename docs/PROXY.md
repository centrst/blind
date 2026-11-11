# Proxy mode and signed receipts

Proxy mode puts blind in a shared service between your callers and the service that processes their text. Callers send private text to the proxy. It rewrites that text, stops if the leak check finds a value that remains (one blind found, or the caller gave in `known` or `deny`), forwards the blind copy, and restores the real values in the answer. With a signing key configured, each answer carries a receipt signed by the proxy's key.

Install the core from npm as described in [README.md](../README.md#install). The proxy handler and runtime adapters are source examples in this repository, not a published proxy service.

Use proxy mode when callers cannot run JavaScript, when one team should maintain the deny list and known values for everyone, or when you want one place to rewrite private text before it is forwarded.

The code is in [examples/shared/handler.ts](../examples/shared/handler.ts), with adapters for [Cloudflare Workers](../examples/workers.ts), [Deno](../examples/deno.ts) and [AWS Lambda](../examples/lambda.ts). The tests in `test/examples.test.ts` run all of them against a stub upstream (C24, C25, C33).

## Who may call, and the limits

The handler is not an open relay. It forwards with your upstream credential, so it refuses every request that does not pass its `authenticate` check, and the option is required. The adapters use `bearerToken(CALLER_TOKEN)`: a caller sends `Authorization: Bearer <CALLER_TOKEN>`, the token is compared in constant time (both sides are hashed with SHA-256, then every byte is compared), and when `CALLER_TOKEN` is unset or empty every request gets a 401. To use mTLS, a signed JWT or your platform's identity instead, pass your own `authenticate(request)` that resolves `true` for a caller you accept. A check that throws counts as a refusal.

Each request is also bounded:

| Limit | Default | Option | Past it |
| --- | --- | --- | --- |
| Body size | 1,000,000 bytes | `maxBodyBytes` | 413. The body is read as a stream and reading stops at the limit, with or without a `content-length`. |
| Upstream time | 10,000 ms | `timeoutMs` | 504. `forward` gets an `AbortSignal` that fires at the limit, and `forwardJson` passes it to `fetch`. A `forward` that ignores the signal still stops the request. |
| A `known` value | 1,000 characters | none | 400 |

Every `known` entry must be an object with `kind` one of `person`, `org`, `email`, `domain`, `phone`, `place`, `id` and a `value` that is a string with something other than spaces in it, at most 1,000 characters long. A bad entry gets `400 { "error": "known", "index": 2, ... }`, which names the entry by its index and never repeats its value.

`blind`, `unblind` and signing run inside one guarded path. If any of them throws, the answer is `500 { "error": "internal", "message": "the request could not be processed" }`. Their own error messages can quote the input, so none of them goes out.

## Request and response

```
POST /
{ "texts": ["..."], "known": [{ "kind": "person", "value": "Ana Ruiz" }], "deny": ["Project Falcon"],
  "mapping": <from the previous turn, optional>, "returnMapping": true,
  "replaceWith": "fake" | "placeholder" | "random", "requestId": "<yours, optional>" }
Authorization: Bearer <CALLER_TOKEN>

200
{ "answer": "...", "invented": ["..."], "sent": ["<the blind texts that left>"],
  "returned": "<the blind answer the upstream gave>", "unenforced": [{ "kind": "person", "index": 0, "reason": "stop-word-part" }],
  "mapping": <when returnMapping>, "receipt": { "body": {...}, "keyId": "...", "sig": "..." } }

422  { "error": "leak", "hits": [{ "kind": "person", "textIndex": 0, "offset": 54 }], "unenforced": [] }   nothing was forwarded
400  bad body, bad known entry (by index), bad mapping, or a replaceWith the mapping was not made with
401  no valid credential    405  not POST    413  body over the limit
500  blind, unblind or signing failed    502  the downstream call failed    504  the downstream call timed out
```

`requestId`, when you send it, is 1 to 128 letters, digits, `.`, `_`, `:` or `-`. It goes into the receipt so you can tie the receipt to your request. Do not put private values in it.

Error bodies and log lines contain no values. Do not log request bodies or mappings in your own code either. A mapping holds every real value in the conversation.

`sent` is the blind copy exactly as it was forwarded, so callers can show and store it as evidence of exactly what left. Every value blind found or was given in `known` and `deny` is replaced in it, except the lower-case copy of a `known` value made only of stop words (`al` for a known `Al`) or of a part on the stop list that a full name writes capitalised (`al` for a known `Al Brenner` in Spanish text) or of a one-letter part of a full name (`o` for a known `O Li`), which is an ordinary word, and a copy of a two-syllable Korean `known` value inside a longer word (`지원` in `우리팀지원님`), which is matched only where a word starts. `unenforced` names each such entry by its index in the request's `known`, its kind and its reason (`stop-word`, `stop-word-part`, `one-letter-part` or `hangul-inside-word`), never its value, in the 200 and the 422 body alike and whether or not the text writes such a copy, so a caller can send that entry with `replaceWith: "placeholder"` or in `deny` instead. It never fails the leak check and `leaksOk` does not count it. A private value nothing found and nobody listed went out as written. `returned` is the upstream's answer before the real values went back in.

For a conversation, request the mapping with `returnMapping`, keep it on your side and send it back on the next turn. The proxy then needs no state. `replaceWith` picks what found values become (see the README's [Fakes, placeholders or random values](../README.md#fakes-placeholders-or-random-values)). The handler's own `replaceWith` option is the default for a new conversation. A continued one keeps its mapping's mode, and a request that asks for another gets a 400. The mapping holds the same real values the caller already sends, so protect it as you protect the request.

The handler's own `known` entries are the operator's, not the caller's. `blind` gives a `known` value a pair only when some text of the conversation writes it (for a person, each word it writes), so an operator entry the caller's text does not contain reaches no response body: not the mapping, `sent`, `returned` or `answer`, and not an error body, and an upstream that names every fake there is gets none of them back in the answer (C33). An entry the caller's text does contain is replaced as usual and its pair is in the mapping, since the caller wrote that value. A caller can still test a guess that way: it sees which words of its own text were replaced, so an operator list does not hide whether a value the caller already knows is on it.

A mapping that comes back from a caller is checked before use: the factor must be between 0.6 and 1.6 and at least 5% away from 1, the shift a nonzero whole number of weeks up to 70 days, and no name, org, place, phone, IBAN or id pair may map a value to itself. A `placeholder` or `random` mapping scales and shifts nothing, so it must hold a factor of exactly 1 and a shift of 0. Every pair in a `placeholder` mapping must be a placeholder of its own kind, and no pair in a `random` mapping may map a value, amounts included, to itself. A mapping that breaks any of these gets a 400 that names the field. A mapping with `keep` gets a 400 too, since the handler never makes one and it would leave those kinds as written. That stops a caller from switching scaling, shifting or replacement off. It does not stop a caller from choosing its own fakes. If your upstream must only ever see fakes the proxy chose, keep mappings on the proxy (keyed by a conversation id) or sign them, and don't accept them from callers.

## The receipt

| Field | Meaning |
| --- | --- |
| `v` | Format version, 2. Version 1 had no `requestId` and hashed the real answer in `returned`. `verifyReceipt` accepts version 2 only. |
| `lib` | The library and version that blinded the text, `@centrst/blind@0.2.0`. |
| `runtime` | What the operator says is running. Use the SHA-256 of the deployed bundle. |
| `issuedAt` | ISO 8601 time. |
| `requestId` | The caller's `requestId`, or 32 random hex characters from Web Crypto when the caller sent none. |
| `sent` | SHA-256 of the JSON array of blind texts that left, so `["a", "b"]` and `["a\u0000b"]` differ. |
| `returned` | SHA-256 of the blind answer: what the upstream returned, before the real values went back in. |
| `leaksOk` | The leak check result for what was sent: true when the leak check found no hit; a `known` entry the check enforces only as written or in capitals, or a two-syllable Korean one only where a word starts, is listed in the response's `unenforced` and does not change it. It says nothing about a private value that nothing found and nobody listed. |
| `replaced` | How many values of each kind this request replaced, every occurrence counted, nothing from earlier turns. Counts only. |

`sig` is an Ed25519 signature over the UTF-8 bytes of the body in its [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) canonical form (JSON Canonicalization Scheme): object keys sorted by UTF-16 code units at every level, no whitespace, strings escaped as the RFC says, numbers written as ES `Number.prototype.toString` writes them. `canonicalJson` implements it and is tested against the RFC's examples (C35). `keyId` is the first 16 hex characters of the SHA-256 of the raw public key. A receipt holds hashes and counts, never a value (C23).

### Why `returned` hashes the blind answer

A receipt is meant to be shown and stored, so it must not let its holder learn real values. A hash of the real answer would: when the answer is short ("Yes, Ana Ruiz paid 247,80 €"), anyone holding the receipt can hash guesses until one matches. The blind answer holds the fakes in place of every value blind replaced, and the upstream has already seen it, so its hash tells nobody anything new. A keyed hash of the real answer would hide it too, but a caller could not check it without the key. The caller can check the blind answer: the handler returns it as `returned`, and running `unblind` on it with the mapping gives `answer`.

## Setting up the key

```
pnpm receipt:keys
```

This prints a fresh key pair and writes nothing to disk. Store the private JWK as a secret (`RECEIPT_KEY` in the examples) and set `RUNTIME_DIGEST` to the SHA-256 of the bundle you deploy. All three example adapters serve the public half and the runtime digest at `/.well-known/blind-receipt-key`.

To rotate, deploy a new key. It gets a new `keyId`, and callers add it to the keys they accept.

## Verifying, as a caller

Fetch the public key once, check it out of band (your operator publishes it), and pin it along with the runtime digests you accept. Then check every answer:

```ts
import { importReceiptPublicKey, verifyReceipt } from '@centrst/blind';

const key = await importReceiptPublicKey(pinnedJwk);
const requestId = crypto.randomUUID();
const res = await fetch(proxyUrl, {
  method: 'POST',
  headers: { authorization: `Bearer ${callerToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ texts: [email], requestId }),
});
const { answer, sent, returned, receipt } = await res.json();

const ok = await verifyReceipt(receipt, key, { sent, returned, requestId, maxAgeMs: 60_000, runtimes: [pinnedDigest] });
if (!ok || !receipt.body.leaksOk) throw new Error('unverified answer');
```

`requestId` and `maxAgeMs` stop a replay (C34). An old receipt for an identical request has the same `sent` and `returned` hashes, so those alone cannot tell it from a fresh one. With your own fresh `requestId`, a receipt for any other request fails, and `maxAgeMs` refuses a receipt whose `issuedAt` is more than that many milliseconds before now (pass `now` to count from another time, as the tests do). It also refuses one whose `issuedAt` is more than `maxSkewMs` after now, so a receipt dated in the future does not stay fresh (C45). `maxSkewMs` is the clock skew you allow between you and the proxy, 60,000 ms by default; pass it to allow more or less. Passed alone, it checks only the future side.

If the receipt is malformed, `verifyReceipt` returns `false` instead of throwing.

### Verifying in another language

Any language with Ed25519 and SHA-256 can verify a receipt: rebuild the body's RFC 8785 bytes, check the signature over them with the public key, and compare the hashes. A receipt body holds only ASCII keys, strings, whole numbers and booleans, so a JSON serializer with sorted keys and no whitespace produces the RFC 8785 bytes for it. A general JCS library works too. In Python, with the `cryptography` package:

```python
import base64, hashlib, json
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

def unb64url(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def canonical(value):
    # RFC 8785 for what a receipt body holds: ASCII keys, strings, integers, booleans.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

def sha256_hex(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def verify_receipt(receipt, public_jwk, sent=None, returned=None, request_id=None):
    raw = unb64url(public_jwk["x"])
    body = receipt["body"]
    if body.get("v") != 2 or receipt["keyId"] != hashlib.sha256(raw).hexdigest()[:16]:
        return False
    try:
        Ed25519PublicKey.from_public_bytes(raw).verify(unb64url(receipt["sig"]), canonical(body))
    except InvalidSignature:
        return False
    if sent is not None and sha256_hex(json.dumps(sent, separators=(",", ":"), ensure_ascii=False)) != body["sent"]:
        return False
    if returned is not None and sha256_hex(returned) != body["returned"]:
        return False
    if request_id is not None and request_id != body["requestId"]:
        return False
    return True
```

Python's `sort_keys` orders by code point, not UTF-16 code unit. The two differ only for keys outside the Basic Multilingual Plane, which a receipt never has. Add the age and skew checks on `issuedAt` the same way. The fixture receipt in `test/receipt.test.ts`, signed with the RFC 8032 test key, verifies with this function: the test reads the function from this page and runs it with `python3` when `python3` and `cryptography` are installed, and skips with a message saying which is missing otherwise.

The receipt binds `sent`, so you can check what left by searching it for your own names, client domains or anything else you know is private. The proxy cannot later claim it sent something else.

## What a receipt proves, and what it doesn't

A valid receipt shows that whoever holds the private key issued it and that its body is unchanged. It binds the `sent` you hold to what the key holder committed to sending, the blind answer you hold to what it says came back, and both to your request id and the time it was issued.

It does not prove which code ran. `runtime` is the operator's own claim. A signature cannot rule out that the operator also sent the real text somewhere else, or that the key was copied to another machine. On Cloudflare Workers, Deno Deploy and AWS Lambda, the code does not get an attestation from the platform, so a receipt identifies the operator's key, not the code.

This is enough when the operator is you, or someone you already trust with the text. For a hosted proxy run by someone else, callers need proof that the key exists only inside a known build. The path to that is not built yet:

1. **Reproducible bundle.** The same source produces the same bytes, so anyone can rebuild a release and get the digest the operator publishes.
2. **Key born in an attested environment.** The proxy runs in an isolated environment that can produce a signed measurement of the code it booted, such as an AWS Nitro Enclave or a confidential VM (AMD SEV-SNP, Intel TDX). The signing key is generated inside it and never leaves it.
3. **Attestation bound to the key.** The environment's attestation document includes the public key and the measurement of the build. The proxy serves it next to the key, and the caller checks three things: the platform's signature on the document, that the measurement matches the published digest, and that the key in the document is the one signing receipts.
4. **Optional transparency log.** Each release digest and key goes into an append-only public log, so a quiet swap would show.

With those in place, the same `verifyReceipt` call plus one attestation check proves the answer came from the published code. Until then, say "signed by our key", not "proved to be our code".
