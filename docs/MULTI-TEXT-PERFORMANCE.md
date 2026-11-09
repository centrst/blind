# Multi-text performance

Issue [#6](https://github.com/centrst/blind/issues/6) reported quadratic growth when `blind` received thousands of short fields. The fixture here uses invented inbox subjects and sender fields, alternating these forms with changing numbers and addresses.

```text
Invoice 7301 from Lenora Veldren
Tavia Norwick <tavia1@host1.example>
```

The options are `replaceWith: 'placeholder'`, seed `issue-6`, no known values, and a fixed date. Each size runs once to warm up, then reports the median wall time of three runs. Restoration asserts exact equality with every original field. Prepared timings include preparing the mapping once per batch.

## Cause and fix

A Node CPU profile of the 5,000-field baseline pointed to `scan`, `occurrences` and `wordEdges` in the leak check. For every output, the scanner visited every original and recomputed its script-specific boundaries before searching. Most values were absent. The text count multiplied the value count.

The scanner now builds one exact literal index per call and searches each output independently. It applies the existing word, capitalization and language rules to the matches, preserves overlapping matches, and sorts hits by the original rule order. A match cannot cross fields. The index operates on the same folded skeleton and maps offsets back to the original text as before.

`prepareUnblinder` owns a snapshot of the pairs and restoration settings. It builds fake, amount, date and invented-name lookups once. Each `unblind` method call restores one independent text with fresh result arrays. The existing single-use streaming API keeps its lifecycle.

## Measurements

Measured on Apple M4, Node v24.22.1, against baseline commit `5a74926`. Values are milliseconds. They describe this synthetic fixture and machine, not a latency guarantee. Wall times vary with machine load; the script prints the environment and measurement method with every run.

| Fields | Baseline separate | Fixed separate | Baseline joined | Fixed joined |
| ---: | ---: | ---: | ---: | ---: |
| 625 | 66 | 42 | 13 | 21 |
| 1,250 | 227 | 66 | 26 | 43 |
| 2,500 | 842 | 136 | 65 | 80 |
| 5,000 | 3,286 | 260 | 177 | 150 |

| Fields | Pairs | Baseline one-shot per field | Fixed one-shot per field | Prepared once per batch |
| ---: | ---: | ---: | ---: | ---: |
| 625 | 313 | 127 | 185 | 6 |
| 1,250 | 626 | 445 | 788 | 10 |
| 2,500 | 1,251 | 1,748 | 3,418 | 21 |
| 5,000 | 2,501 | 7,059 | 6,908 | 24 |

The joined input is a timing comparison only. It does not define correct multi-field behavior. One-shot restoration still prepares a mapping on every call. Callers restoring many fields must retain the object returned by `prepareUnblinder` to share that work.

## Reproduce

Run the current implementation from the repository root.

```sh
pnpm install --frozen-lockfile
pnpm bench:multi-text
```

To compare the same fixture against the baseline without changing checkouts, extract its sources under the ignored scratch directory and compile them with the installed compiler. The optional argument is a module path relative to the benchmark script.

```sh
mkdir -p .local/issue-6-before
git archive 5a74926 src package.json tsconfig.json tsconfig.build.json | tar -x -C .local/issue-6-before
pnpm exec tsc -p .local/issue-6-before/tsconfig.build.json
node scripts/bench/multi-text.mjs ../../.local/issue-6-before/dist/index.js
```

## Correctness and scope

`test/multi-text.test.ts` compares the index against `String.indexOf` over 2,000 seeded cases, including overlaps, suffix matches and UTF-16 offsets. It checks report ordering, field boundaries, cross-field name propagation, exact restoration in all replacement modes, independent results, mapping snapshots, per-text limits and sanitized preparation errors. A deterministic spy assertion rejects per-original boundary work on 2,000 texts with 1,000 absent originals. No new wall-clock assertion runs in the test suite.

A separate differential run compared 2,286 complete `blind` results against the baseline across every generated and handwritten corpus file, all three replacement modes, and both whole-text and line-split inputs. Texts, mappings, leaks, counts and collisions matched exactly. Every prepared restore also matched baseline one-shot restoration.

The literal search takes work proportional to the scanned text and the literal matches it finds, after building the index. This does not make every part of `blind` linear for arbitrary inputs. Flexible phone and ID matching, deny entries and detection still have their existing costs. Large overlapping literal sets can produce many candidate matches. No NER behavior or unrelated email detection changes are included.
