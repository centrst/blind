# Third-party notices

## The core package

The published `@centrst/blind` package has no third-party runtime code. Its `dependencies` field is empty, and everything in `dist` is compiled from this repository's `src` under the MIT licence in [LICENSE](LICENSE).

## The optional NER package

`@centrst/blind-ner` (in `ner/`) is MIT like the core, but it loads a third-party model and two third-party libraries at run time. None of them is copied into this repository. The npm packages arrive through `pnpm install`, and the model through `pnpm ner:download`, which writes to `ner/models/` (ignored by git).

### GLiNER multi v2.1, the default model

- Name: `gliner_multi-v2.1`, by Urchade Zaratiana.
- Pinned revisions: the ONNX export `onnx-community/gliner_multi-v2.1` at `6ddaeb9413b0e71ad8457da1aab378a165b24058`, and its upstream card `urchade/gliner_multi-v2.1` at `443d26d654e0324125a96bebd8e796c14ff2efe6`. Both are pinned with SHA-256 hashes in `ner/scripts/download-model.ts`.
- Licence, upstream: Apache-2.0, from the `license: apache-2.0` field of the model card, https://huggingface.co/urchade/gliner_multi-v2.1/blob/443d26d654e0324125a96bebd8e796c14ff2efe6/README.md
- Licence, export: no licence field of its own; distributed as a conversion of the Apache-2.0 upstream. Its card names `base_model: urchade/gliner_multi-v2.1`, https://huggingface.co/onnx-community/gliner_multi-v2.1/blob/6ddaeb9413b0e71ad8457da1aab378a165b24058/README.md
- `LICENSE` file: neither repository has one at its pinned revision. The download script checks that and reports both as absent.
- Licence text: the Apache-2.0 text from https://www.apache.org/licenses/LICENSE-2.0.txt, fetched once and tracked as [ner/licenses/APACHE-2.0.txt](ner/licenses/APACHE-2.0.txt), SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. The download script checks that hash and copies the text to `ner/models/gliner_multi-v2.1/LICENSE`, and writes `ner/models/gliner_multi-v2.1/PROVENANCE.md` with every file, its source, revision and hash, the two absent `LICENSE` files, and the quoted `license: apache-2.0` line of the upstream card.
- Upstream: https://huggingface.co/urchade/gliner_multi-v2.1 and https://huggingface.co/onnx-community/gliner_multi-v2.1
- Used for: person, organization and place detection in `ner/src/gliner.ts`. The download script saves both model cards beside the weights, in `ner/models/gliner_multi-v2.1/README.md` and `ner/models/gliner_multi-v2.1/upstream/README.md`.
- Not the same as older releases. `urchade/gliner_multi` (v1) is CC-BY-NC-4.0 on its card, https://huggingface.co/urchade/gliner_multi, so it is not for commercial use and must not replace v2.1.

### onnxruntime-node

- Version: 1.31.1, with its dependency `onnxruntime-common` 1.31.1.
- Licence: MIT, from the npm registry entry, https://registry.npmjs.org/onnxruntime-node/1.31.1
- Upstream: https://github.com/microsoft/onnxruntime
- Used for: running the ONNX model in process, on CPU. The package bundles prebuilt native binaries for its supported platforms. Its postinstall script, which would fetch CUDA and TensorRT providers on linux/x64, is blocked in `pnpm-workspace.yaml`. That script's own dependencies, `adm-zip` 0.6.1 (MIT) and `global-agent` 4.1.3 (BSD-3-Clause), are installed but not loaded by blind-ner.

### @huggingface/tokenizers

- Version: 0.2.0.
- Licence: Apache-2.0, from the npm registry entry, https://registry.npmjs.org/@huggingface/tokenizers/0.2.0
- Upstream: https://github.com/huggingface/tokenizers.js
- Used for: tokenizing text for the model, in pure JavaScript.

## Data and models used to train blind's own NER model

`ner/train/` fine-tunes an opt-in token-classification model, described in [ner/TRAINED.md](ner/TRAINED.md). Its weights are not in this repository. Revisions are pinned in `ner/train/sources.py`. Anyone who shares weights trained this way must carry these credits.

- Nemotron-PII, NVIDIA, revision `b70ffaf5`. CC BY 4.0, https://huggingface.co/datasets/nvidia/Nemotron-PII. Training data for both variants. Credit: *Nemotron-PII: Synthesized Data for Privacy-Preserving AI*, Amy Steier, Andre Manoel, Alexa Haushalter and Maarten Van Segbroeck, NVIDIA, 2025, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
- GeoNames. CC BY 4.0, https://www.geonames.org/about.html. Town names for the training gazetteer in `ner/train/gazetteer.py`. Credit: "Towns: GeoNames (https://www.geonames.org), CC BY 4.0."
- Wikidata. CC0 1.0, https://www.wikidata.org/wiki/Wikidata:Licensing. Institution names and Spanish municipalities for the same gazetteer.
- microsoft/mdeberta-v3-base, revision `a0484667`. MIT, https://huggingface.co/microsoft/mdeberta-v3-base. The base model.
- gretelai/synthetic_pii_finance_multilingual, revision `7b844d16`, and gretelai/gretel-pii-masking-en-v1, revision `e06eb149`. Apache-2.0, https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual and https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1. Training data for the `full` variant only.

The held-out scoring sets in [ner/TRAINED.md](ner/TRAINED.md) are used for measurement only and do not go into any model.
