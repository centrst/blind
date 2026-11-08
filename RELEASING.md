# Releasing

Publishing the source does not publish an npm package, a model or a hosted service. This tree has no release workflow. Do not publish a package until a separate pull request configures and reviews that workflow and its authentication.

## Source changes

Work on a feature branch. Run the gate in [CONTRIBUTING.md](CONTRIBUTING.md), review the files and open a pull request. A maintainer merges approved changes. Do not push directly to `main`.

Keep research code and the measurements supporting published claims available. Do not include local reports, real inputs, mappings, downloaded datasets, model weights or deployment credentials in a source change. The tests use invented data.

## Before the first npm release

1. Configure a reviewed Ubuntu publishing workflow with actions pinned to full commit SHAs, minimal permissions, provenance and protected release authorization. Review the actual registry authentication before enabling it. Do not put a publish credential in the repository.
2. Confirm the package name and registry permissions. The core package is `@centrst/blind`; the optional NER package remains private.
3. On a feature branch, update `CHANGELOG.md`, the install instructions, `package.json` and `src/version.ts` for the intended version. Build check C19/B2 keeps the two version values equal.
4. Install the pinned pnpm version and Gitleaks 8.30.1. Run `pnpm secrets` and `pnpm install --frozen-lockfile`.
5. Fetch the pinned NER model with `pnpm ner:download`, then run `pnpm verify`. It includes the model tests, 20,000-case properties, mutation testing, corpus floors and `claims --strict`. A skipped model check is not release evidence. Fix failures before continuing.
6. Review the regenerated `CLAIMS.md` and the package contents with `npm pack --dry-run`. The package contains `dist/`, `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md` and `package.json`. Source maps contain source text and need the same disclosure review as source files. The C37/K1 tests install the tarball offline and exercise both commands.
7. Commit the reviewed version, changelog and claims on the feature branch. Open a pull request for a maintainer to approve and merge. The release must identify that reviewed commit and its successful verification.
8. Once the separate publishing workflow and release authorization are in place, follow its documented procedure to publish. Never move, delete or reuse a published release tag or modify published release assets. If a release is wrong, issue a new version. For an npm package that should no longer be used, deprecate that version with a reason.
9. Check the registry version, provenance, dependency list and command entry points. Install the exact version into an empty project and verify the library and both commands before announcing it.

## The NER package

`@centrst/blind-ner` in `ner/` is a prototype. It is marked `private` and is not published with the core. Build it from source with `pnpm build` and `pnpm build:ner`. See [ner/README.md](ner/README.md) for model requirements and measured limits.

Publishing it requires its own review: model distribution and notices, a real peer dependency range for the core, package contents, an offline installation check, release notes and a distinct versioning procedure. Training source is available for reproducing research; training runs and model distribution are separate decisions.
