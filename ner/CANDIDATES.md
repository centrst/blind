# PII-tuned NER models as blind's detector

Measured on 2026-10-24. The question was whether a PII-tuned GLiNER model with a commercial licence would make a better detector than `gliner_multi-v2.1`, mainly on precision, which was 29% to 47% on Gretel's finance documents. Every model here ran through the runner in `@centrst/blind-ner`, a prototype built from this repository, not on npm.

**No, not as a drop-in change.** Neither multilingual PII model is better. With the detector's labels they lose most street addresses on Gretel and some org and place recall on the corpus, and they gain only a few points of person and org precision. They still tag the same role words (`Borrower`, `Lender`, `Company`). The English-only `knowledgator/gliner-pii-base-v1.0` is the one interesting result. It has much better person precision on Gretel, it is 29% to 44% faster and 57% of the size, and it holds up on the corpus, Spanish included. But it finds fewer street addresses and orgs, its card says English only, and its training data is not published, so I cannot rule out that Gretel's data was in it. The default stays as it is. The owner decides.

## Candidates

| model | licence (from the model card) | revision | trained on | ONNX on the Hub |
| --- | --- | --- | --- | --- |
| [urchade/gliner_multi-v2.1](https://huggingface.co/urchade/gliner_multi-v2.1) (baseline) | Apache 2.0 | onnx-community export `6ddaeb94` | `urchade/pile-mistral-v0.1` | yes, [onnx-community/gliner_multi-v2.1](https://huggingface.co/onnx-community/gliner_multi-v2.1) |
| [urchade/gliner_multi_pii-v1](https://huggingface.co/urchade/gliner_multi_pii-v1) | Apache 2.0 | `1fcf13e85f4eef5394e1fcd406cf2ca9ea82351d` | fine-tuned from gliner_multi-v2.1 on `urchade/synthetic-pii-ner-mistral-v1` (Apache 2.0, Mistral-generated) | no, exported here |
| [E3-JSI/gliner-multi-pii-domains-v1](https://huggingface.co/E3-JSI/gliner-multi-pii-domains-v1) | Apache 2.0 | `66b7951b1e020535d2f470d4b35bc90149a1ed0d` | fine-tuned from gliner_multi_pii-v1 on `E3-JSI/synthetic-multi-pii-ner-v1` (MIT, LLM-generated) | no, exported here |
| [knowledgator/gliner-pii-base-v1.0](https://huggingface.co/knowledgator/gliner-pii-base-v1.0) | Apache 2.0 | `61726e0ad791dcab3e29339bbec3ad42ded65641` | not disclosed (`train_data: data/full_pii.json` in its config) | yes, `onnx/model.onnx` |

All four cards say Apache 2.0 in their metadata. The two training sets that are named are LLM-generated and neither card or dataset card mentions Gretel. The knowledgator model names no dataset anywhere I could find, and its `trainer_state.json` names none either. Its Gretel numbers may be home ground and should be read with that in mind. Its corpus numbers are not affected. `gretelai/gretel-gliner-*` was excluded as asked.

The two multilingual PII models share the baseline's architecture. All three are mDeBERTa-v3-base with `markerV0` spans, `max_width` 12, `max_len` 384 and the same 250,105-token vocabulary. The knowledgator model is a 6-layer DeBERTa-v3 encoder with a 128,003-token English vocabulary and `max_len` 2048.

## Results

The scorer is the one in `pnpm ner:eval` and `scripts/bench/score-gretel.ts`. Strict recall counts an annotated value as found when it is gone from the output. Precision is the share of replaced spans that overlap a label of the same kind. All runs are bare mode, with the detector's default labels `person`, `organization` and `location`. R is recall and P is precision, both in percent. Mean F1 is the mean of the three per-kind F1 scores. The ms column is model time per file on the CPU from the one uncached run, and blind's core adds 0.2 to 0.3 ms on top.

### How the threshold was picked

I picked it on a held-out half of Gretel, never on the half reported. The 888-file sample splits into two fixed halves. Within each language the files alternate in input order, so `half-a` and `half-b` each have 222 English and 222 Spanish files. I wrote the rule into `ner/scripts/candidates.ts` before scoring any candidate. On `half-a`, take the threshold with the highest mean F1 over person, org and place, with ties going to the lower threshold. The Gretel tables below are `half-b`. The corpus tables show every threshold, with the Gretel-chosen one marked, so its cost on the corpus is visible.

The rule picked 0.8 or 0.9 for two models, because Gretel precision is a floor. Gretel does not label cities, countries or many companies, so every `Madrid` or `ABC Bank` counts against precision, and a higher threshold looks better there than it would on fully labelled text. On the corpus those thresholds cost a lot of place and org recall. Treat the chosen threshold as the precision end of the range, not as a recommendation.

### Gretel half-b, 444 files

| model | threshold | person R | person P | org R | org P | place R | place P | mean F1 | ms per file |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gliner_multi-v2.1 | 0.3 | 77.5 | 39.8 | 97.5 | 26.8 | 98.9 | 47.3 | 52.9 | 106 |
| gliner_multi-v2.1 | 0.4 | 77.0 | 41.9 | 97.3 | 29.3 | 98.6 | 50.0 | 55.2 | 106 |
| gliner_multi-v2.1 | 0.5 | 76.8 | 44.2 | 96.6 | 31.4 | 96.4 | 51.7 | 56.9 | 106 |
| gliner_multi-v2.1 | 0.6 | 76.0 | 46.4 | 95.3 | 33.6 | 93.4 | 54.0 | 58.6 | 106 |
| gliner_multi-v2.1 | 0.8 (chosen) | 74.2 | 54.1 | 89.2 | 39.8 | 81.4 | 59.4 | 62.1 | 106 |
| gliner_multi_pii-v1 | 0.3 | 76.8 | 42.7 | 98.0 | 33.0 | 31.2 | 23.0 | 43.6 | 102 |
| gliner_multi_pii-v1 | 0.4 | 76.5 | 45.2 | 98.0 | 35.1 | 26.6 | 22.4 | 44.3 | 102 |
| gliner_multi_pii-v1 | 0.5 | 75.7 | 46.2 | 98.0 | 38.0 | 23.6 | 20.9 | 44.8 | 102 |
| gliner_multi_pii-v1 | 0.6 | 75.3 | 48.3 | 97.5 | 42.2 | 18.9 | 19.8 | 45.7 | 102 |
| gliner_multi_pii-v1 | 0.9 (chosen) | 71.0 | 59.2 | 90.2 | 52.9 | 11.8 | 25.6 | 49.1 | 102 |
| gliner-multi-pii-domains-v1 | 0.3 | 75.1 | 47.3 | 96.8 | 32.0 | 47.7 | 28.7 | 47.4 | 102 |
| gliner-multi-pii-domains-v1 | 0.4 | 74.2 | 50.4 | 94.6 | 34.9 | 38.4 | 26.8 | 47.5 | 102 |
| gliner-multi-pii-domains-v1 | 0.5 (chosen) | 73.3 | 51.7 | 93.1 | 37.8 | 32.0 | 25.7 | 47.7 | 102 |
| gliner-multi-pii-domains-v1 | 0.6 | 71.2 | 53.4 | 92.9 | 41.0 | 25.8 | 23.5 | 47.5 | 102 |
| gliner-pii-base-v1.0 | 0.3 | 75.7 | 58.5 | 93.6 | 28.2 | 79.2 | 41.6 | 54.6 | 59 |
| gliner-pii-base-v1.0 | 0.4 (chosen) | 72.2 | 70.5 | 90.7 | 37.2 | 57.5 | 44.6 | 58.1 | 59 |
| gliner-pii-base-v1.0 | 0.5 | 64.3 | 81.0 | 80.9 | 46.5 | 31.2 | 42.3 | 55.6 | 59 |
| gliner-pii-base-v1.0 | 0.6 | 55.5 | 90.4 | 70.8 | 63.8 | 12.6 | 34.6 | 51.5 | 59 |

Every row ran through `@centrst/blind-ner`, a prototype built from this repository, not on npm.

### Blind's corpus, 379 files

| model | threshold | person R | person P | org R | org P | place R | place P | mean F1 | ms per file |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gliner_multi-v2.1 | 0.3 | 98.7 | 96.6 | 97.7 | 92.7 | 99.4 | 88.6 | 95.5 | 49 |
| gliner_multi-v2.1 | 0.4 | 98.5 | 96.8 | 97.4 | 92.8 | 98.3 | 89.0 | 95.4 | 49 |
| gliner_multi-v2.1 | 0.5 | 98.1 | 96.9 | 97.1 | 93.5 | 96.0 | 90.4 | 95.3 | 49 |
| gliner_multi-v2.1 | 0.6 | 97.9 | 97.0 | 95.9 | 93.8 | 90.8 | 89.9 | 94.2 | 49 |
| gliner_multi-v2.1 | 0.8 (chosen) | 97.3 | 96.8 | 92.2 | 96.3 | 73.0 | 94.3 | 91.2 | 49 |
| gliner_multi_pii-v1 | 0.3 | 98.0 | 96.8 | 94.5 | 92.8 | 92.5 | 92.9 | 94.6 | 49 |
| gliner_multi_pii-v1 | 0.4 | 97.9 | 97.0 | 93.8 | 93.0 | 90.2 | 96.5 | 94.7 | 49 |
| gliner_multi_pii-v1 | 0.5 | 97.8 | 97.1 | 93.5 | 93.1 | 87.4 | 98.5 | 94.4 | 49 |
| gliner_multi_pii-v1 | 0.6 | 97.7 | 97.1 | 92.8 | 93.2 | 83.9 | 99.2 | 93.8 | 49 |
| gliner_multi_pii-v1 | 0.9 (chosen) | 96.5 | 96.8 | 87.2 | 95.8 | 60.3 | 100.0 | 87.7 | 49 |
| gliner-multi-pii-domains-v1 | 0.3 | 98.2 | 96.9 | 95.7 | 92.2 | 97.1 | 92.7 | 95.4 | 49 |
| gliner-multi-pii-domains-v1 | 0.4 | 98.0 | 97.0 | 94.7 | 92.8 | 94.8 | 97.4 | 95.8 | 49 |
| gliner-multi-pii-domains-v1 | 0.5 (chosen) | 97.9 | 97.1 | 94.2 | 93.0 | 92.0 | 98.0 | 95.3 | 49 |
| gliner-multi-pii-domains-v1 | 0.6 | 97.7 | 97.1 | 92.2 | 93.3 | 87.4 | 97.8 | 94.1 | 49 |
| gliner-pii-base-v1.0 | 0.3 | 99.3 | 96.2 | 98.3 | 93.3 | 98.8 | 90.7 | 96.0 | 35 |
| gliner-pii-base-v1.0 | 0.4 (chosen) | 98.2 | 96.5 | 90.4 | 94.6 | 95.4 | 93.8 | 94.8 | 35 |
| gliner-pii-base-v1.0 | 0.5 | 96.8 | 96.3 | 76.2 | 96.1 | 86.2 | 96.6 | 90.9 | 35 |
| gliner-pii-base-v1.0 | 0.6 | 92.8 | 95.9 | 61.1 | 97.2 | 64.4 | 98.2 | 82.4 | 35 |

Every row ran through `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Thresholds 0.2, 0.7, 0.8 and 0.9 were run for every model too. They are in `reports/candidates/` and `ner/scripts/candidates.ts` prints them, along with the tuning half, all 888 files and the split by language.

Every model at every threshold, with either label set, round-tripped 379 of 379 corpus files in bare and known mode, and on the 68 adversarial cases none made a handled case worse. The knowledgator model replaced one more (55 against 54). The C15 to C18 tests were run with the baseline only.

### Speed and size

Apple M4 Max, 16 cores, 64 GB, Node 26.11.1, onnxruntime-node 1.30.0, CPU provider, the runtime's default thread count, one file at a time.

| model | corpus, ms per file | Gretel, ms per file | `onnx/model.onnx` | directory |
| --- | --- | --- | --- | --- |
| gliner_multi-v2.1 | 49 | 106 | 1157 MB | 1173 MB |
| gliner_multi_pii-v1 | 49 | 102 | 1157 MB | 1174 MB |
| gliner-multi-pii-domains-v1 | 49 | 102 | 1157 MB | 1174 MB |
| gliner-pii-base-v1.0 | 35 | 59 | 665 MB | 673 MB |

Every row ran through `@centrst/blind-ner`, a prototype built from this repository, not on npm.

The two exported PII models run at the baseline's speed, as expected from the same architecture. Each model ran once, so the 4 ms gap on Gretel says nothing either way.

## What the numbers say

**The multilingual PII models lose street addresses.** At 0.3 on Gretel half-b, `gliner_multi_pii-v1` removes 31.2% of street addresses and `gliner-multi-pii-domains-v1` 47.7%, against 98.9% for the baseline. Both were tuned with the label `address`, and they do not treat a street address as a `location`. On the corpus, whose 174 place annotations are 17 town names and no addresses, they drop less: place recall 92.5% and 97.1% against 99.4%. Spanish org recall on the corpus also falls, to 91.5% and 93.2% against 96.8%.

**They gain a little precision on persons and orgs.** At the same threshold of 0.3, person precision on Gretel rises from 39.8% to 42.7% and 47.3%, and org precision from 26.8% to 33.0% and 32.0%, at about the same recall. On the corpus the gains are under a point for person and none for org.

**The role words stay.** The most common person false positives on Gretel half-b are the same for the baseline at 0.3 and 0.8 and for both multilingual PII models at their chosen thresholds. `Borrower` shows up 77 to 81 times, `Lender` 31 to 41, then `Participant`, `Policyholder`, `Insured` and `Customer`. For orgs it is `Company`, `Employer`, `Empresa` and `Supplier`. The knowledgator model at 0.4 is the exception for persons: `Borrower` drops to 11. It still tags `Company` 39 times. A higher threshold shrinks these lists without emptying them. The baseline at 0.8 still tags `Borrower` 78 times.

**The knowledgator model.** Person precision on Gretel half-b is 58.5% at 0.3 and 70.5% at 0.4, against 39.8% and 41.9% for the baseline, for 1.8 to 4.8 points less person recall. On the corpus at 0.3 it has the best mean F1 of the four, 96.0 against 95.5, and Spanish holds up: person 99.0, org 96.1, place 100. It loses on street addresses, 79.2% against 98.9% at 0.3 and 57.5% at 0.4, and on org recall, 93.6% against 97.5% at 0.3 and 90.7% at 0.4. Its org precision is close to the baseline's at 0.3 and ahead of every model from 0.4 up, but only by trading that recall. Its Gretel Spanish person precision at 0.3, 60.7% against 48.4%, is a real gain on Spanish text, but this is the model whose training data I could not check.

**Threshold alone.** For the baseline, moving from 0.3 to 0.5 buys 4.4 points of person precision, 4.6 of org and 4.4 of place on Gretel half-b. It costs 0.7, 0.9 and 2.5 points of recall there, and 0.6, 0.6 and 3.4 on the corpus. That is a smaller and safer change than any model swap measured here. It does not touch the role words.

### Label variant: `place=address`

To check whether the place collapse was the model or the label, every model also ran with `address` instead of `location` for place (`--labels place=address`). Same halves, same rule.

| model | threshold | Gretel half-b place R | place P | person P | org P | corpus place R | corpus place P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| gliner_multi-v2.1 | 0.3 | 100.0 | 62.6 | 41.2 | 27.9 | 90.8 | 95.7 |
| gliner_multi_pii-v1 | 0.3 | 97.5 | 74.9 | 44.2 | 34.0 | 62.1 | 100.0 |
| gliner-multi-pii-domains-v1 | 0.3 | 96.4 | 75.3 | 48.5 | 33.6 | 74.7 | 100.0 |
| gliner-pii-base-v1.0 | 0.3 | 94.0 | 79.8 | 62.5 | 31.0 | 65.5 | 100.0 |

Every row ran through `@centrst/blind-ner`, a prototype built from this repository, not on npm.

With `address` the PII models find Gretel's street addresses again, at much higher precision than the baseline with `location`. On the corpus they then miss 25% to 38% of the places, because a town is not an address. Blind's `place` kind covers both, and the detector sends one label per kind. So the PII models would need both labels mapped to `place`, which `createNerDetector` cannot do today. That is the next experiment if the PII models are worth another look. It is not run here.

## What a switch would take

No default change is proposed, because no candidate is better on both datasets.

- `gliner_multi_pii-v1` and `gliner-multi-pii-domains-v1` have no ONNX files on the Hub. Using either would mean hosting the exported files somewhere and pointing `ner/src/download.ts` at that host, with the hashes below. Apache 2.0 allows redistribution with the licence and notices.
- `knowledgator/gliner-pii-base-v1.0` has ONNX on the Hub and loads in the existing runner unchanged. Trying it as the download would be these three constants in `ner/src/download.ts`, plus the default directory name there and in `ner/test/support.ts`, `scripts/verify.ts`, `scripts/bench/lib.ts` and `package.json`. Before that, ask the authors what `full_pii.json` contains, and test on a second dataset that is neither blind's nor Gretel's.

```ts
const REPO = 'knowledgator/gliner-pii-base-v1.0';
const REVISION = '61726e0ad791dcab3e29339bbec3ad42ded65641';
const FILES: Record<string, string> = {
  'gliner_config.json': 'e33d3da38e0d369fa7574668d3798ca6c7d2b23cba7d628507112eeb426aaccb',
  'tokenizer.json': 'ee028763434d18611c1c36356ea1d050e90a9fa94ede57fac48b39f85f818ad1',
  'tokenizer_config.json': '3ec8a90d8758fbc56d50831990c3a3a65660f020c5b06534adf43b04091ffa9e',
  'onnx/model.onnx': 'c6ccec44625d46bfe3191152e41d6564b69bc9d4313b7f3e419e8372679e9fed',
};
```

## How the exports were made and checked

`ner/scripts/export-onnx.py` loads the model at a pinned revision with gliner's `GLiNER.from_pretrained` and calls gliner's own `export_to_onnx`. That runs the TorchScript exporter, `dynamo=False`, with the same six input names as the onnx-community export (`input_ids`, `attention_mask`, `words_mask`, `text_lengths`, `span_idx`, `span_mask`), the same `logits` output and the same dynamic axes. The baseline export was made by PyTorch 2.3.0 at opset 14, so the script uses opset 14. `GlinerModel.load` reads the result unchanged. No change to `ner/src` was needed.

Checks:

- PyTorch against ONNX Runtime on the same batch: largest logit difference 2.0e-4 for `gliner_multi_pii-v1` and 2.4e-4 for `gliner-multi-pii-domains-v1`.
- The JS runner on the export against Python gliner on the PyTorch weights, over 41 texts (20 corpus, 21 Gretel). Of the texts that fit one window, 24 of 24 give the same spans, with scores within 2e-5. Longer texts differ because `ner/src/gliner.ts` splits them into overlapping token windows and Python gliner does not. That affects every model the same way.
- The exported tokenizers give the same ids as the baseline's for all 24,299 distinct words in the corpus and the Gretel sample.
- Running the export twice gave a byte-identical `model.onnx`.

Watch the transformers version. With transformers 5.16 the export writes a `tokenizer.json` without SentencePiece's precompiled normalizer. `º`, `ª` and `³` then become `[UNK]`, 7 of 24,299 words. transformers 4.57.6 writes the same normalizer as the onnx-community file, so the venv pins it. `gliner_multi_pii-v1` ships no tokenizer, and gliner takes it from `microsoft/mdeberta-v3-base` at revision `a0484667b22365f84929a935b5e50a51f71f159d`.

### SHA-256 of the exported files

`gliner_multi_pii-v1` (from `urchade/gliner_multi_pii-v1@1fcf13e8`):

```
725ee7532b045537900ac12d7bc8d25745926befe88830b5c2428e0c58ad860f  onnx/model.onnx (1,157,189,425 bytes)
ad09db8cc9fa90cfc3cda541a108bbd97584a32c51f0444c1aaa8e4a5e2ede25  gliner_config.json
17662b53c286b4e0f8cdebf2ed10c6cac7132aa329880890e247e6cedf7c90fc  tokenizer.json
928d015db8ce40c131beaf323a25ab913c8d7b7d20baf997bf42e0f6d3cd2f8b  tokenizer_config.json
```

`gliner-multi-pii-domains-v1` (from `E3-JSI/gliner-multi-pii-domains-v1@66b7951b`):

```
f93b2e91800989156cd3f8aafbcd7c8c572df861306e829801ae5ec64d19f242  onnx/model.onnx (1,157,189,425 bytes)
d01939fccaae497a146e3783cf338197309c794ba8c77f86739f5776d5ff380a  gliner_config.json
9eb08b12d046b3faead20654597b3e720039bc61f067aa17fb97aed78f46852d  tokenizer.json
b27c4e7217e1d3de4989cff859472f765ddd9f44caff18de3eaa332026ef2d0a  tokenizer_config.json
```

The knowledgator files are the Hub's, with the hashes in the block above. The baseline's are in `ner/src/download.ts`.

## Reproduce

Python 3.12. The pip versions that matter: gliner 0.2.29, torch 2.14.1, transformers 4.57.6, tokenizers 0.22.2, sentencepiece 0.2.2, onnx 1.23.2, onnxruntime 1.31.0, huggingface_hub 0.36.2, numpy 2.5.4, safetensors 0.8.0.

```sh
# baseline weights: pnpm ner:download, or link an existing copy into ner/models/gliner_multi-v2.1
python3.12 -m venv .local/gliner-venv
.local/gliner-venv/bin/pip install gliner==0.2.29 torch==2.14.1 transformers==4.57.6 onnx==1.23.2 onnxruntime==1.31.0
export HF_HOME=$PWD/.local/hf
.local/gliner-venv/bin/python -I ner/scripts/export-onnx.py urchade/gliner_multi_pii-v1 1fcf13e85f4eef5394e1fcd406cf2ca9ea82351d ner/models/gliner_multi_pii-v1
.local/gliner-venv/bin/python -I ner/scripts/export-onnx.py E3-JSI/gliner-multi-pii-domains-v1 66b7951b1e020535d2f470d4b35bc90149a1ed0d ner/models/gliner-multi-pii-domains-v1
R=https://huggingface.co/knowledgator/gliner-pii-base-v1.0/resolve/61726e0ad791dcab3e29339bbec3ad42ded65641
mkdir -p ner/models/gliner-pii-base-v1.0/onnx
for f in gliner_config.json tokenizer.json tokenizer_config.json onnx/model.onnx; do curl -fL -o ner/models/gliner-pii-base-v1.0/$f $R/$f; done

# Gretel inputs: pnpm bench:gretel:setup, then the first step of pnpm bench:gretel (gretel_sample.py)
mkdir -p reports/candidates
for m in gliner_multi-v2.1 gliner_multi_pii-v1 gliner-multi-pii-domains-v1 gliner-pii-base-v1.0; do
  for t in 0.3 0.2 0.4 0.5 0.6 0.7 0.8 0.9; do
    pnpm ner:eval --model ner/models/$m --threshold $t --out reports/candidates/corpus-$m-$t.json
    pnpm exec tsx --tsconfig ner/tsconfig.json scripts/bench/score-gretel.ts --ner-only --model ner/models/$m --threshold $t --out reports/candidates/gretel-$m-$t.json
  done
done
# the label variant: the same loop with --labels place=address and files named <model>+address
pnpm exec tsx --tsconfig ner/tsconfig.json ner/scripts/candidates.ts
```

Run the loop one job at a time. The first run per model and dataset is the uncached one and carries the timing. Both scorers cache every span scoring 0.2 or more, per model and labels, and each run keeps the spans at its own threshold. That gives the same spans as running the model at that threshold, because `greedyFlat` keeps spans in score order. Through the changed scorers the baseline reproduced the published numbers exactly. On the corpus that is person 98.73 / 96.63, org 97.71 / 92.69 and place 99.43 / 88.64, as in ner/README.md. On Gretel it is person 79.5 / 40.1, org 98.7 / 29.4, place 98.6 / 47.3, 798 of 888 round trips and 106 ms per file, as in scripts/bench/RESULTS-llmguard-gretel.md.

## Caveats

- Gretel's labels are incomplete and noisy. Cities, countries and many companies carry no label, and RESULTS-llmguard-gretel.md lists the noise. So its precision is a floor for every model. Its `place` label is street addresses only.
- The corpus is synthetic and was written by blind's authors. The baseline's threshold and the name propagation in `ner/src/detector.ts` were tuned on it. The propagation step multiplies a model's mistakes too. A role word tagged once gets marked again wherever it appears bare.
- Timings are from one machine and one run per model and dataset.
- Every model ran with the baseline's labels. The PII model cards suggest others, such as `address`, `name` and `location address`. I tried only `place=address`.
