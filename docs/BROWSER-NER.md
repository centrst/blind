# NER in the browser: measured, not packaged yet

blind's core runs in browsers. Its name, org and place detection at full strength needs the GLiNER model in `@centrst/blind-ner`, which today runs on Node through the native ONNX Runtime addon. This page records whether the same model can run in a browser, and what a web entry would need. The short answer: yes, on a desktop in Chromium, with a re-quantized model. Nobody has packaged it yet. `@centrst/blind-ner` is a prototype built from this repository, not on npm.

## Results

Measured on 2026-10-24 on one machine (Apple M4 Max, 64 GB, macOS 27.0.1), onnxruntime-node and onnxruntime-web 1.30.0, headless Chrome for Testing 156, over the 379 corpus files and 52 adversarial cases. The scorer was the one `pnpm ner:eval` uses, and it reproduced the reference numbers exactly before any variant was tried. Load times are from a local server. Recall and precision are bare mode, in percent, threshold 0.3, and every row round-tripped 379 of 379 files.

| Model | Size | Runtime | Ready in | ms per email | Peak memory | Person | Org | Place |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fp32 (today's model) | 1104 MiB | Node, native | 0.75 s | 47 | 3.2 GB | 98.73 / 90.34 | 97.71 / 92.11 | 99.43 / 88.64 |
| fp32 | 1104 MiB | Chromium, WASM, 8 threads | 2.3 s | 176 | 6.9 GB | same | same | same |
| fp32 | 1104 MiB | Chromium, WebGPU | 2.5 s | 74 | 9.0 GB | same | same | same |
| fp16 | 553 MiB | Chromium, WebGPU | 1.7 s | 34 | 4.4 GB | 98.73 / 90.34 | 97.71 / 92.10 | 98.28 / 88.00 |
| **wo8m-gu8** | **349 MiB** | Node, native | 0.56 s | 64 | 1.3 GB | 98.73 / 90.34 | 97.71 / 91.81 | 99.43 / 88.51 |
| **wo8m-gu8** | **349 MiB** | Chromium, WASM, 8 threads | 1.6 s | 193 | 3.0 GB | same | same | same |
| **wo8m-gu8** | **349 MiB** | Chromium, WebGPU | 1.7 s | 68 | 3.5 GB | same | same | same |
| published int8 | 333 MiB | Chromium, WASM | 1.6 s | 181 | 2.9 GB | 7.81 / 78.69 | 3.52 / 100 | 0 / 100 |
| gliner-x-small, quantized | 165 MiB | Chromium, WASM, 8 threads | 0.96 s | 101 | 2.0 GB | 99.72 / 87.48 | 99.24 / 74.11 | 100 / 82.27 |

The detector and scorer behind every row are those of `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Every ms per email above is from this Apple M4 Max with ONNX Runtime 1.30.0, in the runtime its row names. The README's speed paragraph lists these beside the GLiNER timings from other machines, each with its setup.

`wo8m-gu8` keeps the matrix weights in int8 and the 733 MB embedding table in uint8, with activations in floating point. It is a third of the fp32 size (300 MB gzipped), finds exactly what fp32 finds on every kind, loses at most 0.3 points of precision, and scores the same on native Node, WASM and WebGPU. On a second visit it comes back from the Cache API in about 0.1 s and the session is ready in 1.2 s.

What did not work:

- **The published int8 export collapses on WASM.** It finds 8% of people. It works on native ONNX Runtime on ARM, so the collapse depends on the integer kernels; x86 was not tested.
- **Quantizing activations at run time costs 11.5 points of org recall.** Weight-only quantization does not.
- **4-bit costs 1 to 2.5 points of recall.**
- **gliner-x-small over-tags.** Its org precision stays about 13 points lower at every threshold tried.
- **onnxconverter-common's fp16 output fails to load** in ONNX Runtime 1.30. ORT's own converter works.

## What a web entry would need

1. **An entry point, `@centrst/blind-ner/web`.** `ner/src/gliner.ts` would split into a runtime-free core and two loaders: native ONNX Runtime with file reads for Node, and onnxruntime-web with URLs or bytes for the browser. The detector itself needs no change. The tokenizer package is pure JavaScript and runs in the browser as it is. onnxruntime-web should be an optional dependency, so Node users don't install both runtimes.
2. **A model to serve.** onnx-community does not publish `wo8m-gu8`. [ner/scripts/convert-model.py](../ner/scripts/convert-model.py) builds it deterministically from the fp32 file. The app would host it on its own origin and check its SHA-256 with `crypto.subtle` before use.
3. **Caching.** The Cache API, written in the background on the first visit. Quota and eviction were not tested.
4. **Threads.** Multithreaded WASM needs a cross-origin isolated page (COOP and COEP headers). Without isolation it runs on one thread, about 1.3 s per email. Set `numThreads` to 8: ORT's default of 4 is nearly twice as slow. Self-host the 14 MB `.wasm` runtime instead of loading it from a CDN.
5. **A Web Worker.** The measurements ran on the page's main thread, where a 200 ms call blocks the interface.
6. **Memory.** Release the model bytes once the session exists, and pick the variant by device: WebGPU where available, WASM otherwise.
7. **The claims.** The Node package never touches the network after the one-time download (C16). A web entry fetches the model at run time, so it needs its own wording, such as "fetches only the configured model URL and never sends text".

## Not measured

Firefox and Safari, phones and machines with 8 GB or less, x86, a real network download (first visit means a 300 MB transfer), a page without cross-origin isolation, Deno and edge runtimes (their isolates usually cap memory well below 3 GB), inference inside a Web Worker, and memory after load (only peaks were recorded).

The measurements ran against the core as it was at commit 02ac680, before names found once were also found again bare. That change runs after the model and affects all variants the same way, so the comparison between variants holds. The absolute numbers in this table are a little different from `pnpm ner:eval` on the current core.
