# A token-classification NER model trained for blind

Measured on 2026-10-25 on `feat/ner-deberta`, based on `f5f8dd8` (`fix/round-trip`). The question was whether a DeBERTa token classifier, trained only on data whose licence allows commercial use, gives blind a better person, org and place detector than `gliner_multi-v2.1`. The idea is the one behind LLM Guard's `Isotonic/deberta-v3-base_finetuned_ai4privacy_v2`, which Centrst cannot use because its weights and data are CC BY-NC. The GLiNER runner and the DeBERTa runner both live in `@centrst/blind-ner`, a prototype built from this repository, not on npm.

**Better precision, worse recall, so not a drop-in replacement.** On text like its training data the model is far more precise than GLiNER and almost never tags a role word. GLiNER tags 1,291 role words such as `Borrower`, `Company` and `Empresa` as persons or orgs on the Gretel sample, and the model tags 16. But on the one dataset that neither it nor GLiNER was trained on, it removes 22 points fewer orgs and 14 points fewer places than GLiNER, and gains no person precision. For a privacy tool a missed org is a leak, so GLiNER stays the default. The model is wired in as an opt-in backend, and the losses below point at what to fix.

**Round two** ([below](#round-two)) added institution and town training data, masked Gretel's unlabelled towns and trained three epochs. It lifts neutral place recall from 84.4% to 91.9% and keeps the precision and role-word wins, but neutral org recall stays at 76.5% against GLiNER's 97.5%, so GLiNER is still the default.

## What was built

- `ner/train/`: Python training pipeline. `sources.py` pins every input by revision and SHA-256. `prepare.py` builds the training data and the held-out score inputs. `train.py` fine-tunes on PyTorch MPS. `export.py` writes ONNX fp32 and int8 and checks them. `bench.sh` runs every score in this file. `requirements.txt` is the `pip freeze`.
- `ner/scripts/gen-train-emails.ts`: training emails from blind's own generator, with new seeds and swapped names (see below).
- `ner/src/token-classifier.ts`: `TokenClassifierModel.load(dir, { file })`, a BIO runner on onnxruntime-node beside `GlinerModel`. It reuses GLiNER's Unicode word splitter and the same pure-JS tokenizer. It returns the same `RawEntity` spans, so `createNerDetector`, `blindWithNer` and the `Detector` interface take it unchanged. GLiNER is still the default everywhere.
- `ner/test/token-classifier.test.ts`: stub tests for windowing and BIO decoding, which always run. Model tests run when `ner/models/blind-ner-deberta-full` exists: span-for-span parity with the Python pipeline, 379/379 corpus round trips in bare and known mode for fp32 and int8, the adversarial set, a role-word contract, and no network.
- `scripts/bench/score.ts` and `score-gretel.ts` take `--tc <name>=<dir>[,<file>[,<threshold>]]`. `score-gretel.ts` also takes `--input`, `--out` and `--raw-prefix`, so it scores the held-out sets with the same rules. `ner/scripts/eval.ts` and `ner/scripts/bench.ts` take `--backend tc`. Run without the new flags, all four behave as before. The GLiNER, LLM Guard and Presidio columns rescored here match RESULTS-llmguard-gretel.md to the span.

## Data and licences

Every licence below was read on the card at the pinned revision. All allow commercial use and redistribution of a derived model. Nothing came from ai4privacy, Isotonic, an NC source or a source without a licence.

| source | licence | revision | used for |
| --- | --- | --- | --- |
| [microsoft/mdeberta-v3-base](https://huggingface.co/microsoft/mdeberta-v3-base) | MIT | `a0484667` | base model |
| [gretelai/synthetic_pii_finance_multilingual](https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual), train split, English and Spanish | Apache 2.0 | `7b844d16` | training, `full` only |
| [gretelai/gretel-pii-masking-en-v1](https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1), train split | Apache 2.0 | `e06eb149` | training, `full` only |
| [nvidia/Nemotron-PII](https://huggingface.co/datasets/nvidia/Nemotron-PII), train split | CC BY 4.0 | `b70ffaf5` | training, both variants |
| blind's email generator, `test/support/templates.ts`, new seeds | MIT, this repository | this commit | training, both variants |
| [urchade/synthetic-pii-ner-mistral-v1](https://huggingface.co/datasets/urchade/synthetic-pii-ner-mistral-v1) | Apache 2.0 | `392d6853` | held-out score only |
| [beki/privy](https://huggingface.co/datasets/beki/privy), `test-small` | MIT | `dc137a6a` | held-out score only |
| nvidia/Nemotron-PII, test split | CC BY 4.0 | `b70ffaf5` | in-distribution score only |

**Attribution.** Nemotron-PII is CC BY 4.0, so both trained models must credit it wherever they are shared: *Nemotron-PII: Synthesized Data for Privacy-Preserving AI*, Amy Steier, Andre Manoel, Alexa Haushalter and Maarten Van Segbroeck, NVIDIA, 2025, https://huggingface.co/datasets/nvidia/Nemotron-PII, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The two Gretel datasets are by Gretel AI under Apache 2.0, and the `full` model derives from them. Their notices go with that model too. The base model is Microsoft's mDeBERTa-v3-base under MIT. A model card for published weights should carry all of this.

### How each source was turned into labels

The model tags words with BIO labels for three kinds, person, organization and location, which blind calls `person`, `org` and `place`. Every other label in a source becomes O. The structured kinds stay with blind's pattern detectors.

- **Gretel finance.** `name`, `first_name`, `last_name` are person, `company` is org, `street_address` is place. All 4,165 Spanish rows and 12,000 seeded English rows of 25,948.
- **Gretel masking.** It gives entity values without offsets, so every whole-word occurrence of a value is labelled. `name`, `first_name`, `last_name`, `company_name`, `street_address`, `address` and `city` map as above. 12,000 seeded rows of 50,000.
- **Nemotron.** About 12% of its span offsets point to the wrong place. Each one is moved to the nearest occurrence of its text, or dropped when the text is not in the document. A first name followed by a last name becomes one person. A chain of address parts that contains a street address becomes one place. A city or county on its own is a place, while a state, country or postcode on its own is O. `company_name` is org. 25,000 seeded rows of 100,000.
- **Emails.** 4,200 from blind's generator with seeds `ner-train-v1-<i>`, never the corpus's `corpus-v1-<i>`. The generator draws from small pools: 16 towns, 30 company words and about 70 first names, which the 379 corpus files also use, the handwritten ones included. A model trained on raw generator output would learn the corpus's names by heart. So every pool word is swapped, consistently within an email and inside its addresses and domains, for a name, company word or town from Nemotron's train split that appears in no corpus annotation. The script checks that no pool word is left in a label. The templates are unchanged, which makes the corpus home ground for these models.

**Hard negatives.** Gretel's labels mostly leave role words alone. In the English Gretel train rows used, `Borrower` sits inside a person or org label 10 times in 2,694 occurrences and `Lender` 2 in 1,831. The Spanish rows are noisier: `Prestatario` 79 in 301, `Empresa` 158 in 771. Many of those are whole labels such as `El Prestatario` or `LA EMPRESA`, or template placeholders such as `[Nombre del Prestatario]`. `prepare.py` drops any person or org label whose whole text is a role word, with or without an article, and any label on a placeholder (brackets, `___`, `XXX`). It dropped 439 role labels and 1,223 placeholder labels from `full`. After that, `Prestatario` is inside a label 5 times and `Empresa` 66, mostly in real names such as `Empresa de Diseño Creativo S.L.`.

**Leakage check.** Before any record is kept, `prepare.py` compares it with the 379 corpus files and all 5,594 rows of Gretel's test split, which the 888-file benchmark sample is drawn from. A record is dropped when it equals one of them after collapsing white space, or when half of its 8-word shingles, or half of one protected text's shingles, are shared with that text. Shingles that occur in more than 20 protected texts are boilerplate and do not count. Gretel's own split is not clean: 7 train rows are exact copies of test rows, and the check dropped 51 Gretel train rows, 2 Nemotron rows and 1 masking row. A first, cruder check on 200-character prefixes matched 2,798 train rows, but most were shared log headers rather than copies.

### The two variants

| variant | training records | by source | spans (person, org, place) |
| --- | --- | --- | --- |
| `full` | 55,671 | Nemotron 24,248, Gretel finance 11,625 en + 4,037 es, Gretel masking 11,675, emails 4,086 | 64,656, 46,282, 26,082 |
| `nogretel` | 28,334 | Nemotron 24,248, emails 4,086 (the same rows) | 32,292, 28,365, 10,971 |

`nogretel` is `full` minus the two Gretel sources, with the same Nemotron rows and the same emails, so the two differ in one thing. Spanish in `nogretel` comes only from the emails. Validation is 3% of each source, chosen by a hash of the record id: 1,691 records for `full` and 866 for `nogretel`.

## Training setup

- `microsoft/mdeberta-v3-base` with a 7-label token-classification head, loaded in fp32. The checkpoint is stored in fp16, and transformers 5.20 loads it as fp16 by default, which gave NaN losses on MPS until `dtype=torch.float32` was set.
- Words come from GLiNER's splitter (`splitWords`, ported to Python with the `regex` module). Each word is tokenized on its own, and the label sits on its first sub-token. Python and the JS tokenizer give the same ids, checked on mixed Spanish, English and Unicode text.
- Windows of at most 512 tokens with 48 words of overlap, by the same rule as the runner. 67,289 windows and 18.2M tokens per epoch for `full`.
- AdamW, learning rate 3e-5, weight decay 0.01, 6% linear warmup then linear decay, gradient clipping at 1.0. Batches of at most 4,096 padded tokens and 16 rows, padded to a multiple of 64. Seed 20261024. Two epochs, with an evaluation every quarter epoch and early stopping after 3 evaluations without a better entity F1 on validation.
- Apple M4 Max, PyTorch 2.14.1 on MPS, transformers 5.20.2. `full` ran 11,470 steps in 2 h 28 min. Its validation micro F1 was still rising at the end: 0.874, 0.881, 0.893, 0.908, 0.902, 0.917, 0.926, 0.927. A third epoch might help and was not run. `nogretel` stopped early at step 4,176, and its best checkpoint is at 0.75 epochs with validation micro F1 0.990. That validation set is mostly Nemotron, which is easy for a model trained on Nemotron, so the number says little.

**MPS problems on the way, for whoever runs this next.** The first full run stalled at step 300. The MPS caching allocator keeps a pool for every batch shape and had grown to 61 GB, swap was full, and the process was stuck. Batches of 8,192 tokens and unbucketed shapes made it worse. Unbucketed shapes also made every step about three times slower, because each new shape costs a kernel compile. `torch.nn.utils.clip_grad_norm_` took 0.4 s per step on MPS for the 192M-weight embedding table, so `train.py` computes the norm with `square().sum()` in 15 ms. The fixes are in `train.py`: shape buckets, 4,096-token batches, `torch.mps.empty_cache()` every 25 steps, and an MPS high watermark of 0.5, so running out raises an error instead of swapping. After that the footprint stayed between 15 and 24 GB.

## Export

`export.py` writes `onnx/model.onnx` (fp32, opset 17), `tokenizer.json`, `tokenizer_config.json`, `config.json`, `labels.json` (label order, window settings, special token ids), `parity.json` and `manifest.json`. Two int8 files were measured on the validation split, against PyTorch:

| file | size | word label agreement with PyTorch | validation micro F1, `full` | validation micro F1, `nogretel` |
| --- | --- | --- | --- | --- |
| PyTorch | | | 0.9269 | 0.9896 |
| `onnx/model.onnx` fp32 | 1,114 MB | 100% (max probability difference 3e-5) | 0.9269 | 0.9896 |
| `onnx/model_int8.onnx`, weight-only int8, embedding table uint8 | 348 MB | 99.996% | 0.9278 | 0.9896 |
| `onnx/model_int8_dynamic.onnx`, ONNX Runtime dynamic int8 | 338 MB | 98.7% | 0.6428 | 0.9065 |

`model_int8.onnx` is the `wo8m-gu8` recipe from docs/BROWSER-NER.md, built by `ner/scripts/convert-model.py`. It stores MatMul weights in 8 bits in blocks of 32, the embedding table in uint8, activations in float. Dynamic quantization also quantizes activations at run time, and that costs the `full` model 48 points of org F1 on validation, the same failure docs/BROWSER-NER.md found for GLiNER. It is kept on disk for the record and should not be used.

The TypeScript runner reproduces the Python pipeline's spans exactly, at thresholds 0.3 and 0.5, on 61 validation texts, one of them long enough for many windows. That is the first model test.

**Threshold.** For this backend a word is part of an entity when 1 − P(O) is at least the threshold, and its kind is the one with the highest B + I probability. The detector passes its default, 0.3, unless told otherwise. 0.5 is close to taking the most likely label. Both are scored.

## Evaluation design

Fixed before any score was looked at:

- **Corpus**, all 379 files, never trained on. The scorer is the existing one. Strict recall counts a value as found when it is gone from the output, and precision counts replaced spans that overlap a label of the same kind. The training emails share the generator's templates with the 336 generated files, but not their names, companies or towns, so the corpus is home ground for both variants. The 43 handwritten files were written by hand and are reported apart.
- **Gretel sample**, the 888 files of `scripts/bench/gretel_sample.py`, never trained on. It is **in-domain for `full`**, which was trained on Gretel's train split, and **out-of-domain for `nogretel`**, which saw no Gretel data at all. The `nogretel` column is the fair comparison with GLiNER and LLM Guard there.
- **Neutral held-out set**: `urchade/synthetic-pii-ner-mistral-v1`, 500 English and 500 Spanish rows drawn by seed. Neither variant was trained on it, and neither was GLiNER `gliner_multi-v2.1` (trained on `urchade/pile-mistral-v0.1`) nor, as far as its card says, LLM Guard's model. This is the neutral number. Its text is rebuilt from word tokens, and its labels are free-form. `person` and `name` count as person. `organization`, `company`, `bank`, `hospital`, `university` and similar count as org. `address`, `location` and `city` count as place. Every other label is scored for recall only.
- **beki/privy**, 1,000 seeded rows of `test-small`, never trained on. API payloads in JSON, SQL, HTML and XML, English. Its LOC label is mostly coordinates, postcodes, state, country and airport codes, which blind does not count as places, so its place row says little.
- **Nemotron test**, 1,000 seeded rows, in-distribution for both variants, which trained on Nemotron's train split. Reported only to show what the models do on their own ground.

Every blind column runs in bare mode, with name propagation on, as `createNerDetector` does by default. LLM Guard is `llm-guard` 0.3.16 with its default recognizer, as in RESULTS-llmguard-gretel.md. Its corpus and Gretel columns are rescored from the raw files of that run at `4f5183f`, and it ran fresh on the three held-out sets. Precision on every dataset except the corpus is a floor, because none of them labels every name, company and town.

## Results

R is strict recall and P is precision, in percent. Round trip is `unblind(blind(x)) === x`. DeBERTa is the `full` model in fp32 at the detector default of 0.3.

### Corpus, 379 files (home ground)

| tool | person R | person P | org R | org P | place R | place P | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM Guard all_tld | 74.5 | 92.5 | 31.9 | 100.0 | 99.4 | 58.2 | 379/379 |
| blind bare | 67.3 | 95.5 | 29.9 | 97.8 | 0.0 | n/a | 379/379 |
| blind + GLiNER 0.3 | 98.7 | 96.6 | 97.7 | 92.7 | 99.4 | 88.6 | 379/379 |
| blind + GLiNER 0.5 | 98.1 | 96.9 | 97.1 | 93.5 | 96.0 | 90.4 | 379/379 |
| blind + DeBERTa fp32 | 99.9 | 97.1 | 100.0 | 98.5 | 99.4 | 100.0 | 379/379 |
| blind + DeBERTa int8 | 99.9 | 97.1 | 100.0 | 98.5 | 99.4 | 100.0 | 379/379 |
| blind + DeBERTa 0.5 | 99.9 | 97.1 | 100.0 | 98.8 | 99.4 | 100.0 | 379/379 |
| blind + DeBERTa no-Gretel | 99.9 | 97.1 | 100.0 | 98.6 | 100.0 | 99.4 | 379/379 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

In known mode both variants also round trip 379 of 379, with org recall 100 against 99.7 for GLiNER. On the 43 handwritten files, DeBERTa equals GLiNER on person (98.4 R, 75.0 P) and org recall (100), is slightly better on org precision (65.5 against 63.0), and loses one place: 95.0 R against 100, at 100 P against 78.3. No other kind moved. On the adversarial set two cases go from silent to replaced (F13 and S6) and none gets worse.

### Gretel sample, 888 files (in-domain for `full`, out-of-domain for `nogretel`)

| tool | person R | person P | org R | org P | place R | place P | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM Guard default | 38.2 | 82.3 | 6.0 | n/a | 8.4 | n/a | 888/888 |
| LLM Guard all | 40.9 | 82.3 | 24.4 | 88.3 | 91.0 | 58.4 | 888/888 |
| blind bare | 22.0 | 88.3 | 30.4 | 88.3 | 2.1 | n/a | 888/888 |
| blind + GLiNER 0.3 | 79.7 | 39.8 | 99.8 | 29.4 | 98.6 | 47.4 | 888/888 |
| blind + GLiNER 0.5 | 78.5 | 44.4 | 99.3 | 34.5 | 94.9 | 51.9 | 888/888 |
| blind + DeBERTa fp32 (in-domain) | 78.2 | 75.9 | 86.4 | 71.2 | 93.2 | 89.5 | 888/888 |
| blind + DeBERTa int8 (in-domain) | 78.2 | 76.1 | 86.4 | 70.9 | 93.5 | 89.5 | 888/888 |
| blind + DeBERTa 0.5 (in-domain) | 75.4 | 84.6 | 84.3 | 75.4 | 91.7 | 91.3 | 888/888 |
| blind + DeBERTa no-Gretel (out-of-domain) | 70.5 | 90.2 | 54.2 | 72.8 | 92.9 | 62.4 | 888/888 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm. The blind bare and GLiNER rows on Gretel were measured again on 11 November 2026 with core 0.2.0; the other rows are from the October runs. GLiNER person precision was 40.1 at 0.3 and 44.9 at 0.5 in October. The change against the October run comes from core 0.2.0's own name detection, whose spans merge with the model's.

By language, English then Spanish: DeBERTa person 90.2 R and 89.5 P, then 69.2 R and 66.8 P. GLiNER, measured again on 11 November 2026, 94.1 R and 34.0 P, then 69.0 R and 48.2 P (34.4 and 48.4 P in October). No-Gretel 88.1 R and 88.8 P, then 57.5 R and 91.8 P. LLM Guard `all` 48.2 R and 94.0 P, then 35.5 R and 73.1 P. Gretel's Spanish person labels are noisy (RESULTS-llmguard-gretel.md found 18 of 40 sampled ones were not names), which caps every tool's Spanish row.

### Neutral held-out set, urchade/synthetic-pii-ner-mistral-v1, 1,000 files

| tool | person R | person P | org R | org P | place R | place P | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM Guard default | 38.7 | 74.0 | 1.8 | n/a | 0.5 | n/a | 1000/1000 |
| LLM Guard all | 40.9 | 74.0 | 38.6 | 94.0 | 84.9 | 37.7 | 1000/1000 |
| blind bare | 2.0 | 62.3 | 0.9 | n/a | 2.3 | n/a | 1000/1000 |
| blind + GLiNER 0.3 | 71.2 | 61.3 | 97.5 | 48.7 | 98.8 | 51.5 | 1000/1000 |
| blind + GLiNER 0.5 | 69.0 | 63.1 | 95.7 | 55.5 | 97.8 | 52.4 | 1000/1000 |
| blind + DeBERTa fp32 | 66.9 | 60.5 | 75.8 | 70.1 | 84.4 | 49.6 | 1000/1000 |
| blind + DeBERTa int8 | 66.9 | 60.5 | 75.9 | 70.2 | 84.4 | 49.7 | 1000/1000 |
| blind + DeBERTa 0.5 | 66.2 | 60.9 | 67.7 | 74.7 | 80.6 | 51.5 | 1000/1000 |
| blind + DeBERTa no-Gretel | 64.8 | 61.3 | 71.6 | 81.7 | 96.1 | 38.9 | 1000/1000 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

On the Spanish half, GLiNER scores person 77.6 R and 65.0 P, org 97.7 R and 53.1 P, place 99.3 R and 48.9 P. DeBERTa person 73.7 R and 62.8 P, org 79.9 R and 73.0 P, place 84.5 R and 47.5 P.

### Other held-out sets, 1,000 files each

| dataset | tool | person R | person P | org R | org P | place R | place P |
| --- | --- | --- | --- | --- | --- | --- | --- |
| privy | LLM Guard all | 48.5 | 78.7 | 34.0 | 100.0 | 61.5 | 65.2 |
| privy | blind + GLiNER 0.3 | 97.3 | 16.4 | 98.0 | 8.2 | 76.0 | 39.8 |
| privy | blind + DeBERTa fp32 | 94.2 | 81.0 | 88.0 | 76.8 | 42.8 | 99.0 |
| privy | blind + DeBERTa no-Gretel | 74.9 | 95.2 | 54.0 | 96.2 | 49.5 | 94.9 |
| Nemotron test (in-distribution) | LLM Guard all | 70.9 | 83.0 | 26.1 | 97.6 | 89.4 | 32.9 |
| Nemotron test (in-distribution) | blind + GLiNER 0.3 | 98.9 | 38.6 | 99.8 | 41.6 | 99.3 | 39.6 |
| Nemotron test (in-distribution) | blind + DeBERTa fp32 | 97.3 | 98.4 | 98.8 | 91.1 | 96.7 | 94.8 |
| Nemotron test (in-distribution) | blind + DeBERTa no-Gretel | 97.3 | 99.5 | 99.5 | 96.3 | 98.1 | 89.2 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Privy has only 50 org labels. Every blind and LLM Guard column round trips 1,000 of 1,000 on both.

## Where it wins and where it loses

**Wins.**

- **Role words.** Counted on the model's raw spans over the Gretel sample, GLiNER at 0.3 tags 1,291 person or org spans whose whole text is a role word (`company` 134, `borrower` 124, `lender` 90, `customer` 81, `empresa` 70). DeBERTa tags 16 (`empresa` 10) and no-Gretel 5. That is the precision problem this work set out to fix, and it is fixed. It also holds for a model that never saw Gretel's data.
- **Precision on finance documents and forms.** On Gretel, in-domain, person precision goes from GLiNER's 40.1% to 75.9%, org from 29.4% to 71.2% and place from 47.3% to 89.5%, for 1.3 points of person recall, against the October GLiNER run these models were measured beside. With core 0.2.0, on 11 November 2026, GLiNER's person precision is 39.8%. Out-of-domain, the no-Gretel model reaches 90.2% person precision at 70.5% recall, against LLM Guard's 82.3% at 40.9%, so it beats LLM Guard on both counts for persons. On privy, person precision is 81% against GLiNER's 16%.
- **Org precision on the neutral set**: 70.1% against 48.7%, and 81.7% for no-Gretel.
- **Speed and size**, below.

**Losses.**

- **Org recall away from home.** On the neutral set DeBERTa removes 75.8% of orgs against GLiNER's 97.5%, and no-Gretel 71.6%. The misses are institutions and venues rather than companies: `Bank of Kigali`, `Banco Nacional de Bangladesh`, `Hospital Central de Bangui`, `Saint-Luc University Hospital`, `Sydney Football Stadium`, `CONMEBOL`. Measured on raw spans, it covers 20% of the 15 `bank` labels against GLiNER's 100%. Its training orgs are company names. On Gretel too, in-domain, org recall falls 12 points, to 86.4%. Out-of-domain it falls to 54.2%.
- **Towns, in the `full` model.** On the neutral set it covers 68% of the `location` labels and 74% of `city` against GLiNER's 96% and 92%, and misses `Madrid`, `Buenos Aires` and `Auckland`. Street addresses are fine, 97% against 99%. Gretel labels only street addresses and leaves towns unlabelled, so training on it taught the model to skip a bare town. The no-Gretel model, trained where towns are labelled, gets neutral place recall back to 96.1%, at lower place precision (38.9%), because the neutral set does not label most towns either. On the 43 handwritten corpus files, `full` misses one of 20 places.
- **No person precision gain on the neutral set**: 60.5% against 61.3%. Most of what both models tag there and the set does not label are real names (`Juan` 79 times, `John` 41, `Ahmed` 32 for DeBERTa), so the neutral person precision is a floor for both. Person recall is 4 points lower than GLiNER's: 66.9% against 71.2%.
- **Out-of-domain recall in general.** The no-Gretel model loses 9 points of person recall and 44.5 of org recall on Gretel against GLiNER. A token classifier knows the kinds and the styles it was shown, and GLiNER's broader pretraining shows on text unlike the training data.
- **The corpus says little.** Both variants are near 100% there, because the training emails share its templates. The handwritten split is the only honest corpus number, and on it the model is level with GLiNER apart from that one place.

## Size and speed

Apple M4 Max, Node 26.11.1, onnxruntime-node 1.30.0, CPU provider, default thread count, one text per call, uncached, from `ner/scripts/bench.ts`. Model time only. blind's core adds about 1 ms on the corpus and 0.5 ms on Gretel. RSS is the process at the end of the run.

| model | file size | corpus ms per file, p50 / p95 | Gretel ms per file, p50 / p95 | RSS |
| --- | --- | --- | --- | --- |
| GLiNER `gliner_multi-v2.1` fp32 | 1,157 MB | 51 / 77 | 113 / 171 | 2.1 GB |
| DeBERTa fp32 | 1,114 MB | 44 / 62 | 80 / 139 | 2.0 to 3.1 GB |
| DeBERTa int8 (weight-only) | 348 MB | 52 / 64 | 89 / 153 | 1.1 GB |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Add the 16 MB `tokenizer.json` to each DeBERTa file. The fp32 model is 14% to 29% faster than GLiNER, because it runs one pass per window with no label prompt and no span enumeration. int8 is a third of the size and needs half the memory, at about GLiNER's speed on the CPU. It scores within 0.6 points of fp32 everywhere above, except org precision on privy's 50 orgs, where it is 1.4 points lower. 192M of the model's 278M weights are the 250k-token multilingual embedding table, so pruning the vocabulary to the tokens Spanish and English text uses would shrink both files much further. That was not tried.

## Round trip

`unblind(blind(x)) === x` held in every file of every dataset with every model plugged in: 379/379 on the corpus in bare and known mode, fp32 and int8, for both variants, 888/888 on Gretel, and 1,000/1,000 on each held-out set, all in the default `fake` mode. The model tests also check all three `replaceWith` modes on the adversarial round-trip cases, and 379/379 bare and known for fp32 and int8.

## Recommendation

Do not replace GLiNER as the default. On the neutral set the model loses 22 points of org recall and, in the `full` variant, 14 points of place recall, and it gains no person precision. A privacy tool cannot trade recall for precision that way by default.

The model is worth keeping as an opt-in backend for structured and finance documents, where it removes the role-word noise and doubles precision at the same person recall. Ship the weight-only int8 file if it ships: 348 MB, same accuracy as fp32. The next round should fix the two named losses before it is compared with GLiNER again:

1. Orgs that are institutions and venues (banks, hospitals, universities, stadiums, agencies), which the training data barely labels.
2. Towns. Train on Gretel with its towns labelled, for example by tagging bare town names with a gazetteer or a teacher model, or by not counting a loss on capitalised words Gretel leaves unlabelled.

Two cheaper things are also worth a run. A third epoch for `full`, whose validation F1 was still rising. And a hybrid that keeps GLiNER for recall and uses this model only to veto role words.

## How to reproduce

```sh
pnpm install
pnpm ner:download                 # GLiNER, for the comparison columns
pnpm bench:gretel:setup           # the pinned Gretel test parquet, for the leakage check and the Gretel sample
pnpm ner:train:setup              # .local/train-venv from ner/train/requirements.txt, then fetch and hash-check every source
PY=.local/train-venv/bin/python
$PY -I ner/train/prepare.py pools
pnpm exec tsx --tsconfig ner/tsconfig.json ner/scripts/gen-train-emails.ts
$PY -I ner/train/prepare.py build --variant full
$PY -I ner/train/prepare.py build --variant nogretel
$PY -I ner/train/train.py --variant full --epochs 2        # 2 h 28 min on an M4 Max
$PY -I ner/train/train.py --variant nogretel --epochs 2    # stops early, 51 min
$PY -I ner/train/export.py ner/models/blind-ner-deberta-full full
$PY -I ner/train/export.py ner/models/blind-ner-deberta-nogretel nogretel
zsh ner/train/bench.sh            # current model comparisons; LLM Guard execution is retired
pnpm test:ner                     # runs the token-classifier model tests when the full model is present
```

The LLM Guard columns are historical: its archived release requires vulnerable dependencies, so its install manifest and execution paths have been removed. Existing raw result files can still be scored. Presidio raw files come from `pnpm bench:presidio` and `pnpm bench:gretel`; its maintained environment has also been updated since the measurements above. See [the benchmark status](../scripts/bench/RESULTS-llmguard-gretel.md). MPS training is not bit-exact from run to run, so a retrained model may differ in the last digits. The weights below are the ones measured here.

## Weights

Not in the repository. `ner/models/` is ignored by git. On the machine that produced this file:

| file | SHA-256 | bytes |
| --- | --- | --- |
| `ner/models/blind-ner-deberta-full/onnx/model.onnx` | `305fc8b52356ebb05e57f5b74012fc735ea910c7e7e5ab58f987d2188868bfc1` | 1,113,805,749 |
| `ner/models/blind-ner-deberta-full/onnx/model_int8.onnx` | `54ae7453635b6edd93a2b401e9bc49b2905749b6575d083b9e5028540a612f79` | 348,258,788 |
| `ner/models/blind-ner-deberta-full/pt/model.safetensors` | `ca7173cddd28007688177189a02eb7fc0f57d9c2e747084e3cdaacb6d221fbdc` | |
| `ner/models/blind-ner-deberta-nogretel/onnx/model.onnx` | `512da02801a39dc47a83924cefb3e82436d52a983025e87b729fdac854b9c42e` | 1,113,805,749 |
| `ner/models/blind-ner-deberta-nogretel/onnx/model_int8.onnx` | `4d5757f85aa80bd16a097028ea7bdfa6717880443f61209945a4834ea1e03e35` | 348,258,788 |
| `ner/models/blind-ner-deberta-nogretel/pt/model.safetensors` | `b516660489d230b171fbd68fd16617e808e0d965f9e44dd53b853eb107c4fa30` | |
| `tokenizer.json`, both | `89ee6ed21d345eba7ad360473bde026240d8cf42fc67723b61162d9605784efa` | 16,034,016 |

Each model directory's `manifest.json` lists every file with its hash and the parity results.

## Round two

Measured on 2026-10-25 on `feat/ner-deberta`. Round one left three named losses on the neutral held-out set: org recall (institutions), place recall (bare towns, which Gretel leaves unlabelled) and person recall. Round two keeps every round-one input, the same Gretel rows and the same evaluation, and changes four things.

### What changed

1. **Institutions in context.** `ner/train/synth.py` writes 24,000 short Spanish and English documents (emails, letters, forms, notes, chat) where banks, hospitals, clinics, universities, schools, ministries and agencies, councils, courts and insurers are labelled org. Half the names come from Wikidata, half are composed from a town or a surname by patterns such as `Hospital General de <town>`, `Juzgado de Primera Instancia n.º 4 de <town>`, `<town> Crown Court` or `Clínica <surname>`. The whole name is the span. An article in front (`el`, `la`, `the`) is outside it.
2. **Bare towns.** The same documents write towns with no address next to them: `vive en <town>`, `born in <town>`, `Localidad: <town>`, the place line of a letter, a signature. Towns come from GeoNames and from Wikidata's list of Spanish municipalities. A region or a country next to a town stays O, the round-one Nemotron rule, and some sentences carry a region or a country alone as O. Whole street addresses are a place span, as before.
3. **Gretel's unlabelled towns get no loss.** See below. No label was added to Gretel.
4. **Three epochs** with early stopping, against two in round one. Everything else in `train.py` is unchanged: learning rate, batches, seed, the MPS memory cap (`PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.5`) and `empty_cache()` every 25 steps.

The synthetic documents also carry hard negatives on purpose: role words as defined terms (`el Prestatario`, `the Bank`, `la Aseguradora`), institution nouns with no name (`el hospital`, `the council`), departments (`Atención al Cliente`, `Human Resources`), months, weekdays, regions and countries. Spanish person names in them come 70% from Wikidata given and family names with their accents (`Aránzazu`, `Díaz del Villar`), which the round-one pools from Nemotron lack, and 30% from those pools.

### The Gretel town problem, and what was done

Gretel labels a street address but not a town on its own, so in a Gretel document an unlabelled `Madrid` is an O, and the model learns to skip it. The fix chosen is the first of the three options: drop the loss on those words, and add no labels.

`prepare.py` (`TownMask`) gives a Gretel word sequence an ignore range when all of these hold:

- it is a town in the round-two gazetteer, matched word for word, case included, up to six words;
- it starts with a capital and lies outside every Gretel label;
- it is not glued to another capitalised word on either side (so `York` inside `New York` and `Madrid` inside `Madrid Stock Exchange` are left alone; 1,609 matches skipped that way);
- its last word is not a particle.

The gazetteer itself drops names that are mostly common lower-case words in the round-one training text (`Reading`, `Church`, `La Compañía`), months and weekdays, names of continents and of the countries of the United Kingdom, a one-word GeoNames place under 5,000 people, and a town that shares its name with a region unless it has 300,000 people (`Delaware` and `Ontario` go, `Madrid` and `Buenos Aires` stay). Every Spanish municipality stays, whatever its size.

`train.py` sets the label of an ignored word to the ignore index, so the loss skips it. Validation does not count a prediction that lies wholly on ignored words, as right or wrong. Nothing else changes: the word still sits in the input, and every Gretel label is as in round one.

The effect is small in size. Of 28,162 Gretel records in `full2`, 1,103 carry a mask, 1,999 occurrences of 280 names. The most masked are `Ciudad de México` 293, `Madrid` 251, `Southampton` 208, `Los Angeles` 99 and `Barcelona` 64. The rule is not perfect: it also masks `Republic` 20 times and `Recuerda`, a Spanish municipality that is also a verb, 9 times. A wrong mask only removes an O from the loss, it never adds a label. Only about 2,000 town occurrences were masked, against 43,060 town and address labels in the synthetic data, and no run separates the two, so the place gain below cannot be split between the mask and the new data. Most of it is probably the new data. Gretel was not down-weighted. It keeps the same rows as round one (27,337 training records), which is where the role-word win comes from.

### Round-two data and licences

Every source from round one is used again, with the same rows. The new inputs:

| source | licence | version | used for |
| --- | --- | --- | --- |
| [GeoNames](https://www.geonames.org) `cities500.zip`, `countryInfo.txt`, `admin1CodesASCII.txt` | CC BY 4.0 | dump of 2026-10-24, SHA-256 below | towns, regions and countries for `synth.py` and the Gretel mask |
| [Wikidata](https://www.wikidata.org), 19 SPARQL queries in `gazetteer.py` | CC0 1.0 | fetched 2026-10-25, 00:45 to 01:45 UTC, SHA-256 in `.local/gaz/manifest.json` | institution names by type, Spanish municipalities, Spanish and English names of towns of 150,000 or more, Spanish given and family names |
| `ner/train/synth.py`, new templates in this repository | MIT, this repository | this commit | 24,000 training documents |

Neither GeoNames nor Wikidata has a fixed revision, so `gazetteer.py fetch` saves each file with its SHA-256, and `build` refuses a file whose hash has changed. Neither licence restricts commercial use or a derived model. CC0 asks for nothing. CC BY 4.0 asks for credit.

**Attribution.** The round-two model carries everything round one does (Nemotron-PII under CC BY 4.0, the Gretel datasets under Apache 2.0, mDeBERTa under MIT), and also: *Town names from GeoNames (https://www.geonames.org), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).* Wikidata content is CC0 and needs no credit, but the model card should say it was used.

**What the lists hold** after `gazetteer.py build`:

- Towns: 17,465 in Spanish-speaking countries (GeoNames places of 500 or more people, plus every Spanish municipality in Wikidata), 13,118 in the US, UK, Ireland, Canada, Australia and New Zealand, and 3,890 elsewhere with 150,000 people or more. Their Spanish and English names from Wikidata are added, so exonyms such as `Londres` are there. The country list and the cut-offs were fixed before any round-two score.
- Institutions from Wikidata, by the class of the item (P31): banks 1,163 Spanish and 4,411 English labels, hospitals and clinics 8,687 and 6,796, universities and colleges 2,960 and 25,742, secondary schools 11,522 and 20,685, insurers 97 and 635, ministries and agencies 1,311 and 5,439, courts 68 and 184. Labels with brackets, commas or digits only, or that are just a class word (`Hospital`), are dropped. Banks, universities and insurers are taken from every country, the rest from the 27 countries above. The university query stops at 40,000 rows, and the generic `school` and `primary school` classes are left out because their query timed out.
- 1,090 Spanish given names and 4,534 family names, the items whose native label (P1705) is Spanish.

Every list drops a name that equals a person, org or place value of the 379 corpus files or holds one of their distinctive words (1,387 towns, 1,810 institution labels, 120 names), so no corpus value is a training label, as in round one.

**Not used.** Nothing from ai4privacy, Isotonic, an NC source or a source without a licence. Nothing was taken from urchade, privy, the corpus or the Gretel benchmark sample. The template sentences were written before the held-out results were looked at, from the categories in the brief, not from held-out entities.

### Round-two training data

| variant | training records | by source | spans (person, org, place) |
| --- | --- | --- | --- |
| `full` (round one) | 55,671 | Nemotron 24,248, Gretel finance 11,625 en + 4,037 es, Gretel masking 11,675, emails 4,086 | 64,656, 46,282, 26,082 |
| `full2` (round two) | 78,934 | the same rows, plus synth 23,263 | 95,981, 108,539, 67,791 |

Spanish documents go from 5,788 to 18,405. Validation is 3% of each source by a hash of the record id, as before, so the round-one validation records are all in it, plus 737 synth records: 2,428 in all. 90,552 windows and 20.2M tokens per epoch.

No `nogretel` variant was trained in round two. Its round-one numbers stay in the tables for reference.

### Round-two training

Same settings as round one, three epochs: 21,564 steps in 3 h 39 min on the M4 Max, with the MPS memory cap. Validation micro F1 per quarter epoch: 0.924, 0.931, 0.943, 0.946, 0.950, 0.945, 0.956, 0.956, 0.952, 0.959, 0.959, 0.961. The best checkpoint is the last one, so a fourth epoch might still add a little. Early stopping never fired.

That validation F1 is not comparable with round one's 0.927, because the split now holds synth records. On the same round-two split, by source, round one against round two (micro F1, fp32 ONNX):

| source | records | round one | round two |
| --- | --- | --- | --- |
| synth | 737 | 0.624 | 0.996 |
| Nemotron | 752 | 0.980 | 0.979 |
| Gretel finance en | 375 | 0.880 | 0.883 |
| Gretel finance es | 125 | 0.821 | 0.811 |
| Gretel masking | 325 | 0.903 | 0.907 |
| emails | 114 | 1.000 | 1.000 |

Round two learned the synthetic documents almost perfectly and held everything else level. The results below show that this did not carry over to the held-out set as much as it does here: 0.996 on synth means the templates are easy, not that institutions are solved.

Export as before. Against PyTorch on the validation split: fp32 100% word label agreement, F1 0.9611; weight-only int8 99.994%, F1 0.9609; dynamic int8 0.7567, still not usable.

### Round-two results

Same corpus, same Gretel 888 sample (in-domain for both `full` and `full2`, which train on Gretel's train split), same neutral held-out set, same scripts (`scripts/bench/score.ts` and `score-gretel.ts` through the `--tc` flags in `ner/train/bench.sh`), detector default threshold 0.3, bare mode. R is strict recall and P precision, in percent. GLiNER, LLM Guard and round one are rescored from the same caches as round one and match its tables exactly.

**Neutral held-out set, urchade, 1,000 files.** The number that decides the default.

| tool | person R | person P | org R | org P | place R | place P | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM Guard all | 40.9 | 74.0 | 38.6 | 94.0 | 84.9 | 37.7 | 1000/1000 |
| blind + GLiNER 0.3 | 71.2 | 61.3 | 97.5 | 48.7 | 98.8 | 51.5 | 1000/1000 |
| blind + GLiNER 0.5 | 69.0 | 63.1 | 95.7 | 55.5 | 97.8 | 52.4 | 1000/1000 |
| DeBERTa round one | 66.9 | 60.5 | 75.8 | 70.1 | 84.4 | 49.6 | 1000/1000 |
| DeBERTa round one no-Gretel | 64.8 | 61.3 | 71.6 | 81.7 | 96.1 | 38.9 | 1000/1000 |
| **DeBERTa round two** | **66.0** | **60.8** | **76.5** | **68.5** | **91.9** | **46.9** | 1000/1000 |
| DeBERTa round two int8 | 66.0 | 60.9 | 76.5 | 68.3 | 91.9 | 46.9 | 1000/1000 |
| DeBERTa round two 0.5 | 65.9 | 60.9 | 70.4 | 69.3 | 88.7 | 48.1 | 1000/1000 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

By language, round one then round two: Spanish org recall 79.9 then 83.1, Spanish place recall 84.5 then 94.8; English org recall 71.2 then 69.4, English place recall 84.3 then 88.9. Person moved less than a point either way in both languages.

**Gretel sample, 888 files (in-domain).**

| tool | person R | person P | org R | org P | place R | place P | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM Guard all | 40.9 | 82.3 | 24.4 | 88.3 | 91.0 | 58.4 | 888/888 |
| blind + GLiNER 0.3 | 79.7 | 39.8 | 99.8 | 29.4 | 98.6 | 47.4 | 888/888 |
| blind + GLiNER 0.5 | 78.5 | 44.4 | 99.3 | 34.5 | 94.9 | 51.9 | 888/888 |
| DeBERTa round one | 78.2 | 75.9 | 86.4 | 71.2 | 93.2 | 89.5 | 888/888 |
| **DeBERTa round two** | **78.2** | **76.9** | **88.4** | **69.3** | **93.2** | **87.0** | 888/888 |
| DeBERTa round two int8 | 78.2 | 76.9 | 88.5 | 70.4 | 93.2 | 87.0 | 888/888 |
| DeBERTa round two 0.5 | 76.0 | 83.8 | 84.7 | 76.1 | 92.9 | 89.8 | 888/888 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm. The blind bare and GLiNER rows on Gretel were measured again on 11 November 2026 with core 0.2.0; the other rows are from the October runs. GLiNER person precision was 40.1 at 0.3 and 44.9 at 0.5 in October. The change against the October run comes from core 0.2.0's own name detection, whose spans merge with the model's.

**Corpus, 379 files (home ground).**

| tool | person R | person P | org R | org P | place R | place P | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| LLM Guard all_tld | 74.5 | 92.5 | 31.9 | 100.0 | 99.4 | 58.2 | 379/379 |
| blind + GLiNER 0.3 | 98.7 | 96.6 | 97.7 | 92.7 | 99.4 | 88.6 | 379/379 |
| blind + GLiNER 0.5 | 98.1 | 96.9 | 97.1 | 93.5 | 96.0 | 90.4 | 379/379 |
| DeBERTa round one | 99.9 | 97.1 | 100.0 | 98.5 | 99.4 | 100.0 | 379/379 |
| **DeBERTa round two** | **99.9** | **97.1** | **100.0** | **98.5** | **100.0** | **99.4** | 379/379 |
| DeBERTa round two int8 | 99.9 | 97.1 | 100.0 | 98.5 | 100.0 | 99.4 | 379/379 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

On the 43 handwritten files round two finds the place round one missed (place 100 R, 95.0 P, against 95.0 and 100) and one more person (99.2 R against 98.4). Org is unchanged at 100 R and 65.5 P. Known mode round trips 379 of 379 too.

**Other held-out sets**, round two fp32: privy person 92.9 R and 89.3 P (round one 94.2 and 81.0), org 90.0 and 73.3 (88.0 and 76.8), place 40.5 and 97.8 (42.8 and 99.0). Nemotron test, in-distribution: person 97.3 and 98.5, org 98.6 and 93.4, place 98.1 and 96.8 (round one 96.7 and 94.8 for place).

**Role words on Gretel**, raw spans whose whole text is a role word, from `ner/train/roles.py`:

| model | role-word person or org spans | of all person and org spans |
| --- | --- | --- |
| GLiNER 0.3 | 1,291 | 6,300 |
| GLiNER 0.5 | 1,123 | 5,257 |
| DeBERTa round one | 16 | 2,786 |
| DeBERTa round one no-Gretel | 5 | 1,901 |
| **DeBERTa round two** | **16** (`empresa` 11) | 2,803 |
| DeBERTa round two int8 | 15 | 2,802 |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

**Size and speed**, measured in one session after training, same machine and method as round one (Node, onnxruntime-node CPU, one text per call, uncached, model time only):

| model | file size | corpus ms per file, p50 / p95 | Gretel ms per file, p50 / p95 | RSS |
| --- | --- | --- | --- | --- |
| GLiNER fp32 | 1,157 MB | 51 / 79 | 112 / 165 | 2.1 GB |
| DeBERTa round one fp32 | 1,114 MB | 43 / 61 | 79 / 138 | 2.0 to 3.1 GB |
| DeBERTa round one int8 | 348 MB | 52 / 64 | 88 / 151 | 1.1 GB |
| DeBERTa round two fp32 | 1,114 MB | 43 / 61 | 79 / 139 | 2.0 to 3.1 GB |
| DeBERTa round two int8 | 348 MB | 52 / 64 | 88 / 151 | 1.1 GB |

The GLiNER and DeBERTa rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Same architecture, so the same size and speed. Plus the 16 MB `tokenizer.json`.

**Round trip.** `unblind(blind(x)) === x` held everywhere with round two plugged in: 379/379 on the corpus in bare and known mode for fp32 and int8, 888/888 on Gretel, 1,000/1,000 on each of the three held-out sets. `BLIND_NER_TC_MODEL=ner/models/blind-ner-deberta-full2 pnpm test:ner` passes all 32 tests, including span parity with the Python pipeline, the round trips in every `replaceWith` mode and the role-word contract.

### Wins and losses

**Wins.**

- **Bare towns.** Neutral place recall 84.4 to 91.9, and 94.8 on the Spanish half. The `city` label goes from 74% to 85% covered on raw spans and `location` from 68% to 77%. This is most of what the no-Gretel variant showed was possible (96.1), without dropping Gretel.
- **Named institutions, where the set labels them as such.** On the neutral labels `bank`, `hospital`, `educational institution` and `insurance company` (45 labels in all), raw-span coverage goes from 20% to 40% for the 15 banks, from 45% to 100% for the 11 hospitals and from 50% to 67% for the 6 insurers. Education stays at 83%. These are small counts.
- **Spanish orgs.** Neutral Spanish org recall 79.9 to 83.1.
- **Precision and role words held.** Role-word spans on Gretel stay at 16. Gretel person precision rises a point (75.9 to 76.9), org recall rises 2 points (86.4 to 88.4). Privy person precision goes from 81.0 to 89.3.
- **Home ground.** The handwritten place round one missed is found.

**Losses.**

- **Org recall on the neutral set did not move**: 75.8 to 76.5, against GLiNER's 97.5. The brief's diagnosis, institutions, covers only 45 of the set's 669 org labels. 603 of the set's org labels start with a capital, and round two covers 76% of them on raw spans, exactly as round one did, against GLiNER's 88%. The ones GLiNER finds and round two misses are mostly venues, shops, museums, embassies, casinos, newspapers and brands, and some well-known universities and banks that round two still misses in the set's sentences, although names of the same shape are in its training data. Another 66 org labels are lower-case common nouns (`grocery store`, `gym`, `hospital`), which the set labels as orgs and blind's training data treats as O on purpose; GLiNER covers 70% of those and round two 26%.
- **English neutral org recall fell** 1.8 points, 71.2 to 69.4.
- **Org and place precision fell**: neutral org 70.1 to 68.5, place 49.6 to 46.9; Gretel org 71.2 to 69.3, place 89.5 to 87.0. On the neutral set part of the place drop is towns the set does not label, so it is partly a floor, but on Gretel it is a real cost.
- **Person did not improve**: neutral 66.9 R and 60.5 P to 66.0 and 60.8. Accented Spanish names in the synthetic data did not change Spanish person recall (73.7 to 73.0).
- **The synthetic data generalises less than its validation score says.** 0.996 F1 on held-back synth records against a 0.7 point org gain on the neutral set. The templates are short and regular, and the model learned them, not institutions in general.
- **Privy place recall** 42.8 to 40.5 and org precision 76.8 to 73.3, on a set whose places and 50 orgs say little.

**Overlap between the new name lists and the held-out set**, checked after the final run: 113 of the neutral set's 815 place label values (14%) and 20 of its 669 org label values (3%) appear verbatim in the round-two lists, because the lists hold real towns and institutions and so does the set. None were taken from it. Some of the place gain may come from having seen a town's name, not from context.

**Looking at the held-out set.** The held-out sets were scored once, with the final checkpoint, after training and export. No threshold, data mix or template was chosen from them, and no second model was trained after seeing them. The miss analysis above was done on those final numbers to write this section.

### Round-two recommendation

**Do not make it the default.** Round two closes most of the town gap and keeps the precision and role-word wins, but the gap that matters most for a privacy tool, org recall away from home, is 21 points behind GLiNER, as it was. A missed org is a leak.

Keep it as the opt-in backend instead of the round-one weights: it is better or level on almost every count, at the same size and speed, and it fixes towns. Ship the weight-only int8 file if it ships.

What would move org recall next, judged from the analysis above and to be checked on a validation split, not the held-out set: venues, shops, museums, embassies, media and brands as org in many sentence shapes, not only institutions in templates; longer and less regular synthetic text, for example with a licensed generator model writing around listed names; and a fourth epoch, since validation F1 was still rising at the end. A hybrid that keeps GLiNER's recall and uses this model to veto role words remains the cheaper option.

### Round-two reproduction

```sh
PY=.local/train-venv/bin/python
$PY -I ner/train/gazetteer.py fetch     # GeoNames and Wikidata into .local/gaz, with SHA-256 in manifest.json
$PY -I ner/train/gazetteer.py build     # .local/gaz/gazetteer.json (reads .local/train/full/train.jsonl for the common-word filter)
$PY -I ner/train/synth.py               # .local/train/synth.jsonl, 24,000 documents
$PY -I ner/train/prepare.py build --variant full2
$PY -I ner/train/train.py --variant full2 --epochs 3     # 3 h 39 min on an M4 Max
$PY -I ner/train/export.py ner/models/blind-ner-deberta-full2 full2
zsh ner/train/bench.sh                  # every table, round one and round two side by side, and reports/tc-roles.txt
BLIND_NER_TC_MODEL=ner/models/blind-ner-deberta-full2 pnpm test:ner
```

Wikidata and GeoNames change, so a fresh fetch gives different lists. The files measured here:

| file | SHA-256 |
| --- | --- |
| `geonames/cities500.zip` | `3eb4471fba711c2e94efd3d01c30c1aa091b5434ae9b50d6a171bc2482e7fae7` |
| `geonames/countryInfo.txt` | `c55f638cfaafb4fe45a9aa15120a0f1f78e8a34a8e1847d7b9320cf740fbc9ab` |
| `geonames/admin1CodesASCII.txt` | `2e4867f5397acb056ea26377601b57af37cb4c81399770225018e9e439e91ad3` |
| `.local/train/synth.jsonl` | `82641a210bb5f9194615426a45d3391bf5193168398c9c761c8753c0f6188630` |

| Wikidata file | rows | SHA-256 |
| --- | --- | --- |
| `wikidata/org-bank.json` | 5,981 | `b9ebb66a13ed847465af6f0fe9a6b283b6e5b46ebcfbda282d9ede140b340ced` |
| `wikidata/org-hospital-es.json` | 8,213 | `87a93f8167561c6db2c51e6b8f2651f984b6eb6c336ee8c62c817df0827eeafc` |
| `wikidata/org-hospital-en.json` | 3,940 | `598021472f860916a502699b97474bf461f1a63e84804e32eca0d5f9e69570ca` |
| `wikidata/org-hospital-us.json` | 5,630 | `53ab5956c30e8911c146791ac8ff4eab38b011d762959a0b330a243fab2be17a` |
| `wikidata/org-university.json` | 40,000 | `db2b73ef4f2c9644cae5e8f313927b465d694c7b3f3924e8974734f6a7f7e172` |
| `wikidata/org-school-es.json` | 16,214 | `5d67f838c9cc142d0a37b241854b8105aa56fcb0bf25d6cf02fc4cdb8fe24263` |
| `wikidata/org-school-en.json` | 9,715 | `49425e7f3bd050d0de01acf914614bd00f5fd9a9023fbe787a8a5c102193a031` |
| `wikidata/org-school-us.json` | 15,581 | `83609baf1ed5fa591fa0885df38dc544995fd8a4d33e73aa22e5454b866ca402` |
| `wikidata/org-insurer.json` | 809 | `902beae02f968145e2921aea361dd034372e9c62d94b8c684ec41c9acf0b97c3` |
| `wikidata/org-government-es.json` | 2,353 | `222d3dfcf3c964f18cc03f6b05db244090efb4cbd69b3779f4ec2bad0489f2a2` |
| `wikidata/org-government-en.json` | 2,381 | `385ea52e23fba6929f8a56497ffb2be76c2b1295e23c727cb420f8ba9729679c` |
| `wikidata/org-government-us.json` | 3,006 | `324a93f43651c3e6f0657c20616ced950be3e7258850209187612618ca98d97c` |
| `wikidata/org-court-es.json` | 109 | `f4de542f4c42b1b0e3e78b94d9b1816f7b69eaf26797961b67db9ac2044f067b` |
| `wikidata/org-court-en.json` | 118 | `a6c52ee15fcf74e5cc26571a327979126e55d730d4746da659e49031ed4b99b1` |
| `wikidata/org-court-us.json` | 47 | `d3b62ea59ca00a98df789d7265130b197761230fe79c464d0aab15edad7e9b19` |
| `wikidata/name-first.json` | 1,210 | `af8f8926c5cace8c4bbe30437e6198c7353d1bdac224f0fad663e3f0b486511e` |
| `wikidata/name-last.json` | 4,889 | `70b3a71deba2989896063d484994de10a62526de7d505c106ea939bcd9106655` |
| `wikidata/town-es-municipality.json` | 6,202 | `e3dd017cfee8e91b39d5855cb6daf3f8b4a6f03714b41d4df9e5ccdd2cdbf91d` |
| `wikidata/town-labels.json` | 26,952 | `81b39a48e81101f4d1f784096475eb03a3a6a7721c8a0431b1281399cda7efb6` |

The 19 Wikidata files are hashed in `.local/gaz/manifest.json`, and `fetch` refuses a file on disk whose hash no longer matches it. `gazetteer.json` carries its build time, so its own hash changes on every build; rebuilt from the same inputs, `synth.jsonl` came out byte for byte the same.

### Round-two weights

Not in the repository. On the machine that produced this section:

| file | SHA-256 | bytes |
| --- | --- | --- |
| `ner/models/blind-ner-deberta-full2/onnx/model.onnx` | `ce8801f13ac76495f71fc4a900f1b616bf698457b7275a6ab930aae96f8bb0b3` | 1,113,805,749 |
| `ner/models/blind-ner-deberta-full2/onnx/model_int8.onnx` | `edf178ca3b7265e2f241b6e25fe677a34daf06395658e327d59c5aca06f27486` | 348,258,788 |
| `ner/models/blind-ner-deberta-full2/pt/model.safetensors` | `8fdf6f27fbc062d64991f0c39822f8edb5841cf2e3f472e06bd13454d083ae90` | |
| `ner/models/blind-ner-deberta-full2/tokenizer.json` | `89ee6ed21d345eba7ad360473bde026240d8cf42fc67723b61162d9605784efa` | 16,034,016 |
