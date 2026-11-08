# Claims verification status

Results below are scoped to their source revision. A release needs a generated claims report from that release revision's own results.

The runtime and tests used for the [initial public import](https://github.com/centrst/blind/commit/f1be8889ae5c01a064878dec619f8983d95227f2) passed typechecking, linting, the core tests, both package builds, the corpus floors, secret scanning, mutation testing and the default NER model tests on Node 22.23.4. The tested snapshot differed from that public commit only in documentation and a CI version comment.

The final core run, with the mutation report required, recorded 655 passed tests, 23 expected failures for documented known misses, and no skips. The NER run recorded 32 passed tests and seven skipped optional trained-model tests. The property-test seed was `20261108`. `pnpm claims --strict` passed with all 48 claims backed.

Stryker reported a mutation score of 81.26%. The repository's claims calculator reported 81.23% because it counts three runtime-error mutants as undetected while Stryker excludes them. Both passed the unchanged 73% floor.

The later organization-suffix fix in [PR #1](https://github.com/centrst/blind/pull/1) passed the standard local gate and public CI and CodeQL checks. Its new regression is covered by C41. The initial import's mutation, model and generated claims results do not cover this later runtime change.

The 20,000-case deep suite and the complete `pnpm verify` release gate have not run for these revisions. Before publishing a package, run that gate on the release revision and review the generated `CLAIMS.md` separately. Do not reuse a report from another source revision.

[TESTING.md](TESTING.md) defines the claims and their required evidence. [Known misses](corpus/adversarial/known-misses.md) records the current detection limits. [RELEASING.md](RELEASING.md) describes the additional checks required before publishing a package.
