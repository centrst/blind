# @centrst/blind-ner

An optional multilingual NER detector for `@centrst/blind`. It finds people, organizations and places that the pattern detectors cannot, using GLiNER (`gliner_multi-v2.1`) on ONNX Runtime, in process. Inference is fully local. The only network use is the one-time model download, which is a separate command.

The core `@centrst/blind` is [available on npm](https://www.npmjs.com/package/@centrst/blind). This package is a prototype, built from this repository, not on npm. It is packaged for npm and waits for its first release, which [RELEASING.md](https://github.com/centrst/blind/blob/main/RELEASING.md#the-ner-package) describes. The core library stays at zero runtime dependencies.

## Install

After the first release:

```sh
npm install @centrst/blind @centrst/blind-ner
npx blind-ner-download ./models/gliner_multi-v2.1   # 1.1 GB, pinned revision, SHA-256 checked, once
```

The core is a peer dependency, so the detector uses the copy of `@centrst/blind` your project installs. Each version of this package names the core version it was built and tested with, as a caret range. The download command writes the weights, both model cards, the Apache-2.0 licence text and a `PROVENANCE.md` into the directory you name, and a second run keeps the files that are already there and correct. Nothing else in the package uses the network.

`onnxruntime-node` has an install script. On Linux x64 it downloads the CUDA and TensorRT providers, which this package never loads, since it runs the model on the CPU. Set `ONNXRUNTIME_NODE_INSTALL=skip` in the environment of `npm install` to skip that download. The CPU runtime ships inside the npm package on every supported platform.

Until the first release, build it in this repository: `pnpm install`, `pnpm ner:download` (the same command, writing to `ner/models/gliner_multi-v2.1`), then `pnpm build && pnpm build:ner`.

## Use

```ts
import { GlinerModel, blindWithNer } from '@centrst/blind-ner';
import { unblind } from '@centrst/blind';

const model = await GlinerModel.load('./models/gliner_multi-v2.1');
const res = await blindWithNer(model, [email], { known, seed });
const back = unblind(answer, res.mapping).text;
```

`blindWithNer` runs the model first, because `blind` finds spans synchronously and a model call is async, then calls `blind` with the detector in `detectors`. To keep control of the call, use `createNerDetector(model).prepare(texts)`, which returns a plain `Detector`.

Options: `threshold` (default 0.3), `labels` and `priority` (default 50, below every pattern detector and `known`). A later bare mention of a person already found, such as the first name alone after the full name, is always replaced with the same person's fake.

Loading the model takes about 3.2 GB of memory at its peak, and the weights stay resident in your process.

## Platforms

The model runs on onnxruntime-node 1.31.1, whose npm package ships native binaries for macOS on arm64 (Apple silicon), Linux on x64 and arm64, and Windows on x64 and arm64 (the `bin/napi-v6/` folders listed by `npm pack onnxruntime-node@1.31.1 --dry-run`). There is no binary for macOS on x64, so `GlinerModel.load` fails on an Intel Mac. The package imports onnxruntime-node only when a model loads, so the rest of it still loads there, and `pnpm test:ner` runs the stub tests and skips the model tests with a message.

## Numbers

Prototype numbers: this package is built from this repository and is not on npm.

Measured on 11 November 2026 against core `0.2.0`, at commit `5369e57`. Synthetic corpus, 381 files, strict recall (the annotated value is gone from the output) and same-kind precision, threshold 0.3, `gliner_multi-v2.1` fp32. Before is `@centrst/blind` 0.2.0 alone. Method and caveats are in [TESTING.md](https://github.com/centrst/blind/blob/main/TESTING.md) section 9. Reproduce with `pnpm ner:eval`.

| Kind | Bare recall | Bare precision | Known recall | Known precision |
| --- | --- | --- | --- | --- |
| person | 85.1 to 99.6 | 97.1 to 96.7 | 99.3 to 99.9 | 97.1 to 96.7 |
| org | 98.2 to 98.9 | 99.2 to 93.1 | 99.7 to 100 | 99.2 to 93.2 |
| place | 0 to 99.4 | 100 to 90.2 | 0.6 to 99.4 | 100 to 90.8 |
| other kinds | unchanged | unchanged | unchanged | unchanged |
| all kinds | 93.5 to 99.8 | 98.6 to 97.9 | 97.0 to 99.95 | 98.6 to 97.9 |

Round trips: 381 of 381 exact in both modes. The all-kinds precision row comes from the same scorer in `pnpm bench:presidio`.

What the detector adds on top of core 0.2.0. On emails the core already finds most people and nearly every company from greetings, signatures, labels, titles and legal suffixes, so the detector adds mostly places, which the core has no detector for, and the people the core misses: in bare mode person recall goes from 85.1 to 99.6, org from 98.2 to 98.9 and place from 0 to 99.4. It costs 6.1 points of org precision and 0.4 of person precision. By language in bare mode, English person recall goes from 87.9 to 99.8 and Spanish from 82.6 to 99.8. English org is 99.5 to 100 and Spanish 98.2 to 98.9. Place is 0 to 100 in English and 0 to 98.7 in Spanish.

On documents the core has little to anchor on, and the detector finds most names. On the Gretel sample of 888 synthetic finance documents, 444 English and 444 Spanish, rerun on 11 November 2026 with the blind columns of `pnpm bench:gretel`, the core alone finds 22.0% of person labels, 30.4% of companies and 2.1% of addresses. With the detector it finds 79.7%, 99.8% and 98.6%. English person recall goes from 27.8% to 94.1%.

Spanish names on Gretel are a known limit. With the detector, Spanish person recall there is 69.0%, against 94.1% in English (the core alone: 17.7% and 27.8%). Part of the gap is Gretel's labelling: many of its Spanish `name` labels are not names, such as greetings, table headings and placeholders like `[Nombre del Empleado]`. On the synthetic emails Spanish and English person recall are both 99.8%.

Precision is the cost on documents. In the 24 October 2026 Gretel run, 40.1% of the detector's person spans and 29.4% of its org spans landed on a Gretel label of that kind. Gretel labels only some entities, so these numbers are a floor. The full tables are in [RESULTS-llmguard-gretel.md](https://github.com/centrst/blind/blob/main/scripts/bench/RESULTS-llmguard-gretel.md).

Speed depends on the machine and the model file, and each number below names its setup, as the [main README](https://github.com/centrst/blind/blob/main/README.md#measured) does. The fp32 model on the native ONNX Runtime addon, on CPU, took 47 ms per email on an Apple M4 Max with onnxruntime-node 1.30.0, where the process peaks at about 3.2 GB while it loads ([docs/BROWSER-NER.md](https://github.com/centrst/blind/blob/main/docs/BROWSER-NER.md)); 49 ms per corpus email and 107 ms per Gretel document on the arm64 Mac that ran the benchmarks, chip not recorded ([RESULTS-llmguard-gretel.md](https://github.com/centrst/blind/blob/main/scripts/bench/RESULTS-llmguard-gretel.md)); and 175 ms per email in the first measurement, on an older M-series Mac whose chip was not recorded. The core alone takes under a millisecond.

The default file is `onnx/model.onnx` (fp32). The published int8 export finds almost nothing on WASM and loses org and place recall on native ONNX Runtime. A re-quantized variant that keeps fp32 recall is described in [docs/BROWSER-NER.md](https://github.com/centrst/blind/blob/main/docs/BROWSER-NER.md).

## Model and license

`gliner_multi-v2.1` by Urchade Zaratiana, Apache 2.0, in the ONNX export published by `onnx-community`. The download command pins revision `6ddaeb94` of that export and checks every file against a SHA-256. The weights are not part of this package or its repository and are not redistributed: the command fetches them from Hugging Face into the directory you name. This package's own code is MIT, like the core.

The licence is per release, so check it before you swap models. `gliner_multi-v2.1` is Apache-2.0 on its [upstream card](https://huggingface.co/urchade/gliner_multi-v2.1). The older `urchade/gliner_multi` release is CC-BY-NC-4.0 on [its card](https://huggingface.co/urchade/gliner_multi) and must not be swapped in for commercial use. The `onnx-community` export carries no licence field of its own: its [card at the pinned revision](https://huggingface.co/onnx-community/gliner_multi-v2.1/blob/6ddaeb9413b0e71ad8457da1aab378a165b24058/README.md) names `urchade/gliner_multi-v2.1` as its base model, so it is distributed as a conversion of the Apache-2.0 upstream. Neither repository has a `LICENSE` file at the pinned revisions. In the model directory, the download command saves the export's card as `README.md` and the upstream card, revision `443d26d6`, as `upstream/README.md`, checks both against a SHA-256 like the weights, and reports the two missing `LICENSE` files as absent. Because neither repository ships the licence text, the command then copies the Apache-2.0 text this package ships in [licenses/APACHE-2.0.txt](https://github.com/centrst/blind/blob/main/ner/licenses/APACHE-2.0.txt) (checked against its SHA-256) to `LICENSE` there, and writes `PROVENANCE.md`, which lists every file with its source URL, revision and hash, records the absent `LICENSE` files, and quotes the upstream card's `license: apache-2.0` line as the source of the licence claim. Every third-party component is listed in [THIRD-PARTY-NOTICES.md](https://github.com/centrst/blind/blob/main/ner/THIRD-PARTY-NOTICES.md).
