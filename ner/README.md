# @centrst/blind-ner

An optional multilingual NER detector for `@centrst/blind`. It finds people, organizations and places that the pattern detectors cannot, using GLiNER (`gliner_multi-v2.1`) on ONNX Runtime, in process. Inference is fully local. The only network use is the one-time model download, which is a separate script.

This package is a prototype and private for now: build it from this repository, it is not on npm. The core library stays at zero runtime dependencies.

## Use

```sh
pnpm install
pnpm ner:download          # 1.1 GB, pinned revision, SHA-256 checked, once
```

The package has no published build. Inside this workspace, build the core and then the package, and import from it:

```sh
pnpm build && pnpm build:ner
```

```ts
import { GlinerModel, blindWithNer } from '@centrst/blind-ner';
import { unblind } from '@centrst/blind';

const model = await GlinerModel.load('ner/models/gliner_multi-v2.1');
const res = await blindWithNer(model, [email], { known, seed });
const back = unblind(answer, res.mapping).text;
```

`blindWithNer` runs the model first, because `blind` finds spans synchronously and a model call is async, then calls `blind` with the detector in `detectors`. To keep control of the call, use `createNerDetector(model).prepare(texts)`, which returns a plain `Detector`.

Options: `threshold` (default 0.3), `labels`, `priority` (default 50, below every pattern detector and `known`), `propagate` (default true, marks later bare mentions of a name already found).

## Platforms

The model runs on onnxruntime-node 1.31.1, whose npm package ships native binaries for macOS on arm64 (Apple silicon), Linux on x64 and arm64, and Windows on x64 and arm64 (the `bin/napi-v6/` folders listed by `npm pack onnxruntime-node@1.31.1 --dry-run`). There is no binary for macOS on x64, so `GlinerModel.load` fails on an Intel Mac. The package imports onnxruntime-node only when a model loads, so the rest of it still loads there, and `pnpm test:ner` runs the stub tests and skips the model tests with a message.

## Numbers

Prototype numbers: this package is built from this repository and is not on npm.

Synthetic corpus, 379 files, strict recall (the annotated value is gone from the output) and same-kind precision, threshold 0.3, `gliner_multi-v2.1` fp32. Before is `blind` alone. Method and caveats are in [TESTING.md](../TESTING.md) section 9. Reproduce with `pnpm ner:eval`.

| Kind | Bare recall | Bare precision | Known recall | Known precision |
| --- | --- | --- | --- | --- |
| person | 67.3 to 98.7 | 95.5 to 96.6 | 98.7 to 99.9 | 96.9 to 96.6 |
| org | 29.9 to 97.7 | 97.8 to 92.7 | 51.8 to 99.7 | 98.8 to 93.0 |
| place | 0 to 99.4 | 100 to 88.6 | 0.6 to 99.4 | 100 to 89.1 |
| other kinds | unchanged | unchanged | unchanged | unchanged |
| all kinds | 82.1 to 99.4 | 98.4 to 97.9 | 91.7 to 99.9 | 98.6 to 97.9 |

Round trips: 379 of 379 exact in both modes. In bare mode the detector brings English person recall to 98.4, Spanish to 99.0 and mixed to 98.7. Spanish is a little lower on org (96.8 against 100 for English) and place (98.7 against 100). The all-kinds precision row comes from the same scorer in `pnpm bench:presidio`.

Speed depends on the machine and the model file, and each number below names its setup, as the [main README](../README.md#measured) does. The fp32 model on the native ONNX Runtime addon, on CPU, took 47 ms per email on an Apple M4 Max with onnxruntime-node 1.30.0, where the process peaks at about 3.2 GB while it loads ([docs/BROWSER-NER.md](../docs/BROWSER-NER.md)); 49 ms per corpus email and 107 ms per Gretel document on the arm64 Mac that ran the benchmarks, chip not recorded ([RESULTS-llmguard-gretel.md](../scripts/bench/RESULTS-llmguard-gretel.md)); and 175 ms per email in the first measurement, on an older M-series Mac whose chip was not recorded. The core alone takes under a millisecond.

The default file is `onnx/model.onnx` (fp32). The published int8 export finds almost nothing on WASM and loses org and place recall on native ONNX Runtime. A re-quantized variant that keeps fp32 recall is described in [docs/BROWSER-NER.md](../docs/BROWSER-NER.md).

## Model and license

`gliner_multi-v2.1` by Urchade Zaratiana, Apache 2.0, in the ONNX export published by `onnx-community`. The download script pins revision `6ddaeb94` of that export and checks every file against a SHA-256. The weights are not part of this repository and are not redistributed; `models/` is ignored by git. This package's own code is MIT, like the core.

The licence is per release, so check it before you swap models. `gliner_multi-v2.1` is Apache-2.0 on its [upstream card](https://huggingface.co/urchade/gliner_multi-v2.1). The older `urchade/gliner_multi` release is CC-BY-NC-4.0 on [its card](https://huggingface.co/urchade/gliner_multi) and must not be swapped in for commercial use. The `onnx-community` export carries no licence field of its own: its [card at the pinned revision](https://huggingface.co/onnx-community/gliner_multi-v2.1/blob/6ddaeb9413b0e71ad8457da1aab378a165b24058/README.md) names `urchade/gliner_multi-v2.1` as its base model, so it is distributed as a conversion of the Apache-2.0 upstream. Neither repository has a `LICENSE` file at the pinned revisions. The download script saves the export's card as `models/gliner_multi-v2.1/README.md` and the upstream card, revision `443d26d6`, as `models/gliner_multi-v2.1/upstream/README.md`, checks both against a SHA-256 like the weights, and reports the two missing `LICENSE` files as absent. Because neither repository ships the licence text, the script then copies the Apache-2.0 text tracked in [licenses/APACHE-2.0.txt](licenses/APACHE-2.0.txt) (checked against its SHA-256) to `models/gliner_multi-v2.1/LICENSE`, and writes `models/gliner_multi-v2.1/PROVENANCE.md`, which lists every file with its source URL, revision and hash, records the absent `LICENSE` files, and quotes the upstream card's `license: apache-2.0` line as the source of the licence claim. Every third-party component is listed in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md).
