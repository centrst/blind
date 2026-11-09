# Paranoid mode on a dataset blind was not tuned on

Run on 2026-11-09 with `src` at commit `0f124d2`, the merge of PR #20 that added paranoid mode. The source of every number below is the output of `pnpm bench:paranoid`, printed in full at the end.

## What was run

`pnpm bench:paranoid` runs `blind` with `paranoid: true` and nothing passed in `known`, seeded by each file's name, on every document of the Gretel sample. It counts three things, and prints no value:

- **Survivors.** These are labelled values, dates, times and amounts aside, that still appear in the blind text under the corpus scorer's whole-word rule. The run also counts how many of them a suspect overlaps.
- **Held.** These are documents whose leak report fails, so `assertNoLeaks` throws and a reviewer has to look at them.
- **False alarms.** These are suspects that overlap no label. Gretel's labels are incomplete, so some of these are private values the labels missed.

## Results

| | Count | Share |
| --- | ---: | ---: |
| Documents held for review | 877 of 888 | 98.8% |
| Surviving labelled values that a suspect flags | 2,891 of 3,365 | 85.9% |
| Suspects that overlap no label | 13,133 | 14.8 per document |

Contracts and loan documents capitalise their defined terms, such as `Policy`, `Borrower` and `Agreement`. Paranoid mode reads each of them as a possible name, which is why it holds almost every document and raises about 15 unlabelled suspects in each. On this kind of text it works as a review queue, not as a filter that passes most documents through.

## Versions

- Gretel: `gretelai/synthetic_pii_finance_multilingual`, Apache 2.0, test split, revision `7b844d1`, file SHA-256 `014e1057...3c8c72`, 444 English and 444 Spanish documents. `gretel_sample.py` refuses any other file and dropped 14 empty or out-of-range spans.
- Python 3.12.16 with pyarrow 26.0.0, from `scripts/bench/requirements-gretel.txt`, to write the sample.
- Node v24.22.1 on macOS 27.2, arm64, to run blind.

## Reproduce

In a clone of the repository:

```sh
pnpm bench:gretel:setup
.local/data-venv/bin/python -I scripts/bench/gretel_sample.py
pnpm bench:paranoid
```

The second command is the first step of `pnpm bench:gretel`. It writes `reports/gretel-input.json`, and the Presidio comparison is not needed for this run. Each file is seeded by its name, so the counts are the same on every run of the same source.

## Output

```
files 888, held 877 (98.8%)
survivors 3365, flagged 2891 (85.9%)
false alarms 13133, 14.8 per file
```
