# blind against LLM Guard, and all three tools on a dataset blind's authors did not write

Run on 2026-10-24 at commit `4f5183f` on `fix/round-trip`, with `src` matching the commit (`srcDirty: false`). That commit adds the round-trip fixes from PR #13 to the code of the previous run at `2febde1`, and a second GLiNER threshold to the scorers. This file has two parts. Part 1 adds LLM Guard's Anonymize scanner to the corpus benchmark in [RESULTS.md](RESULTS.md). Part 2 scores Presidio, LLM Guard and blind on a sample of Gretel's synthetic finance documents. All numbers come from `reports/presidio-bench.json` and `reports/gretel-bench.json`, printed by `scripts/bench/score.ts` and `scripts/bench/score-gretel.ts`. The Presidio and blind numbers on the corpus are the same as in RESULTS.md, to the span.

## What changed since the previous run

PR #13 says recall, precision and amount usability did not move. For blind that holds to the span on both datasets. On the corpus every blind count is the same as at `2febde1`. On Gretel every recall, precision, coverage and unscored-label count for blind bare and blind with GLiNER is the same, and only the round trip changed, from 879/888 to 888/888 bare and from 798/888 to 888/888 with GLiNER.

Two other tools moved by a few spans, with no change in their code, their venvs or the input:

- LLM Guard `all` and `all_tld` on the corpus. Id precision went from 30.4% (7/23) to 33.3% (7/21) in `all`, and from 31.8% (7/22) to 35.0% (7/20) in `all_tld`. Phone precision in `all` went from 96.7% to 96.8%. With so few id spans, two fewer wrong ones move the percentage by about 3 points. This is the run-to-run noise on the MPS GPU described in the caveats. Recall did not move.
- Presidio on Gretel. Phone precision went from 25.3% to 25.1% in `default` and from 25.6% to 25.4% in `with_org`, and id precision went down by 0.1 point in both. In 14 English files in `default` and 13 in `with_org`, a bare 9 to 11 digit number such as `123456789` got the same span as before but a different entity: `US_BANK_NUMBER`, `US_PASSPORT`, `US_SSN` and `PHONE_NUMBER` swap between runs. In each case the old and the new entity have the same score, 0.05 or 0.4, and which one wins the tie is not fixed from one run to the next. Recall did not move, and Presidio on the corpus was the same to the span.

## Versions

- LLM Guard: `llm-guard` 0.3.16. Its GitHub repository was archived in July 2026. It pulls in `presidio-analyzer` and `presidio-anonymizer` 2.2.358, `transformers` 4.51.3, `torch` 2.14.1 and spaCy 3.8.16 with `en_core_web_sm` 3.8.0. Anonymize also loads `zh_core_web_sm` 3.8.0 at start, because its analyzer supports `en` and `zh`.
- LLM Guard's recognizer: `Isotonic/deberta-v3-base_finetuned_ai4privacy_v2` at revision `9ea9927`, about 700 MB, which llm-guard pins and fetches from Hugging Face on first use. This is the default in 0.3.16's code (`DEBERTA_AI4PRIVACY_v2_CONF`). LLM Guard's docs still name `dslim/bert-base-NER` as the "top pick", and older releases used it by default. That model was not measured.
- LLM Guard's threshold: 0.5, the code default. The docs say the default is 0.
- Presidio for the Gretel run: 2.2.364 with `en_core_web_lg` and `es_core_news_lg`, the same venv as RESULTS.md.
- GLiNER: `gliner_multi-v2.1` fp32 ONNX at threshold 0.3, as in RESULTS.md, and at 0.5 for one extra column on Gretel. Both ran uncached. It runs through `@centrst/blind-ner`, a prototype built from this repository, not on npm, so every GLiNER number in this file comes from that prototype.
- Gretel: `gretelai/synthetic_pii_finance_multilingual`, Apache 2.0, test split, revision `7b844d1`, file SHA-256 `014e1057...3c8c72`. `gretel_sample.py` refuses any other file. pyarrow 26.0.0 reads it.
- Python 3.12.15, Node v26.11.1, macOS 27.0.1 on arm64. LLM Guard picks its own torch device and chose Apple's MPS GPU. Presidio, GLiNER and blind ran on the CPU.
- Every Python package is pinned in `scripts/bench/requirements-llmguard.txt` and `scripts/bench/requirements-gretel.txt`, both `pip freeze` output.

## How to reproduce

```
pnpm bench:presidio:setup   # once, see RESULTS.md
pnpm bench:llmguard:setup   # once: venv in .local/llmguard-venv, about 1.1 GB, plus 700 MB of weights on first run
pnpm bench:gretel:setup     # once: venv in .local/data-venv and the pinned Gretel parquet, 5.4 MB
pnpm ner:download           # once, for the + GLiNER columns
pnpm bench:presidio         # Presidio and blind on the corpus
pnpm bench:llmguard         # LLM Guard on the corpus, then the same scoring with its columns added
pnpm bench:gretel           # sample, Presidio, LLM Guard, score
```

`score.ts` skips the LLM Guard columns when `reports/llmguard-raw.json` is missing, and the Presidio columns when `reports/presidio-raw.json` is missing. `score-gretel.ts` does the same with its two raw files.

## How LLM Guard was run

`scripts/bench/llm_guard.py` uses only the public API: `Anonymize(vault, ...)`, `scan(text)`, then `Deanonymize(vault).scan(text, sanitized)`. Each file gets a fresh vault, the way one conversation would. Anonymize returns no offsets, so the script recovers them. It walks the sanitized text, checks that the text between placeholders equals the input at the same place, and reads each placeholder's length from its vault value. A file where that walk fails would be listed as changed outside the placeholders and aligned with difflib instead. That happened in 0 of 379 corpus files and 0 of 888 Gretel files, in every configuration. Anonymize analyses a copy of the text with single quotes turned into spaces and then replaces spans in the original, so nothing outside a placeholder changes. Run it with `python -I`, so the script's own name does not shadow the `llm_guard` package.

Four configurations ran on the corpus:

- `default` is `Anonymize(vault)` as shipped. Its entity list has PERSON, EMAIL_ADDRESS, PHONE_NUMBER, IBAN_CODE, CREDIT_CARD, CRYPTO, IP_ADDRESS, US_SSN, US_BANK_NUMBER and four regex patterns. It leaves out ORGANIZATION, LOCATION, DATE_TIME and URL.
- `default_tld` is the same with `.example` rewritten to `-exa.com`, as Presidio's `default_tld`.
- `all` passes every entity type the scanner's analyzer supports for `en`, 41 of them. That is the broadest list the docs point to: LLM Guard's defaults, Presidio's supported entities and LLM Guard's regex patterns. It adds ORGANIZATION, LOCATION, DATE_TIME, URL, URL_RE, DATE_RE, TIME_RE, PRICE_RE, PO_BOX_RE and a set of national id formats. The list is in `reports/llmguard-raw.json` under `meta.entityTypes`.
- `all_tld` is `all` with the `.example` rewrite.

Did LLM Guard need the rewrite? I tested it rather than assume. Its email detection does not reject `.example`: email recall is 100% with and without it, because its own EMAIL_ADDRESS_RE pattern accepts any TLD even where Presidio's recognizer refuses. Its URL detection half rejects it. URL_RE stops at the first known TLD, so `www.gestoria.example` loses only `www.ge`. Strict recall counts that URL as gone, 100% either way. The full-coverage check below shows the leak: 48.3% of URLs fully replaced in `all` against 100.0% in `all_tld`. The rewrite also changes how the DeBERTa model reads the name next to an address, and person recall rises from 69.1% to 74.5%. So I treat `all_tld` as LLM Guard's fair column, the same choice RESULTS.md made for Presidio. It is also LLM Guard's best result.

Every file runs with `language="en"`. Anonymize supports only `en` and `zh`, so the Spanish and mixed files go through the English setup.

LLM Guard's entity names map onto blind's kinds through `ENTITY_TO_KIND` in `scripts/bench/lib.ts`. Presidio's names map as in RESULTS.md. EMAIL_ADDRESS_RE is email, URL_RE is url, PHONE_NUMBER_WITH_EXT is phone, DATE_RE is date, PRICE_RE is amount and PO_BOX_RE is place. CREDIT_CARD_RE, US_SSN_RE, UUID, BTC_ADDRESS and the AU, IN, SG and UK_NINO numbers are id. TIME_RE and HEX_COLOR have no blind kind and count only in "any kind", like Presidio's NRP. That treats clock times differently from Presidio, whose DATE_TIME covers times and counts as date. I kept each tool's own entity name as the deciding fact.

## Part 1: LLM Guard on blind's corpus

The 379 files and the scorer are the ones in RESULTS.md. The Presidio `default` and `default_tld` columns are left out here, and so is `blind bare + GLiNER 0.5`. They are in RESULTS.md.

### Strict recall, all 379 files

| kind | annotated | Presidio with_org_tld | LLM Guard default | LLM Guard default_tld | LLM Guard all | LLM Guard all_tld | blind bare | blind known | blind bare + GLiNER | blind known + GLiNER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| person | 1422 | 70.3% | 67.7% | 73.2% | 69.1% | 74.5% | 67.3% | 98.7% | 98.7% | 99.9% |
| org | 656 | 62.6% | 9.0% | 9.4% | 31.4% | 31.9% | 29.9% | 51.8% | 97.7% | 99.7% |
| place | 174 | 89.7% | 0.6% | 1.1% | 99.4% | 99.4% | 0.0% | 0.6% | 99.4% | 99.4% |
| email | 1101 | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| url | 265 | 100.0% | 31.7% | 31.7% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| phone | 406 | 64.0% | 89.9% | 89.9% | 91.1% | 91.1% | 100.0% | 100.0% | 100.0% | 100.0% |
| iban | 106 | 91.5% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| id | 363 | 33.9% | 0.3% | 0.3% | 15.7% | 16.3% | 100.0% | 100.0% | 100.0% | 100.0% |
| amount | 737 | 7.7% | 0.0% | 0.0% | 13.0% | 13.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| date | 907 | 58.2% | 0.0% | 0.0% | 100.0% | 100.0% | 99.9% | 99.9% | 99.9% | 99.9% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

### Precision, all files

Correct spans over replaced spans. n/a means the tool replaced nothing of that kind.

| kind | Presidio with_org_tld | LLM Guard default | LLM Guard default_tld | LLM Guard all | LLM Guard all_tld | blind bare | blind known | blind bare + GLiNER | blind known + GLiNER |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| person | 78.8% (1126/1428) | 92.4% (1966/2127) | 92.5% (1937/2093) | 92.4% (1966/2127) | 92.5% (1937/2093) | 95.5% (1262/1321) | 96.9% (1660/1713) | 96.6% (1403/1452) | 96.6% (1421/1471) |
| org | 43.8% (340/777) | n/a (0/0) | n/a (0/0) | 100.0% (260/260) | 100.0% (260/260) | 97.8% (181/185) | 98.8% (331/335) | 92.7% (634/684) | 93.0% (648/697) |
| place | 23.3% (108/464) | n/a (0/0) | n/a (0/0) | 58.6% (310/529) | 58.3% (307/527) | n/a (0/0) | 100.0% (1/1) | 88.6% (156/176) | 89.1% (156/175) |
| email | 96.5% (1086/1125) | 62.2% (1230/1977) | 60.8% (1101/1811) | 62.4% (1230/1972) | 65.6% (1101/1679) | 96.6% (1101/1140) | 96.6% (1101/1140) | 96.6% (1101/1140) | 96.6% (1101/1140) |
| url | 100.0% (223/223) | n/a (0/0) | n/a (0/0) | 100.0% (267/267) | 100.0% (250/250) | 100.0% (265/265) | 100.0% (265/265) | 100.0% (265/265) | 100.0% (265/265) |
| phone | 94.3% (232/246) | 98.4% (658/669) | 98.7% (656/665) | 96.8% (655/677) | 98.6% (654/663) | 100.0% (406/406) | 100.0% (406/406) | 100.0% (406/406) | 100.0% (406/406) |
| iban | 100.0% (88/88) | 100.0% (95/95) | 100.0% (95/95) | 100.0% (95/95) | 100.0% (95/95) | 100.0% (106/106) | 100.0% (106/106) | 100.0% (106/106) | 100.0% (106/106) |
| id | 79.1% (53/67) | 11.1% (1/9) | 12.5% (1/8) | 33.3% (7/21) | 35.0% (7/20) | 100.0% (363/363) | 100.0% (363/363) | 100.0% (363/363) | 100.0% (363/363) |
| amount | n/a (0/0) | n/a (0/0) | n/a (0/0) | 100.0% (96/96) | 100.0% (96/96) | 99.9% (737/738) | 99.9% (737/738) | 99.9% (737/738) | 99.9% (737/738) |
| date | 73.6% (493/670) | n/a (0/0) | n/a (0/0) | 79.9% (917/1148) | 78.4% (917/1169) | 100.0% (907/907) | 100.0% (907/907) | 100.0% (907/907) | 100.0% (907/907) |
| any kind | 83.2% (4240/5095) | 96.3% (4697/4877) | 96.4% (4502/4672) | 92.9% (6717/7232) | 92.3% (6366/6900) | 98.4% (5346/5431) | 98.6% (5889/5974) | 97.9% (6105/6237) | 97.9% (6136/6268) |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

### Fully covered, a diagnostic

Strict recall counts a value as gone once it no longer shows as a whole word. A tool that replaces `Flor` inside `Florencia` gets credit, although `encia` is still there. This table counts an annotation only when every letter (person, org, place), digit (amount) or letter and digit (the rest) sits inside a replaced span. It is the `coverage` rule from `test/support/corpus.ts`. Known mode is left out.

| kind | Presidio with_org_tld | LLM Guard default | LLM Guard all | LLM Guard all_tld | blind bare | blind bare + GLiNER |
| --- | --- | --- | --- | --- | --- | --- |
| person | 84.2% | 79.4% | 80.5% | 84.6% | 66.6% | 98.6% |
| org | 65.2% | 0.6% | 15.7% | 16.3% | 28.1% | 97.6% |
| place | 89.7% | 1.1% | 98.8% | 98.3% | 0.0% | 99.4% |
| email | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% |
| url | 100.0% | 7.5% | 48.3% | 100.0% | 100.0% | 100.0% |
| phone | 58.1% | 90.9% | 91.6% | 91.9% | 99.8% | 99.8% |
| iban | 87.7% | 88.7% | 88.7% | 88.7% | 100.0% | 100.0% |
| id | 35.8% | 0.3% | 4.7% | 5.2% | 100.0% | 100.0% |
| amount | 5.7% | 0.0% | 13.0% | 13.0% | 100.0% | 100.0% |
| date | 51.8% | 0.0% | 100.0% | 100.0% | 100.0% | 100.0% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Person coverage can be higher than person recall. Coverage is per occurrence, while recall needs every token of the name gone from the whole file.

### Amounts, dates and round trip

| tool | amounts hidden | amounts usable | amounts hidden and usable | dates hidden | dates usable | dates hidden and usable | round trip |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Presidio with_org_tld | 7.7% | 92.3% | 0.0% | 58.2% | 41.8% | 0.0% | not possible |
| LLM Guard default | 0.0% | 100.0% | 0.0% | 0.0% | 100.0% | 0.0% | 379/379 |
| LLM Guard default_tld | 0.0% | 100.0% | 0.0% | 0.0% | 100.0% | 0.0% | 379/379 |
| LLM Guard all | 13.0% | 87.0% | 0.0% | 100.0% | 0.0% | 0.0% | 379/379 |
| LLM Guard all_tld | 13.0% | 87.0% | 0.0% | 100.0% | 0.0% | 0.0% | 379/379 |
| blind bare | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind known | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind bare + GLiNER | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |
| blind known + GLiNER | 100.0% | 100.0% | 100.0% | 99.9% | 100.0% | 99.9% | 379/379 |

The `+ GLiNER` rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

The round trip column is no longer "not possible" for LLM Guard, because it keeps a vault. `Deanonymize(vault).scan(text, sanitized)` gave back the scanned text exactly in all 379 files, in every configuration. In the `_tld` configurations that is the rewritten text, since that is what LLM Guard saw. No placeholder stood for two different values in any file. LLM Guard numbers each distinct string, so `[REDACTED_PERSON_1]` and `[REDACTED_PERSON_2]` stay apart, which Presidio's `replace` operator cannot do. What a model reads is still `[REDACTED_DATE_TIME_1]`, so a hidden amount or date has no value left to compute with. That is why "hidden and usable" is 0.0% for LLM Guard, as for Presidio. In `all`, LLM Guard also wrote 31 placeholders that stand for an empty string. They round trip, but they add noise to the text.

### Where LLM Guard wins on the corpus

On places and dates, against blind's core. LLM Guard `all_tld` removes 99.4% of places and 100.0% of dates. blind's core removes 0.0% of places, and ties on dates at 99.9%. With GLiNER, blind matches it on places at 99.4%, with 88.6% precision against LLM Guard's 58.3%.

On persons in bare mode, by a few points. LLM Guard `all_tld` removes 74.5% of person values against 67.3% for blind bare, at 92.5% precision against 95.5%. The gap is widest in Spanish, where LLM Guard removes 77.4% and blind bare 61.7%, although LLM Guard ran its English setup on that text. Presidio `with_org_tld` reaches 48.1% there. With the owner's names passed as `known`, or with GLiNER, blind removes 98.7%.

On org precision. Where LLM Guard tags an org, it is right: 260 of 260. It only finds 31.9% of them.

### Where blind wins on the corpus

On structured values. blind removes 100% of phones, ids and amounts. LLM Guard `all_tld` removes 91.1% of phones, 16.3% of ids and 13.0% of amounts, and in `default` it removes 1 id of 363 and no amount or date. Its id precision is 35.0%, mostly card and Australian number patterns firing on IBANs and phones.

On orgs. blind's core removes 29.9% in bare mode and 51.8% in known mode, against 31.9% for LLM Guard. With GLiNER blind removes 97.7%.

On precision overall: 98.4% any-kind for blind bare against 92.3% for LLM Guard `all_tld`. LLM Guard's DeBERTa model splits its spans along sub-word pieces, and many of the pieces get the wrong type. Most of its 578 email false positives in `all_tld` are fragments of the sender name before an address, such as `Flor` or `Rosen` typed as EMAIL_ADDRESS, and 63 are a lone `<`. Those fragments are why its email precision is 65.6% while its email recall is 100%.

On amounts and dates for a model. Only blind hides them and keeps them usable.

## Part 2: a neutral dataset, Gretel synthetic finance

### The sample

`scripts/bench/gretel_sample.py` takes every Spanish row of the test split, 444 of them, and the same number of English rows drawn with `random.Random(20261024).sample` over the 2962 English rows in file order. Names are `gretel/<lang>-<row>`. Gretel's spans are used as written, with 14 empty or out-of-range spans dropped and no duplicates found. Overlapping spans are kept.

Gretel's labels map onto blind's kinds as follows, in `LABEL_TO_KIND` in `score-gretel.ts`:

- name, first_name and last_name are person. company is org. street_address is place. email is email. phone_number is phone.
- iban is iban. bban is id, not iban. A BBAN is a domestic account number with no country code or IBAN check digits, so no tool's IBAN recognizer is meant to find it, and every tool that finds one types it as an account or id number. There are 30 bban labels in the sample.
- credit_card_number, ssn, passport_number, driver_license_number, customer_id, employee_id, bank_routing_number, swift_bic_code, ipv4 and ipv6 are id.
- date, date_of_birth and date_time are date.
- time, password, api_key, account_pin, credit_card_security_code, user_name and local_latlng have no blind kind. They are scored apart below, recall only.

Gretel labels no amounts and no URLs, so there is no amounts and dates usability table for this dataset. Those kinds are also left out of the recall table. A replaced amount or URL counts against "any kind" precision, which is why there is a second row that leaves them out.

Tools: Presidio `default` and `with_org` (orgs on, text as written), LLM Guard `default` and `all`, blind bare, and blind bare with GLiNER at 0.3 and at 0.5. `with_org` is the `with_org_tld` equivalent. Gretel does not use `.example` as a corpus convention, and the rewrite would only break real-looking hosts such as `www.example.com`, which appears 24 times. For the same reason LLM Guard runs `all`, not `all_tld`. blind's `known` mode does not apply, since Gretel's documents come with no owner list. blind runs with its default date order, `dmy`, on every file. It still reads `03/15/2023` as month first because 15 cannot be a month.

### Strict recall, 888 files

| kind | annotated | Presidio default | Presidio with_org | LLM Guard default | LLM Guard all | blind bare | blind bare + GLiNER | blind bare + GLiNER 0.5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| person | 1762 | 51.5% | 54.5% | 38.3% | 40.9% | 3.6% | 79.5% | 78.3% |
| org | 869 | 9.9% | 54.3% | 6.0% | 24.4% | 0.5% | 98.7% | 98.3% |
| place | 722 | 78.3% | 83.8% | 8.4% | 91.0% | 2.1% | 98.6% | 94.9% |
| email | 229 | 96.1% | 96.9% | 95.6% | 96.1% | 95.2% | 96.5% | 95.6% |
| phone | 148 | 80.4% | 81.1% | 93.9% | 97.3% | 88.5% | 88.5% | 88.5% |
| iban | 31 | 93.5% | 93.5% | 93.5% | 93.5% | 100.0% | 100.0% | 100.0% |
| id | 272 | 45.2% | 48.9% | 42.3% | 68.0% | 82.3% | 83.8% | 83.8% |
| date | 1476 | 72.4% | 72.4% | 10.4% | 53.7% | 49.5% | 49.9% | 49.7% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

By language, person recall is 70.1% for Presidio `with_org`, 48.2% for LLM Guard `all`, 4.5% for blind bare and 94.1% for blind with GLiNER on the 444 English files, and 92.7% at 0.5. On the 444 Spanish files it is 42.9%, 35.5%, 3.0% and 68.6%, and 67.6% at 0.5. The other per-language tables are in `reports/gretel-bench.json`.

### Precision, 888 files

| kind | Presidio default | Presidio with_org | LLM Guard default | LLM Guard all | blind bare | blind bare + GLiNER | blind bare + GLiNER 0.5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| person | 54.3% (981/1807) | 54.3% (981/1807) | 82.3% (1413/1717) | 82.3% (1413/1717) | 76.3% (87/114) | 40.1% (1341/3343) | 44.9% (1333/2969) |
| org | n/a (0/0) | 17.6% (512/2902) | n/a (0/0) | 88.3% (173/196) | n/a (0/0) | 29.4% (853/2904) | 34.5% (844/2448) |
| place | 31.3% (620/1980) | 31.3% (620/1980) | n/a (0/0) | 58.4% (1811/3101) | n/a (0/0) | 47.3% (1265/2672) | 51.9% (1193/2300) |
| email | 97.2% (209/215) | 97.1% (203/209) | 89.0% (178/200) | 89.8% (176/196) | 97.3% (217/223) | 97.3% (217/223) | 97.3% (217/223) |
| phone | 25.1% (116/462) | 25.4% (116/456) | 76.0% (225/296) | 77.2% (227/294) | 57.2% (127/222) | 57.2% (127/222) | 57.2% (127/222) |
| iban | 100.0% (21/21) | 100.0% (20/20) | 7.5% (22/294) | 7.9% (22/278) | 56.4% (22/39) | 56.4% (22/39) | 56.4% (22/39) |
| id | 14.1% (101/717) | 14.3% (100/699) | 5.3% (99/1856) | 6.8% (123/1795) | 11.2% (217/1943) | 11.2% (217/1943) | 11.2% (217/1943) |
| date | 70.2% (1098/1564) | 70.5% (1095/1553) | n/a (0/0) | 68.9% (701/1018) | 75.9% (745/982) | 75.9% (745/982) | 75.9% (745/982) |
| any kind | 53.4% (3788/7096) | 45.1% (4486/9953) | 57.4% (2503/4363) | 55.2% (5559/10065) | 28.6% (1558/5440) | 35.7% (5090/14245) | 38.2% (4984/13043) |
| any labelled kind | 55.7% (3767/6766) | 46.4% (4466/9626) | 57.4% (2503/4363) | 63.6% (5467/8595) | 43.9% (1548/3523) | 41.2% (5080/12328) | 44.7% (4974/11126) |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

"Any labelled kind" leaves out replaced spans of kinds Gretel never labels: amounts, URLs, blind's domains and entities with no blind kind. Gretel's labels are incomplete, so every precision number here is a floor. The id row is the clearest case. All four tools find account numbers, reference numbers and invoice numbers that Gretel leaves unlabelled, and score 5% to 14% for it.

### Date labels split, a diagnostic

Gretel's date label covers durations, frequencies, bare years and phrases as well as calendar dates. In the sample the most common date labels blind leaves in place are `annual`, `2021`, `monthly`, `today` and `30 years`. This split counts a date label as "calendar" when it has a day and a month, or a month and a year, written as digits or with a month name, by the regex in `score-gretel.ts`. The headline row above keeps every label.

| date labels | annotated | Presidio default | Presidio with_org | LLM Guard default | LLM Guard all | blind bare | blind bare + GLiNER | blind bare + GLiNER 0.5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calendar | 736 | 84.9% | 84.9% | 18.5% | 97.7% | 97.0% | 97.0% | 97.0% |
| other | 740 | 59.9% | 60.0% | 2.4% | 9.9% | 2.3% | 3.0% | 2.7% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

### Fully covered, a diagnostic

| kind | Presidio default | Presidio with_org | LLM Guard default | LLM Guard all | blind bare | blind bare + GLiNER | blind bare + GLiNER 0.5 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| person | 58.3% | 61.7% | 46.0% | 47.6% | 3.3% | 80.6% | 79.7% |
| org | 9.1% | 57.0% | 3.8% | 17.3% | 0.8% | 97.8% | 96.8% |
| place | 38.9% | 46.1% | 1.7% | 48.5% | 0.4% | 92.0% | 82.7% |
| email | 93.9% | 93.9% | 95.6% | 95.6% | 94.8% | 94.8% | 94.8% |
| phone | 74.3% | 74.3% | 92.6% | 96.0% | 76.3% | 76.3% | 76.3% |
| iban | 71.0% | 71.0% | 87.1% | 87.1% | 90.3% | 90.3% | 90.3% |
| id | 38.6% | 42.6% | 39.3% | 49.3% | 81.6% | 83.1% | 83.1% |
| date | 66.9% | 67.2% | 11.4% | 47.9% | 44.2% | 44.5% | 44.4% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Street addresses are where strict recall flatters most. Removing one word of `100 Jimenez Lakes, Apt. 270` makes the whole string count as gone. Presidio `with_org` removes 83.8% of addresses by that rule, but replaces every character of only 46.1%. LLM Guard `all` drops from 91.0% to 48.5%. blind with GLiNER drops from 98.6% to 92.0%.

### Labels with no blind kind, strict recall

| label | annotated | Presidio default | Presidio with_org | LLM Guard default | LLM Guard all | blind bare | blind bare + GLiNER | blind bare + GLiNER 0.5 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| time | 285 | 15.8% | 16.8% | 18.9% | 63.5% | 2.5% | 2.5% | 2.5% |
| password | 13 | 30.8% | 30.8% | 0.0% | 0.0% | 0.0% | 15.4% | 0.0% |
| api_key | 11 | 18.2% | 18.2% | 63.6% | 72.7% | 54.5% | 54.5% | 54.5% |
| account_pin | 22 | 40.9% | 40.9% | 9.1% | 31.8% | 63.6% | 63.6% | 63.6% |
| credit_card_security_code | 31 | 9.7% | 9.7% | 9.7% | 16.1% | 6.5% | 6.5% | 6.5% |
| user_name | 10 | 20.0% | 20.0% | 30.0% | 50.0% | 20.0% | 90.0% | 90.0% |
| local_latlng | 16 | 68.8% | 68.8% | 12.5% | 62.5% | 100.0% | 100.0% | 100.0% |

The `+ GLiNER` columns come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Apart from `time`, these counts are small. None of the tools is built to find passwords or card security codes, and none does. blind leaves clock times alone on purpose. LLM Guard's TIME_RE pattern finds most of them.

### Round trip on Gretel

| tool | round trip |
| --- | --- |
| Presidio | not possible |
| LLM Guard default | 888/888 |
| LLM Guard all | 888/888 |
| blind bare | 888/888 |
| blind bare + GLiNER | 888/888 |
| blind bare + GLiNER 0.5 | 888/888 |

The `+ GLiNER` rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

`unblind(blind(x))` gives back `x` in every Gretel file, bare and with GLiNER at either threshold. C1 says the round trip holds for any input the detectors handle, and C15 says all corpus files round trip with GLiNER. Both now hold on text blind's authors did not write as well as on the corpus. The benchmark runs blind in its default `fake` mode. PR #13 reports 888/888 in `placeholder` and `random` mode too, and this run did not measure those. LLM Guard's round trip held in all 888 files, as before. Its placeholders cannot collide with real text, which makes exact restoring easier than for blind's realistic fakes.

**Before the round-trip fix.** At `2febde1`, blind bare round tripped 879/888 and blind with GLiNER 798/888, so 9 and 90 files failed. 69 of the 90 GLiNER failures and 2 of the 9 bare ones differed from the input only in letter case, for example `La Empresa` coming back lower case. In 5 bare files a phone with an extension, such as `(712)424-2016x493`, kept its fake in the restored text. Most of the rest were amounts that scaled onto the same fake, such as `$9,999` and `$10,000` both becoming `$15,328`, or fakes beside digits that `unblind` skipped, such as `hugo` in `hugo420` where the input had `bresciani420`. The causes and the fixes are in PR #13, and the cases are in `corpus/adversarial/roundtrip.json`.

### Where each tool wins on Gretel

blind bare loses badly on persons and orgs. It removes 3.6% of person values and 0.5% of orgs. Its core finds names from headers, titles, sender lines and the known list, and finance documents in CSV, EDI, FIX, XBRL and MT940 rarely have those anchors. TESTING.md and RESULTS.md predicted this in general terms. The number is worse than "lower than 67.3%". Without GLiNER, blind's core should not be described as a name detector for documents like these.

blind with GLiNER removes the most persons, orgs and places of any tool: 79.5%, 98.7% and 98.6%. It pays in precision. 40.1% of its person spans and 29.4% of its org spans land on a Gretel label of that kind. Many of the rest are role words such as `Borrower`, `Customer`, `Lender`, `Company` and `Empresa`, which a privacy tool can defend replacing but which make the copy harder to read. Others are real places Gretel does not label, such as `España`, `Madrid` and `London`, since Gretel labels only street addresses. LLM Guard's person precision is the best at 82.3%, at half the recall. These GLiNER numbers come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

Presidio `with_org` is the best untuned person detector on the English files, at 70.1%, and the best date detector over all labels, at 72.4%. Its date lead comes from the non-calendar labels: `monthly`, `30 years`, `the past year`. On calendar dates LLM Guard `all` removes 97.7%, blind 97.0% and Presidio 84.9%.

On structured values the picture is mixed, not a blind sweep as on the corpus:

- ids: blind removes 82.3%, LLM Guard `all` 68.0%, Presidio 48.9%. blind misses most SWIFT/BIC codes, and card numbers that fail the Luhn check. 13 of the 24 card labels in the sample fail it. blind's card recognizer requires a valid check digit, as a real card always has, so this part of the gap is a dataset artifact like the invalid NIFs in RESULTS.md.
- phones: LLM Guard `all` wins at 97.3%, then blind at 88.5% and Presidio at 81.1%. blind misses Mexican and Swedish layouts such as `(55) 1234-5678` and `08-41 19 42`.
- IBANs: blind removes all 31, the others 29.
- email: all tools sit between 95% and 97%. Most misses are template text such as `[Correo Electrónico del Freelance]`.

### Time per file

| tool | corpus, ms per file | Gretel, ms per file |
| --- | --- | --- |
| Presidio, one spaCy large pipeline per file | about 20 | 30 |
| LLM Guard, on the MPS GPU it picks itself | 44 | 76 to 79 |
| LLM Guard, forced to CPU, from the run at `2febde1` | 75 | 117 |
| blind core | 0.3 | 0.3 |
| GLiNER at 0.3, on the CPU | 49 | 107 |
| GLiNER at 0.5, on the CPU | 50 | 107 |

The GLiNER rows come from `@centrst/blind-ner`, a prototype built from this repository, not on npm.

The CPU row was not rerun. It is a separate, timed run of `llm_guard.py --device cpu` on `all_tld` and `all` from the previous write-up. It gave a different sanitized text in 2 of 379 corpus files and 6 of 888 Gretel files, from floating-point differences between the two devices. GLiNER's time is model time per file in an uncached run. blind with GLiNER costs the GLiNER time plus the core. blind's core took 0.3 ms per corpus file, against 0.2 ms before the fix. At this resolution that may be noise, and I did not measure it more closely. Gretel's documents average 1,310 characters against 611 for the corpus, which is why every model is slower there.

## Caveats

- Gretel's text is LLM-generated and synthetic. Its names, companies and addresses come from Faker-like generators, often in mixed nationalities, for example `Agnes Anna Eriksson` in a Spanish document. Neither tool was tuned on it. It is not real mail and not real finance documents, and it is not blind's home ground. Read it as a second test, not as a neutral truth.
- Gretel's labels are noisy, and unevenly so. I read 40 seeded person labels from each language. 4 of 40 English ones are not names (`123456`, `RENEWAL REMINDER`, `[Party A Name]`, `john\_doe123`). 18 of 40 Spanish ones are not names, for example `Hola`, `Claro`, `Destinatario`, `Número de Póliza`, `45 avenue Reynaud` and `[Nombre del Trabajador]`. Of 50 seeded date labels, 22 are calendar dates, 3 are bare years and 25 are durations, frequencies or phrases. A tool that leaves `Hola` alone is right and still scores a miss, so the Spanish person row understates every tool, and most of all the ones with high precision. Of 50 org labels, about 6 are generic words or an address.
- Gretel's labels are also incomplete. Cities, countries, account and reference numbers and most URLs carry no label, so precision here is a floor for every tool.
- The `.example` rewrite is my choice for the corpus columns, as in RESULTS.md. It helps LLM Guard on URLs and, through the model, on persons. The `default` and `all` columns show LLM Guard on the corpus as written.
- LLM Guard ran its English setup on Spanish text, because that is all it supports besides Chinese. On the corpus this still gave it the best Spanish person recall in bare mode. On Gretel's Spanish files it is behind Presidio's Spanish pipeline on persons and orgs.
- LLM Guard on MPS is not exactly repeatable. Over three runs of `all` on the corpus, id precision was 7/20, 7/23 and 7/21, and this run is the third. Recall did not change. The Gretel numbers were the same in every run.
- Only one LLM Guard recognizer was measured, the code default. The docs' "top pick", `dslim/bert-base-NER`, and the other bundled models were not run. LLM Guard's model also emits labels such as AMOUNT that pass through when listed in `entity_types`. They are not in its documented entity list and were not measured, so LLM Guard's amount recall here comes from PRICE_RE alone.
- The strict recall rule, unchanged from the corpus, counts a value as gone when any part of it is replaced. That favours tools whose spans are fragments, which is LLM Guard's DeBERTa model most of all, and long values like addresses. The fully covered tables show how much.
- GLiNER's threshold was tuned on blind's corpus, and its name propagation was built against that corpus. On Gretel it had no home advantage beyond that, and its precision dropped to 29% to 47% on org, person and place. At 0.5 it is 34% to 52%.
- The `dmy` date order is blind's default. A user with US documents would set `mdy`. In this sample it does not change what is hidden, only how an ambiguous date like `01/02/2023` is shifted.
