# Claims verification status

This initial source import has passed typechecking, linting, the core tests, both package builds, the corpus floors, secret scanning and the default NER model tests on Node 22.23.4.

The core test run recorded 654 passed tests, 23 expected failures for documented known misses, and one skipped mutation-report check. The NER run recorded 32 passed tests and seven skipped optional trained-model tests. The property-test seed was `20261108`.

The full mutation run is still in progress. Claim C11 has not yet been verified for this import; no mutation score is asserted here. The 73% floor is unchanged. The 20,000-case deep suite and the complete `pnpm verify` release gate have not run for this import. This is not a package release.

After mutation testing finishes, run `MUTATION_REPORT_REQUIRED=1 pnpm test`, then `pnpm claims --strict` to replace this status page with the generated report from those results. Review and commit that report separately. Do not reuse a report from another source revision.

[TESTING.md](TESTING.md) defines the claims and their required evidence. [Known misses](corpus/adversarial/known-misses.md) records the current detection limits. [RELEASING.md](RELEASING.md) describes the additional checks required before publishing a package.
