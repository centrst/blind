# blind

Open-source Centrst TypeScript library. Rewrites private text into a blind copy with consistent fakes and maps answers back.

## Commands

- `pnpm install`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm secrets` scans the working tree, index and history with Gitleaks 8.30.1
- `pnpm test` unit, properties (NUM_RUNS, default 2,000, SEED replays), corpus, adversarial, CLI, no-network, build checks
- `pnpm build`, then `pnpm build:ner` for the NER package (it imports the built core)
- `pnpm test:ner` the NER package: stub tests always, model tests when `ner/models/gliner_multi-v2.1` exists (`pnpm ner:download` fetches it once). `pnpm ner:eval` prints the scorecard with and without the detector
- `pnpm test:deep` properties at 20,000 cases
- `pnpm corpus` scorecard against `corpus/floors.json` (`corpus:generate` rebuilds the generated files)
- `pnpm mutation` Stryker against the floor in `stryker.config.json`
- `pnpm claims` writes `CLAIMS.md` from `reports/vitest.json` and `reports/vitest-ner.json` and fails on an unbacked claim. The NER claims show as skipped when their model tests did not run, and `--strict` fails on that too
- `pnpm evidence` writes `reports/evidence.html`
- `pnpm known-misses` regenerates `corpus/adversarial/known-misses.md`
- `pnpm verify` runs all of it in CI order with `claims --strict`, so it needs the model (`--fast` skips test:deep)

Typecheck, lint, test and build must pass before a change ships. `pnpm verify` before a release. Node 22 or newer, ESM, strict TypeScript. Run `tsx` and `stryker` through the pnpm scripts, scratch files go in `.local/`.

The gate is `.pre-merge.yml` (secret scanning, typecheck, lint, test, build). Public CI runs on Ubuntu with actions pinned to full commit SHAs. Never use macOS GitHub-hosted runners. The heavy suites (test:deep, mutation, the NER model tests) run locally through `pnpm verify` before a release. Publishing is a separate decision; this tree has no release workflow. All changes use feature branches and pull requests; a maintainer merges them.

## Rules

- Fixtures are synthetic. Invent every name, company, amount and number. Use `.example` domains. Never paste real mail, people, companies or amounts into tests, docs or commits.
- No network calls anywhere in `src`. The core must keep running without Node: no `node:` imports and no Node-only globals in `src` outside `src/cli` (checked in a bare realm, C19).
- No runtime dependencies without a clear reason. Dev dependencies stay few and on the same versions as the other Centrst TypeScript projects.
- No `Math.random`. Use the seeded `Rng` so output is reproducible from a seed.
- Leak reports and error messages carry a kind and an index, never the value.
- Detectors stay behind the `Detector` interface. NER plugs in there, not in the core.
- Prose has no em dashes.
- Every test that backs a claim starts with its ID (`C4/P4: ...`). A claim ID in the README or TESTING.md needs a passing test.
- Floors in `corpus/floors.json` and the mutation break score only go up. The recorded floor resets are documented in TESTING.md. A new miss goes into `corpus/adversarial` as a case with `expect: silent` and a reason, then `pnpm known-misses`.
- The CLI keeps real values off stdout and stderr on a leak: kinds and offsets only.

## Layout

- `src/detect.ts` built-in detectors, context words (titles, id labels), known-value matching, span resolution, `findSpans` (the one detection pass `blind` and the scorer share, including names found again bare)
- `src/script.ts` scripts without word spaces, Korean particles, Hebrew and Arabic glued prefixes, and the word-edge lookarounds. `src/match.ts` a value as atoms, the alternatives matcher that never throws, and the finder unblind uses for fakes
- `src/ids.ts` typed ids: cards, SSN, DNI, NIE, CIF, EU VAT, IPv4, IPv6, with validators and checksum-valid fakes
- `src/surrogates.ts` fake generators. `src/pairlog.ts` the real-to-fake pair log and the one rule unblind reads it by. `src/case.ts` letter-case habits and the other cases of a fake
- `src/names.ts` the fake lists, word lists, and the patterns more than one module matches (`ORG_SUFFIX`, `AT_SRC`)
- `src/language.ts` which language a fake is written in: the value's own words first, then its paragraph, the text and the call, English when nothing decides
- `src/replace.ts` the `replaceWith` modes beside `fake`: numbered placeholders and unrelated random values. The mode lives in the mapping. `src/mapping.ts` `checkMapping`, which checks each mode's own invariants, and `collisions`
- `src/amounts.ts`, `src/dates.ts` parsing, rendering, scaling plan, shifting
- `src/blind.ts`, `src/unblind.ts` the two entry points. `blind` takes a previous `mapping` to continue a conversation; `createUnblinder` is streaming unblind
- `src/receipt.ts` Ed25519 receipts for proxy mode (Web Crypto only), `src/version.ts` the version a receipt names
- `src/leaks.ts` leak check and `assertNoLeaks`. `src/errors.ts` `BlindError` and its kinds, `LeakError`, `InputTooLargeError`, the text limit and `guard`
- `src/fold.ts` same-length folds (look-alikes, full-width) and the accent-free skeleton used for known names
- `src/cli/` the `blind` and `unblind` commands. `blind.ts` and `unblind.ts` are the bins, `run-*.ts` hold the logic and take an injected `IO`, `store.ts` owns `$BLIND_HOME/runs`
- `ner/` workspace package `@centrst/blind-ner`: GLiNER on onnxruntime-node, plugs in through `detectors`. Its dependencies stay here, never in the core. `corpus/floors-ner.json` holds its floors
- `test/properties/` the property suite in six files of about equal running time, so Vitest spreads them over its workers; the properties themselves are functions in `test/support/properties.ts`
- `test/support/` value makers, email templates, fast-check arbitraries, corpus loader and scorer
- `corpus/generated` (script output, do not edit), `corpus/handwritten`, `corpus/adversarial` (cases and known misses), `corpus/floors.json`
- `scripts/` corpus generation and scoring, claims, evidence report, verify, `receipt-keys.ts`, `bench/` (the Presidio benchmark, Python venv in `.local/`)
- `examples/` Workers, Deno and Lambda adapters around one shared handler; `test/examples.test.ts` runs them against a stub upstream
- `docs/PROXY.md` proxy mode and receipts, `docs/BROWSER-NER.md` the browser NER measurements
