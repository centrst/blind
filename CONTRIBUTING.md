# Contributing to blind

Thanks for helping. blind is a privacy library, so most of what follows is about keeping two promises: no real data ever enters the repository, and every claim the README makes stays backed by a passing test.

To report a way past blind's protection, do not open an issue or a pull request. Follow [SECURITY.md](SECURITY.md) instead.

## Setup

You need Node 22 or newer and pnpm (the version is pinned in `package.json` under `packageManager`; `corepack enable` picks it up).

```
pnpm install --frozen-lockfile
```

## The gate

Install [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) and put its binary on your PATH. Every pull request must pass these commands in order. Public CI runs them on Ubuntu; the local gate runs them before review.

```
pnpm secrets
pnpm typecheck
pnpm lint
pnpm test       # unit, properties (2,000 cases), corpus, adversarial, CLI, no-network, build checks
pnpm build
```

`pnpm secrets` scans Git history, the index and tracked or untracked files that Git has not ignored. It requires the pinned scanner and ignores inline suppression comments. The three checksum exceptions in `.gitleaks.toml` match exact values and paths. New exceptions need review. Scanning cannot prove the absence of secrets or private context, so review the diff before committing.

Property tests are seeded. `NUM_RUNS` sets the case count. Each run writes its seed to `reports/seed.txt`, and `SEED=<that value> pnpm test` replays it.

## Deeper suites

These run before a release, through `pnpm verify`. Run the one that matches your change.

| Command | What it does | What it needs |
| --- | --- | --- |
| `pnpm corpus` | recall and precision per kind against `corpus/floors.json` | nothing extra |
| `pnpm corpus:generate` | rebuilds `corpus/generated` (never edit those files by hand) | nothing extra |
| `pnpm known-misses` | regenerates `corpus/adversarial/known-misses.md` | nothing extra |
| `pnpm test:deep` | properties at 20,000 cases | a few minutes |
| `pnpm mutation` | Stryker against the floor in `stryker.config.json` | about 30 minutes on a full run |
| `pnpm build && pnpm build:ner` | builds the NER package, which imports the built core | nothing extra |
| `pnpm test:ner` | the NER package: stub tests always, model tests when the model is present | the model, for the model tests |
| `pnpm ner:download` | fetches the GLiNER weights once, pinned and checksummed | about 1.1 GB of disk and a network connection |
| `pnpm ner:eval` | scorecard with and without the NER detector | the model |
| `pnpm claims` | writes `CLAIMS.md` and fails on a claim without a passing test | reports from `pnpm test`, `pnpm mutation` and, for model claims, `pnpm test:ner` |
| `pnpm verify` | all of the above in CI order, with `claims --strict`; `--fast` skips `test:deep` | the model and the time for a mutation run |

[TESTING.md](TESTING.md) explains how each claim is proved.

## Rules

- **Synthetic fixtures only.** Invent every name, company, amount and number. Use `.example` domains. Never paste real mail, people, companies or amounts into tests, docs, issues or commits, not even your own.
- **No network in `src`.** Nothing under `src` may make a network call. The no-network suite checks this.
- **No Node in the core.** No `node:` imports and no Node-only globals in `src` outside `src/cli`. The core is checked in a bare realm (C19).
- **No `Math.random`.** Use the seeded `Rng`, so output is reproducible from a seed.
- **Errors never carry values.** Leak reports and error messages carry a kind and an index, never the value. The CLI prints kinds and offsets only.
- **Detectors stay behind the `Detector` interface.** A new detector plugs in there, not in the core.
- **No new runtime dependencies** without a clear reason, discussed in an issue first. The NER package keeps its dependencies in `ner/`.
- **Claim ids on tests.** A test that backs a claim starts its name with the claim id (`C4/P4: ...`). A claim id in the README or TESTING.md needs a passing test.
- **Floors only go up.** The floors in `corpus/floors.json` and `corpus/floors-ner.json` and the mutation break score in `stryker.config.json` are never lowered to make a change pass.
- **Known misses are written down.** A new miss goes into `corpus/adversarial` as a case with `"expect": "silent"` and a `"why"` explaining it. Then run `pnpm known-misses` and commit the regenerated `known-misses.md`.
- **Prose has no em dashes.**

Scratch files go in `.local/`, which git ignores.

## Pull requests

1. Open an issue first for anything bigger than a small fix, so we can agree on the approach.
2. Keep a pull request to one change. Say what it changes and why, and name the claim ids it touches.
3. Fill in the checklist in the pull request template.
4. The gate runs on every pull request. One with a red gate is not reviewed until it is green.
5. A maintainer reviews the change. Expect questions about claims, floors and test coverage: a detection change needs corpus or adversarial cases, and a change to `leaks.ts`, `amounts.ts` or `dates.ts` needs tests that would catch the bug it guards against.
6. A maintainer merges once the review is approved and the gate is green.

By contributing you agree that your work is released under the [MIT license](LICENSE) and that you follow the [code of conduct](CODE_OF_CONDUCT.md).
