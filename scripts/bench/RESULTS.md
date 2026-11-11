# blind against Presidio on blind's corpus

Run on 2026-10-24 at commit `4f5183f` on `fix/round-trip`, with `src` matching the commit (`srcDirty: false`). That commit has the detectors of the previous run at `dbcb94c`: typed id recognizers, context words, conversation mapping, streaming unblind, names found again where they repeat bare, company sender names read as orgs, full company names found again, and names right before an address in mid-sentence. On top of that it has the round-trip fixes from PR #13 and a second GLiNER threshold in the scorer. The corpus is the 379 files in `corpus/generated` and `corpus/handwritten`, with 116 English, 164 Spanish and 99 mixed. Two handwritten files, `004-booking-en` and `005-booking-es`, gained an org annotation in their From line, so org has 656 annotations. All numbers below come from `reports/presidio-bench.json` and were printed by `scripts/bench/score.ts`.

LLM Guard's columns on this corpus, and a second run of all three tools on a sample of Gretel's synthetic finance documents, are in [RESULTS-llmguard-gretel.md](RESULTS-llmguard-gretel.md). Before the round-trip fix, the Gretel run found round-trip failures in blind that this corpus does not show. After it, blind round trips every file on both datasets.

## Rerun of the blind columns on 2026-11-11

The blind columns were rerun on 2026-11-11 at commit `5369e57`, which carries core `0.2.0`: greetings, signatures, labels, legal suffixes and private addresses now anchor names, and long known lists match without a pattern per entry. The corpus is now 381 files. The two added handwritten cases, one in Hebrew and one in Arabic, add 4 person, 3 org, 4 email, 2 amount and 2 date annotations, so the counts differ from the October tables by those numbers. The command was `scripts/bench/score.ts` as `pnpm bench:presidio` runs it, without Presidio's raw output, so it scored only the blind columns. Presidio was not rerun: every Presidio number, and every table and paragraph below this section, is from the 2026-10-24 run on 379 files. The + GLiNER columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Strict recall, all 381 files:

| kind | annotated | blind bare | blind known | blind bare + GLiNER | blind bare + GLiNER 0.5 | blind known + GLiNER |
| --- | --- | --- | --- | --- | --- | --- |
| person | 1426 | 85.1% | 99.3% | 99.6% | 99.6% | 99.9% |
| org | 659 | 98.2% | 99.7% | 98.9% | 98.9% | 100.0% |
| place | 174 | 0.0% | 0.6% | 99.4% | 96.0% | 99.4% |
| email | 1105 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| url | 265 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| phone | 406 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| iban | 106 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| id | 363 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| amount | 739 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| date | 909 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Person, org and place recall by language, bare mode, core alone then with GLiNER at 0.3: English (116 files) 87.9% to 99.8%, 99.5% to 100.0% and 0.0% to 100.0%. Spanish (164 files) 82.6% to 99.8%, 98.2% to 98.9% and 0.0% to 98.7%. Mixed (99 files) 86.9% to 100.0%, 98.3% to 98.9% and 0.0% to 100.0%.

Precision, all 381 files, correct of replaced:

| kind | blind bare | blind known | blind bare + GLiNER | blind bare + GLiNER 0.5 | blind known + GLiNER |
| --- | --- | --- | --- | --- | --- |
| person | 97.1% (1512/1557) | 97.1% (1485/1530) | 96.7% (1422/1470) | 96.9% (1422/1468) | 96.7% (1426/1475) |
| org | 99.2% (644/649) | 99.2% (654/659) | 93.1% (651/699) | 93.8% (651/694) | 93.2% (657/705) |
| place | n/a (0/0) | 100.0% (1/1) | 90.2% (157/174) | 92.7% (152/164) | 90.8% (157/173) |
| any kind | 98.6% (6054/6139) | 98.6% (6038/6123) | 97.9% (6143/6276) | 98.0% (6135/6259) | 97.9% (6153/6286) |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

The other kinds have the same precision as before in every blind column: email 96.6%, url, phone, iban, id and date 100.0%, amount 99.9%. Every blind run round trips 381 of 381 files. With core 0.2.0 the core alone now beats every Presidio configuration of the October run on persons and orgs, so the "Where Presidio wins" section below describes the October core. GLiNER now adds mostly places and the last people, at a cost of 6.1 points of org precision in bare mode.

The amounts and dates table below is still the October run.

## What changed since the previous run

PR #13 claims that recall, precision and amount usability did not move. On this corpus that holds to the span. Every recall, precision, coverage and usability count for the four blind runs is the same as in the run at `dbcb94c`, and the round trip was 379/379 before and after. Presidio's three columns are also the same to the span. The only new numbers are the `blind bare + GLiNER 0.5` column and the timings below.

## Versions

- Presidio: `presidio-analyzer` 2.2.364 and `presidio-anonymizer` 2.2.364.
- spaCy 3.8.16 with `en_core_web_lg` 3.8.0 and `es_core_news_lg` 3.8.0. Both are the large models, about 425 MB and 600 MB installed, so download size did not force a smaller one.
- GLiNER: `onnx-community/gliner_multi-v2.1`, fp32 ONNX export, 1.1 GB, fetched by `pnpm ner:download` with its SHA-256 checked. It runs through `@centrst/blind-ner` at its default threshold of 0.3, and once more at 0.5 for one extra column. `@centrst/blind-ner` is a prototype built from this repository, not on npm, so every GLiNER number in this file comes from that prototype.
- Python 3.12.15, Node v26.11.1, macOS 27.0.1 on arm64.
- Every Python package is pinned in `scripts/bench/requirements.txt`, which is a `pip freeze` of the venv.

## Running the benchmark now

The results above used Presidio 2.2.364. The maintained environment now pins Presidio 2.2.366 and cryptography 50.0.2 to address dependency advisories. The historical measurements below have not been replaced with results from these newer versions. The original environment is recorded in the [initial import](https://github.com/centrst/blind/blob/f1be8889ae5c01a064878dec619f8983d95227f2/scripts/bench/requirements.txt); it contains vulnerable dependencies and is not a supported installation.

```
pnpm bench:presidio:setup   # once: venv in .local/presidio-venv, about 1 GB with both spaCy models
pnpm ner:download           # once: the GLiNER weights, 1.1 GB. Without them the + GLiNER columns are skipped
pnpm bench:presidio         # export corpus, run Presidio, score every column
```

`bench:presidio` runs three steps. `export-corpus.ts` strips the annotations with the same parser `pnpm corpus` uses and writes `reports/presidio-input.json`. `presidio.py` runs Presidio and writes `reports/presidio-raw.json`. `score.ts` scores every tool and writes `reports/presidio-bench.json`. It runs under `tsx --tsconfig ner/tsconfig.json`, so the ner package and this script share the same core in `src/`. Presidio takes about 7.4 seconds per configuration for the whole corpus. GLiNER took 49 ms per file on the CPU at threshold 0.3 and 50 ms at 0.5. An earlier version of this file quoted 88 ms, from the first uncached run on 2026-10-23 on the same machine. I do not know why that run was slower. `score.ts` caches the model output in `.local/`, one file per threshold, keyed by text and labels. The cache holds only what the model returned, so blind, the NER detector and its name propagation run live on every call. This run started with no cache. `bench:llmguard` then ran `score.ts` again on the cache this run had just written. `reports/` is gitignored, so the JSON files live only on the machine that ran them.

## What was measured

Recall and precision use blind's own scorer from `test/support/corpus.ts`, with no changes. Recall is strict. An annotated value counts as found only when it is gone from the whole output as a whole word, with accents and case folded. For a person, every name token of three or more letters has to be gone. Precision is the share of replaced spans that overlap an annotation of the same kind. "Any kind" precision counts a replaced span as correct when it overlaps any annotation, so a Presidio PERSON on an org name counts there but not in the person row.

Presidio runs with its defaults. That means every predefined recognizer enabled for `en` and `es` in its `default_recognizers.yaml`, score threshold 0, the `replace` operator that writes `<PERSON>` and so on, and its default conflict resolution. The language follows the file name. An `-en` file runs the English pipeline and an `-es` file the Spanish one. A `-mixed` file runs both, and the union of the two result lists goes to the anonymizer, which resolves overlaps as usual.

Presidio's entity types map onto blind's kinds as follows. PERSON is person, ORGANIZATION is org, LOCATION is place, EMAIL_ADDRESS is email, URL is url, PHONE_NUMBER is phone, IBAN_CODE is iban and DATE_TIME is date. CREDIT_CARD, the US, UK and ES identity numbers, MEDICAL_LICENSE, IP_ADDRESS, MAC_ADDRESS and CRYPTO all count as id. NRP covers nationalities and religious or political groups. blind has no such kind and the corpus does not annotate it, so its 7 spans are left out of the per-kind rows and still count in "any kind". Presidio has no amount recognizer. Its amount recall is whatever its other recognizers happen to cover.

Three Presidio configurations ran:

- `default` is Presidio as shipped, on the corpus as written.
- `default_tld` is the same, except `.example` becomes `-exa.com` in the text Presidio analyses. The scorer still sees the original text, rebuilt from the replaced spans. Presidio's email recognizer checks the top-level domain and rejects `.example`. Its URL pattern stops at the first known TLD inside the name, for example `.ge` in `gestoria`. Real mail never uses `.example`, and the corpus only uses it because the rules require reserved domains. Without this rewrite, the email and URL rows would measure that corpus convention, not Presidio. I treat `default_tld` as the fair Presidio column.
- `with_org_tld` is `default_tld` with organizations switched back on. Presidio's shipped NER settings drop spaCy's ORG entities, with the note "Has many false positives", so `default` scores close to nothing on org by design.

blind runs in five ways. In `bare` mode nothing is passed. In `known` mode the `%known` header values are passed, the way the CLI is meant to be used. Both modes then run again with the GLiNER detector plugged in through the `detectors` option. That follows `ner/scripts/eval.ts` and `ner/test/model.test.ts`: one `createNerDetector(model).prepare([text])` per file, and the prepared detector passed to `scoreCorpus` and `blind`. Bare mode runs a fifth time with the detector at threshold 0.5, the `blind bare + GLiNER 0.5` column. Every other + GLiNER column uses the default, 0.3. Presidio has no run that matches `known` mode. Its deny-list recognizer could do the same job, but this run did not measure that.

## Strict recall, all 379 files

| kind | annotated | Presidio default | Presidio default_tld | Presidio with_org_tld | blind bare | blind known | blind bare + GLiNER | blind bare + GLiNER 0.5 | blind known + GLiNER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| person | 1422 | 51.4% | 66.5% | 70.3% | 67.3% | 98.7% | 98.7% | 98.1% | 99.9% |
| org | 656 | 12.5% | 12.3% | 62.6% | 29.9% | 51.8% | 97.7% | 97.1% | 99.7% |
| place | 174 | 62.6% | 66.7% | 89.7% | 0.0% | 0.6% | 99.4% | 96.0% | 99.4% |
| email | 1101 | 45.6% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| url | 265 | 89.1% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| phone | 406 | 62.8% | 62.8% | 64.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| iban | 106 | 91.5% | 91.5% | 91.5% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| id | 363 | 29.5% | 29.5% | 33.9% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| amount | 737 | 3.3% | 3.3% | 7.7% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| date | 907 | 57.9% | 57.9% | 58.2% | 99.9% | 99.9% | 99.9% | 99.9% | 99.9% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

## Precision, all files

Each cell shows correct spans over replaced spans. n/a means the tool replaced nothing of that kind.

| kind | Presidio default | Presidio default_tld | Presidio with_org_tld | blind bare | blind known | blind bare + GLiNER | blind bare + GLiNER 0.5 | blind known + GLiNER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| person | 77.8% (1139/1463) | 78.5% (1132/1442) | 78.8% (1126/1428) | 95.5% (1262/1321) | 96.9% (1660/1713) | 96.6% (1403/1452) | 96.9% (1396/1440) | 96.6% (1421/1471) |
| org | n/a (0/0) | n/a (0/0) | 43.8% (340/777) | 97.8% (181/185) | 98.8% (331/335) | 92.7% (634/684) | 93.5% (630/674) | 93.0% (648/697) |
| place | 21.9% (109/498) | 23.6% (112/475) | 23.3% (108/464) | n/a (0/0) | 100.0% (1/1) | 88.6% (156/176) | 90.4% (151/167) | 89.1% (156/175) |
| email | 93.5% (331/354) | 96.6% (1095/1134) | 96.5% (1086/1125) | 96.6% (1101/1140) | 96.6% (1101/1140) | 96.6% (1101/1140) | 96.6% (1101/1140) | 96.6% (1101/1140) |
| url | 68.4% (266/389) | 100.0% (246/246) | 100.0% (223/223) | 100.0% (265/265) | 100.0% (265/265) | 100.0% (265/265) | 100.0% (265/265) | 100.0% (265/265) |
| phone | 94.0% (233/248) | 94.0% (233/248) | 94.3% (232/246) | 100.0% (406/406) | 100.0% (406/406) | 100.0% (406/406) | 100.0% (406/406) | 100.0% (406/406) |
| iban | 100.0% (89/89) | 100.0% (89/89) | 100.0% (88/88) | 100.0% (106/106) | 100.0% (106/106) | 100.0% (106/106) | 100.0% (106/106) | 100.0% (106/106) |
| id | 55.8% (58/104) | 80.6% (58/72) | 79.1% (53/67) | 100.0% (363/363) | 100.0% (363/363) | 100.0% (363/363) | 100.0% (363/363) | 100.0% (363/363) |
| amount | n/a (0/0) | n/a (0/0) | n/a (0/0) | 99.9% (737/738) | 99.9% (737/738) | 99.9% (737/738) | 99.9% (737/738) | 99.9% (737/738) |
| date | 73.9% (500/677) | 73.9% (500/677) | 73.6% (493/670) | 100.0% (907/907) | 100.0% (907/907) | 100.0% (907/907) | 100.0% (907/907) | 100.0% (907/907) |
| any kind | 85.0% (3253/3829) | 86.5% (3799/4390) | 83.2% (4240/5095) | 98.4% (5346/5431) | 98.6% (5889/5974) | 97.9% (6105/6237) | 98.1% (6086/6206) | 97.9% (6136/6268) |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

## Amounts and dates for use with a model

This part runs offline and makes no model calls. For each annotated amount and date it asks what a model reading the rewritten text gets.

- Replaced means the strict scorer finds the value gone from the output. For blind that means scaled or shifted, not hidden: one known real amount or date gives away the rest (see [THREAT-MODEL.md](../../docs/THREAT-MODEL.md)).
- Usable means the model can still do arithmetic with the value. That holds when the value is still there in clear text, among other values that are also in clear text. It also holds when the tool rewrote it by one rule for the whole text. For blind, the script checks every amount against the mapping: the fake must equal the real value times the call's factor, within 0.5% or 5 cents, since blind re-derives sums and percentages from rounded operands. It checks every date too: the fake must be the real date moved by the call's `dayShift`, which must be a nonzero whole number of weeks. For Presidio, a value replaced by `<DATE_TIME>` or any other placeholder has nothing left to compute with.
- Replaced and usable is the column that matters for sending private mail to a model.
- Round trip means `unblind(output, mapping)` gives back the input exactly.

| tool | amounts replaced | amounts usable | amounts replaced and usable | dates replaced | dates usable | dates replaced and usable | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Presidio default | 3.3% | 96.7% | 0.0% | 57.9% | 42.1% | 0.0% | not possible |
| Presidio default_tld | 3.3% | 96.7% | 0.0% | 57.9% | 42.1% | 0.0% | not possible |
| Presidio with_org_tld | 7.7% | 92.3% | 0.0% | 58.2% | 41.8% | 0.0% | not possible |
| blind bare | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind known | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind bare + GLiNER | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind bare + GLiNER 0.5 | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind known + GLiNER | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |

The `+ GLiNER` rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

The 3.3% of amounts Presidio replaces are accidents. Other recognizers swallow them: DATE_TIME, PHONE_NUMBER, LOCATION, and ORGANIZATION once orgs are on. Those amounts are lost, not protected. The one blind date that counts as not replaced is the known case from TESTING.md, where two dates sit two weeks apart and the shift lands one on the other's real string. It was still shifted correctly, so it counts as usable. GLiNER changes nothing here, because NER spans never override amount or date spans.

Presidio's `replace` operator keeps no mapping, so an answer that mentions `<PERSON>` cannot be mapped back. It also merges different values into one placeholder. In `default_tld`, all 379 files have at least one placeholder that stands for two or more different values, such as two people who both become `<PERSON>`. A model reading those files cannot tell those values apart. Presidio does have reversible operators, such as `encrypt` and a custom operator with a lookup table, but this run did not measure them.

## Where Presidio wins

On places, and on orgs, against blind's core without the NER package. blind's core has no place detector at all. It removes 0.0% of places in bare mode and 0.6% in known mode. Presidio removes 66.7% in `default_tld` and 89.7% with orgs switched on. On orgs, Presidio `with_org_tld` removes 62.6%, against 29.9% for blind bare and 51.8% for blind known. Presidio pays for that org recall with 43.8% precision, where blind's core is at 97.8%. Still, a user who cares most about not leaking a company name gets more of them hidden by Presidio than by blind's core.

On persons the two are now close, and Presidio still wins in English and mixed mail. Over all files, blind bare removes 67.3% of person values against 66.5% for Presidio `default_tld` and 70.3% for `with_org_tld`. On the 116 English files Presidio `default_tld` removes 76.0% and blind bare 73.2%. On the 99 mixed files Presidio removes 87.4% and blind bare 69.8%. blind bare wins on the 164 Spanish files, at 61.7% against 47.2%. blind's person precision is far higher, 95.5% against 78.5%, so a blind replacement is much less likely to hit a word that is not a name. Once the owner's names are passed as `known`, blind's core removes 98.7% of person values, which Presidio has no direct way to match without a deny list.

With GLiNER plugged in, Presidio no longer wins on any measured kind. blind bare + GLiNER removes 98.7% of person values, 97.7% of orgs and 99.4% of places. Its precision on those kinds is 96.6%, 92.7% and 88.6%, against Presidio's 78.5% person, 43.8% org with orgs on, and 23.6% place. These GLiNER numbers come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Presidio still wins on cost. Its spaCy models are about 1 GB for both languages and processed the corpus in about 7.4 seconds, roughly 20 ms per file. GLiNER is a 1.1 GB fp32 model that took 49 ms per file on the same machine, about two and a half times slower. Presidio also covers more languages and identity formats out of the box than this corpus tests. Adding GLiNER lowers blind's org precision from 97.8% to 92.7% and its any-kind precision from 98.4% to 97.9% in bare mode, because the model tags some words that are not annotated.

## Where blind wins

On structured values and on everything an LLM has to compute with. blind removes 100% of phones, IBANs, ids and amounts, and 99.9% of dates, with or without GLiNER. Presidio `default_tld` removes 62.8% of phones, 91.5% of IBANs, 29.5% of ids and 57.9% of dates, and leaves 96.7% of amounts in clear text. Precision across all kinds is 98.4% for blind bare against 86.5% for Presidio `default_tld`. Per kind, blind's core is higher on person, phone, id and date, and equal on email, url and iban.

On persons in Spanish mail and on persons in known mode. blind bare removes 61.7% of person values in the Spanish files against Presidio's 47.2%. blind known removes 98.7% over all files at 96.9% precision.

The structured gap is widest in Spanish. On the 164 Spanish files, Presidio `default_tld` removes 28.2% of dates, 11.7% of ids, 53.4% of phones and 0.0% of amounts. On the 116 English files the same numbers are 83.8%, 33.9%, 73.0% and 4.8%. Presidio's date patterns are English, and `es_core_news_lg` has only PER, LOC, ORG and MISC labels, no DATE. Its NIF and NIE recognizers are on for Spanish, but most corpus ids are not in those formats. Of the 34 ids shaped like a NIF, only 4 carry a valid check letter, and Presidio rightly rejects the rest. A real NIF always has a valid letter, so this part of the gap is a corpus artifact. The per-language tables are in `reports/presidio-bench.json` under `cards.en`, `cards.es` and `cards.mixed`.

On amounts and dates there is a real trade-off, not a winner by default. Presidio leaves amounts readable because it does not replace them. It replaces about 58% of dates and destroys their values in the process. blind is the only one of the two that both replaces these values and keeps them usable: 100% of amounts and 99.9% of dates. It is also the only one whose answers map back, in 379 of 379 files in all five blind runs.

## GLiNER at threshold 0.5

`ner/CANDIDATES.md` on `feat/ner-candidates` suggests raising the detector's threshold from 0.3 to 0.5 as the cheapest way to gain precision. This run scores 0.5 as one extra column in bare mode, on this corpus and on the Gretel sample in [RESULTS-llmguard-gretel.md](RESULTS-llmguard-gretel.md). The default stays 0.3.

| dataset | kind | recall at 0.3 | recall at 0.5 | precision at 0.3 | precision at 0.5 |
| --- | --- | --- | --- | --- | --- |
| corpus | person | 98.7% | 98.1% | 96.6% | 96.9% |
| corpus | org | 97.7% | 97.1% | 92.7% | 93.5% |
| corpus | place | 99.4% | 96.0% | 88.6% | 90.4% |
| Gretel | person | 79.5% | 78.3% | 40.1% | 44.9% |
| Gretel | org | 98.7% | 98.3% | 29.4% | 34.5% |
| Gretel | place | 98.6% | 94.9% | 47.3% | 51.9% |

Every number in this table comes from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

On the corpus 0.5 gains little, because there is little left to gain. Wrong person, org and place spans drop from 119 to 104. It loses 7 correct person spans, 4 org and 5 place, and the place recall loss is 6 values, all in Spanish files, where place recall falls from 98.7% to 90.8%. Every other kind is unchanged, and so is the round trip at 379/379.

On Gretel the gain is real. Wrong person, org and place spans drop from 5,460 to 4,347, and precision rises by 4.6 to 5.1 points on each kind. Recall falls by 1.2 points on persons, 0.4 on orgs and 3.7 on places. Fully covered places fall further, from 92.0% to 82.7%, so 0.5 leaves more of each address in place. Email recall falls from 96.5% to 95.6%. The round trip holds at 888/888.

0.5 does not make GLiNER precise on Gretel. Its person precision there, 44.9%, is still below Presidio's 54.3% and LLM Guard's 82.3%, and CANDIDATES.md finds that role words like `Borrower` and `Company` are still tagged even at 0.8. The model time does not change, about 107 ms per Gretel file, since the threshold only filters what the model returns. Whether to change the default is a separate decision, and this run does not make it.

## Caveats

- blind's authors wrote this corpus. It is mostly bookings, invoices, tax and social-security mail and newsletters in Spanish and English, the mail blind was built for. Its formats for amounts, dates, phones and ids are the ones blind's detectors were written against. Read it as a home-ground test. A neutral corpus, or Presidio's own evaluation data, would likely narrow the structured-value gap.
- The names in the corpus are invented and often unusual, such as Cordelia Haverford or Remedios Quiroga. Both NER models may behave differently on real names like García or Smith. TESTING.md already warns that the GLiNER numbers are a ceiling for this reason. GLiNER's default threshold was picked after a sweep on this corpus, and its name propagation was built against it. Presidio ran untuned, so the + GLiNER columns have a home advantage of their own.
- The same holds for blind's core on persons and orgs. Its rules for repeated names, company senders and names before an address were written while looking at this kind of mail. The core starts from a name it found once, in a header, a sender line, a title, the known list or a detector, and then finds it again. Text with no such anchor, such as a pasted paragraph with no headers, gives it less to start from, and its person recall there is likely lower than on this corpus (67.3% in October, 85.1% with core 0.2.0).
- The corpus changed during this work. Two org annotations were added to From lines in `004-booking-en` and `005-booking-es`, by the same team that changed the detectors. Both are company sender names, a hotel and a dental clinic, that had no label before.
- Presidio's results depend on the NLP model. Transformer models, or Presidio's own GLiNER and Stanza integrations, would change the person, org and place rows. Only the spaCy large models were measured. Presidio with a GLiNER recognizer would be the closest like-for-like comparison to blind + GLiNER, and it was not run.
- The corpus does not annotate clock times, phrases like "this month", or street names. Most of Presidio's date false positives are times such as `15:00` and phrases such as "this month". A privacy tool can defend hiding those. Most of its place and person false positives are not defensible, for example "Tel", "Saludos", "Forwarded", "Subject", "Quedamos" and "Atentamente". A few corpus labels are missing, for example an unannotated "Cordelia's" in one subject line, which slightly understates the precision of every tool.
- The `.example` rewrite helps Presidio, and it is a choice I made. The `default` column shows Presidio on the text as written.
- Mixed files run both Presidio pipelines and merge the results. That can only add recall, and it costs some precision.
