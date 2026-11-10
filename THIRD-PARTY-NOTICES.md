# Third-party notices

## The core package

The published `@centrst/blind` package has no third-party runtime code. Its `dependencies` field is empty, and everything in `dist` is compiled from this repository's `src` under the MIT licence in [LICENSE](LICENSE).

## The optional NER package

`@centrst/blind-ner` (in `ner/`) is MIT like the core, but it loads a third-party model and two third-party libraries at run time: GLiNER multi v2.1 (Apache-2.0), `onnxruntime-node` (MIT) and `@huggingface/tokenizers` (Apache-2.0). None of them is copied into this repository. Their notices, with pinned versions, revisions and licence sources, are in [ner/THIRD-PARTY-NOTICES.md](ner/THIRD-PARTY-NOTICES.md), which is the file that package ships.

## Data and models used to train blind's own NER model

`ner/train/` fine-tunes an opt-in token-classification model, described in [ner/TRAINED.md](ner/TRAINED.md). Its weights are not in this repository. Revisions are pinned in `ner/train/sources.py`. Anyone who shares weights trained this way must carry these credits.

- Nemotron-PII, NVIDIA, revision `b70ffaf5`. CC BY 4.0, https://huggingface.co/datasets/nvidia/Nemotron-PII. Training data for both variants. Credit: *Nemotron-PII: Synthesized Data for Privacy-Preserving AI*, Amy Steier, Andre Manoel, Alexa Haushalter and Maarten Van Segbroeck, NVIDIA, 2025, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
- GeoNames. CC BY 4.0, https://www.geonames.org/about.html. Town names for the training gazetteer in `ner/train/gazetteer.py`. Credit: "Towns: GeoNames (https://www.geonames.org), CC BY 4.0."
- Wikidata. CC0 1.0, https://www.wikidata.org/wiki/Wikidata:Licensing. Institution names and Spanish municipalities for the same gazetteer.
- microsoft/mdeberta-v3-base, revision `a0484667`. MIT, https://huggingface.co/microsoft/mdeberta-v3-base. The base model.
- gretelai/synthetic_pii_finance_multilingual, revision `7b844d16`, and gretelai/gretel-pii-masking-en-v1, revision `e06eb149`. Apache-2.0, https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual and https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1. Training data for the `full` variant only.

The held-out scoring sets in [ner/TRAINED.md](ner/TRAINED.md) are used for measurement only and do not go into any model.
