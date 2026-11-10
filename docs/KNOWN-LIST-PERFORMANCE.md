# Known-list performance

The README tells callers to list every person, company and place they know is private in `known`. An app backed by a contact list passes thousands of entries on every call, and most of them are not in the text.

## Cause

Each known entry compiled its own regular expression on every call, then ran it over the text. On a 36-character text the cost was about 0.5 ms per entry on the first call, almost all of it in `alternativesMatcher` compiling the pattern. The engine caches compiled patterns by source, so a second call with the same list was faster, but any new entry or a cache eviction paid again. On a long text every entry also scanned the whole text.

A second cost grew with the known list times the text: to choose the language of a known person's fake, `blind` walked every person span of every text for each known person.

## Fix

- `knownDetector` gives each entry one or more keys: strings that every match of the entry must contain. For a name, company or place, matched on the skeleton of the text, that is the longest run of each form without whitespace. For an email, domain or id, matched in any letter case, it is the longest ASCII run in lower case, looked up in a copy of the text with ASCII letters lowered and the long s and Kelvin sign read as `s` and `k`, the only other code points such a pattern matches to an ASCII letter. For a phone it is its digits, looked up in the text with phone separators removed. One Aho-Corasick index (`src/literal-index.ts`) finds which keys a text holds. Only those entries compile their pattern, once per call, and run it. An entry without a usable key is tried on every text as before. The spans are pushed in the order of `known`, as before.
- The language of each known person's fake is read from a map of each name word to the first person span that writes it, built once per call.
- `foldLookalikes` and `skeleton` skip their per-character checks for ASCII, which they never change except to lower its case.
- `checkKnown` builds a value's forms for the Korean rule only when the value has a Hangul letter.
- The amount and date plan prepares its leak check only when there is an amount or date to check.

The output does not change for any input. `test/known-prefilter.test.ts` (C55) runs the prefiltered matcher against `everyKnownDetector`, which tries every entry on every text as before. It compares them on generated known lists and texts in many scripts and spellings, and on every corpus and adversarial text, as written and folded. It also checks every code point for the ASCII case rule.

## Measurements

Apple M4 Max, Node v26.13.0, against the base commit `567ca5b`. Known people are `Marta<i> Vandermeer<i>`. The short text is `Hello Marta42 Vandermeer42, see you.` and the long one is 200 KB of generated corpus text. Wall milliseconds: the first call in a fresh process, then the best of two more calls with the same list in parentheses. Times vary with machine load.

| Known people | Short, before | Short, after | 200 KB, before | 200 KB, after |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 16 (0) | 16 (0) | 517 (308) | 440 (237) |
| 1,000 | 1,031 (46) | 39 (12) | 5,803 (4,760) | 461 (258) |
| 4,000 | 4,060 (185) | 74 (41) | 21,655 (21,585) | 514 (301) |
| 10,000 | 9,968 (529) | 140 (105) | 52,503 (52,646) | 607 (399) |

## What is left

About 15 microseconds per entry the text does not contain, spread over work done once per entry and call: `checkKnown` (which `blind` runs on the caller's list and `knownDetector` runs again with the earlier turns' values), building each entry's forms and keys, the leak check preparing every known value, `knownParts`, and fakes drawn up front for every known person. The fakes have to be drawn for every known person, in order, because later draws depend on them, and skipping them would change the output. A form of the known list prepared once and reused across calls, as `prepareUnblinder` does for unblind, would remove most of the rest. At these numbers it is not needed.

## Reproduce

```sh
pnpm install --frozen-lockfile
pnpm bench:known-list
```

To measure the base commit with the same script:

```sh
mkdir -p .local/known-before
git archive 567ca5b src package.json tsconfig.json tsconfig.build.json | tar -x -C .local/known-before
pnpm exec tsc -p .local/known-before/tsconfig.build.json
node scripts/bench/known-list.mjs ../../.local/known-before/dist/index.js
```
