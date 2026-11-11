# Changelog

Changes to `@centrst/blind-ner`, written by hand in the pull request that sets each version. The core package has its own [CHANGELOG.md](https://github.com/centrst/blind/blob/main/CHANGELOG.md). The project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

The first release will be `0.1.0`, built against core `0.2.0`. Its release pull request renames this heading.

### Added

- `GlinerModel`, a runner for the GLiNER span model `gliner_multi-v2.1` on ONNX Runtime, in process and on the CPU, and `TokenClassifierModel` for a token-classification model you export yourself.
- `createNerDetector` turns either model into a `Detector` for `@centrst/blind`, and `blindWithNer` runs the model and then `blind` in one call. Names found by the model are also marked where they appear bare later in the same text.
- The `blind-ner-download` command fetches the model into a directory you name, at a pinned revision with every file checked against a SHA-256, and writes the Apache-2.0 licence text and a `PROVENANCE.md` beside the weights. It is the only part of the package that uses the network.
- `@centrst/blind` is a peer dependency. Each version names the core it was built and tested with, as a caret range.
