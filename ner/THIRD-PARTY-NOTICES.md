# Third-party notices

`@centrst/blind-ner` is MIT, like the core, under the [LICENSE](LICENSE) in this package. It loads a third-party model and two third-party libraries at run time. None of them is copied into the package: npm installs the two libraries as dependencies, and the `blind-ner-download` command fetches the model into a directory you name. The package does ship the Apache-2.0 licence text, in [licenses/APACHE-2.0.txt](licenses/APACHE-2.0.txt), so that the command can put it beside the weights.

## GLiNER multi v2.1, the default model

- Name: `gliner_multi-v2.1`, by Urchade Zaratiana.
- Pinned revisions: the ONNX export `onnx-community/gliner_multi-v2.1` at `6ddaeb9413b0e71ad8457da1aab378a165b24058`, and its upstream card `urchade/gliner_multi-v2.1` at `443d26d654e0324125a96bebd8e796c14ff2efe6`. Both are pinned with SHA-256 hashes in `src/download.ts` (`ner/src/download.ts` in the repository).
- Licence, upstream: Apache-2.0, from the `license: apache-2.0` field of the model card, https://huggingface.co/urchade/gliner_multi-v2.1/blob/443d26d654e0324125a96bebd8e796c14ff2efe6/README.md
- Licence, export: no licence field of its own; distributed as a conversion of the Apache-2.0 upstream. Its card names `base_model: urchade/gliner_multi-v2.1`, https://huggingface.co/onnx-community/gliner_multi-v2.1/blob/6ddaeb9413b0e71ad8457da1aab378a165b24058/README.md
- `LICENSE` file: neither repository has one at its pinned revision. The download command checks that and reports both as absent.
- Licence text: the Apache-2.0 text from https://www.apache.org/licenses/LICENSE-2.0.txt, fetched once and shipped as [licenses/APACHE-2.0.txt](licenses/APACHE-2.0.txt), SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. The download command checks that hash and copies the text to `LICENSE` in the model directory, and writes `PROVENANCE.md` there with every file, its source, revision and hash, the two absent `LICENSE` files, and the quoted `license: apache-2.0` line of the upstream card.
- Upstream: https://huggingface.co/urchade/gliner_multi-v2.1 and https://huggingface.co/onnx-community/gliner_multi-v2.1
- Used for: person, organization and place detection in `src/gliner.ts`. The download command saves both model cards beside the weights, as `README.md` and `upstream/README.md` in the model directory.
- Not the same as older releases. `urchade/gliner_multi` (v1) is CC-BY-NC-4.0 on its card, https://huggingface.co/urchade/gliner_multi, so it is not for commercial use and must not replace v2.1.

## onnxruntime-node

- Version: 1.31.1, with its dependency `onnxruntime-common` 1.31.1.
- Licence: MIT, from the npm registry entry, https://registry.npmjs.org/onnxruntime-node/1.31.1
- Upstream: https://github.com/microsoft/onnxruntime
- Used for: running the ONNX model in process, on CPU. The package bundles prebuilt native binaries for its supported platforms. Its install script fetches CUDA and TensorRT providers on linux/x64, which blind-ner never loads; `ONNXRUNTIME_NODE_INSTALL=skip` in the environment of the install skips it, and this repository blocks it in `pnpm-workspace.yaml`. That script's own dependencies, `adm-zip` 0.6.1 (MIT) and `global-agent` 4.1.3 (BSD-3-Clause), are installed but not loaded by blind-ner.

## @huggingface/tokenizers

- Version: 0.2.0.
- Licence: Apache-2.0, from the npm registry entry, https://registry.npmjs.org/@huggingface/tokenizers/0.2.0
- Upstream: https://github.com/huggingface/tokenizers.js
- Used for: tokenizing text for the model, in pure JavaScript.
