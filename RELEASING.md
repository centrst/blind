# Releasing

The core package is published as [`@centrst/blind`](https://www.npmjs.com/package/@centrst/blind). Its first usable npm build was `0.1.0-next.20261109.1`, published on 9 November 2026 from commit `ad1bdbe583ad65245d1077a3f8cd5dd940267564`. The earlier `0.0.0-stage` version was a registry bootstrap, not a supported build.

The source version in `package.json` is the stable version being developed. A prerelease adds `-next.YYYYMMDD.N` to that base without committing the temporary version. Publishing source, merging a release PR and publishing to npm are separate actions. Only the core package is published.

## Channels

| Channel | Version | Install |
| --- | --- | --- |
| Prerelease | `X.Y.Z-next.YYYYMMDD.N` | `npm install @centrst/blind@next` |
| Stable | `X.Y.Z` | `npm install @centrst/blind@latest` |

Both `latest` and `next` initially pointed to `0.1.0-next.20261109.1`. A channel name does not establish stability. Until the first stable release replaces `latest`, an unqualified install also installs that prerelease. Check the registry instead of inferring publication status from the source version:

```sh
npm view @centrst/blind dist-tags --json
npm view @centrst/blind versions --json
```

The workflow publishes previews with `--tag next` and stable versions with `--tag latest`. Later previews leave an existing stable `latest` unchanged. Published versions are permanent. Never move or reuse a published version or its release tag; publish a new version to correct a mistake.

## Set up automation once

1. The organization must permit Actions to create pull requests. In GitHub's repository settings, enable **Actions > General > Allow GitHub Actions to create and approve pull requests**. The release PR workflow uses the repository's `GITHUB_TOKEN`, with no personal access token. It dispatches the core and Python CI workflows explicitly because token-created PRs do not trigger `pull_request` runs. At setup on 9 November 2026, the organization policy rejected enabling this repository setting with HTTP 409, so `release-pr.yml` runs only by manual dispatch. Once an organization owner allows the setting, add the `push` trigger on `main` back to that workflow so pending changesets open the PR on their own.
2. Create the GitHub environment `release`. Add a maintainer as a required reviewer. Allow the branch `main` and tags matching `v*` through selected deployment branches and tags. Both manual channels use `main`; stable tag runs must point to a commit on `main`.
3. In npm's [package settings](https://www.npmjs.com/package/@centrst/blind/access), add a GitHub Actions trusted publisher with organization `centrst`, repository `blind`, workflow filename `release.yml` and environment `release`. Allow direct publishing with `npm publish`. This connection authorizes both channels because both use that workflow and environment. A new connection must complete a successful publish within npm's setup window, currently two days, so configure it when a verified candidate is ready.
4. After confirming trusted publishing works, select **Require two-factor authentication and disallow tokens** under npm publishing access. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` belongs in repository secrets. The workflow uses npm 11.21.0 and GitHub OIDC, and publishes provenance from the public repository.

These settings live outside Git. Check them before the first workflow publish. The workflow file alone cannot establish the npm trust relationship or enforce environment reviewers. See npm's [trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/).

## Batch changes into a release PR

Work on feature branches and open PRs. A maintainer merges them after the gate in [CONTRIBUTING.md](CONTRIBUTING.md) passes. Keep local reports, real inputs, mappings, downloaded datasets, weights and credentials out of source changes.

For a change users need to hear about, run:

```sh
pnpm changeset
```

Select `@centrst/blind`, the bump type and a short description of the change. Commit the generated `.changeset/*.md` file with the code. Use patch for compatible fixes and minor for compatible additions. Before 1.0, use minor for API or mapping-format breaks and describe the break. Documentation and tooling changes without a package behavior change need no changeset.

`release-pr.yml` combines pending notes into one draft PR when you run it from **Actions**. Its version command updates `package.json`, `CHANGELOG.md`, `src/version.ts` and the lockfile together. It includes the workspace root and excludes the private NER package. Review the version and notes, run the full local gate on that candidate, then let a maintainer merge it. No package is published by that merge.

While organization policy blocks bot-created PRs, prepare the same change on a feature branch with `pnpm version:release`, run the gate and open a PR as a maintainer. This uses the same versioning and changelog command without a personal token or an organization policy change. The publish workflow works independently of how the release PR was opened.

For the initial stable `0.1.0`, the source already names the intended version. Prepare its stable changelog entry through a PR. If pending changesets propose a later version, use that reviewed version rather than forcing the number back down.

## Node versions

The package supports Node 22 or newer. CI runs the gate on Node 26, the active LTS, and the typecheck, tests and build on 22 and 24. The release workflows run on 26. Drop 22 from the matrix and raise `engines` when Node ends its support on 30 April 2027, and add each new LTS line when it starts.

## Verify the candidate locally

Install the pinned pnpm version and Gitleaks 8.30.1. Set up pip-audit as described in [CONTRIBUTING.md](CONTRIBUTING.md#python-dependency-audit). Fetch the pinned model once with `pnpm ner:download`, then run:

```sh
pnpm install --frozen-lockfile
pnpm verify
npm pack --dry-run
```

The full gate includes model tests, 20,000-case properties, mutation testing, corpus floors and `claims --strict`. Do not use `--fast` for release evidence. A skipped required model check is not release evidence.

Review the generated `CLAIMS.md`, `reports/evidence.html` and the tarball contents. Source maps contain source text and need disclosure review too. The pack tests install the tarball offline and run the library and both commands. Retain the reports and record the exact source commit in the release PR or release record. Regenerated claims can be committed through that PR; do not copy evidence from another source revision.

After merge, check out the selected commit on `main` and run the full gate there before dispatching. The workflow's `verified_sha` input records the maintainer's statement that this local run passed. Matching a SHA does not prove the local run happened. The environment reviewer must review that evidence. The Release workflow's prepare job repeats typecheck, lint, tests and build on the actual version being packed, including the temporary prerelease version. The heavy suites remain local.

## Publish a prerelease

In **Actions > Release > Run workflow**, select branch `main`, channel `next` and the full SHA of the verified commit. The CLI equivalent is:

```sh
gh workflow run release.yml --ref main \
  -f channel=next -f verified_sha="$(git rev-parse HEAD)"
```

The workflow rejects a dispatch on another branch or when `main` has advanced beyond `verified_sha`. It chooses the next unused date counter from npm, updates both version values in the runner and runs typecheck, lint, tests and build. It uploads the tested tarball and a `release.json` source and integrity record as the `npm-package` artifact.

Review that candidate and approve the `release` environment. A separate job downloads the same tarball, publishes it with provenance to `next`, then compares npm's version, integrity, dependencies and command entries against the candidate. It does not rebuild the package in the publishing job.

`pnpm publish:next --dry-run` remains available locally for inspecting a preview tarball. It temporarily changes the two version files and restores their original contents afterward. `--prepare` is used by CI and leaves the temporary version in place for its gate. The older local `pnpm publish:next` path still requires `npm login`, has no CI provenance and is unnecessary for normal releases. Neither local path is a substitute for the full verification gate.

## Publish a stable version

Merge the reviewed release PR, with no pending changesets left on `main`, and verify that commit locally. Dispatch **Release** on `main` with channel `stable` and its full `verified_sha`. Approve the `release` environment after reviewing the candidate. The workflow publishes the source's exact `X.Y.Z` version to `latest`.

Tag-based releases also work, once the repository's `Publication hold - tags` ruleset lets a maintainer create `v*` tags. It currently blocks creating, updating and deleting every tag with no bypass actor, so use the dispatch path until that changes:

```sh
git tag -a vX.Y.Z -m 'Release X.Y.Z'
git push origin vX.Y.Z
```

The tag must match `package.json`, contain a stable version and point to a commit on `main`. For tag runs, the environment reviewer must check the local verification record for that commit before approving. Tags never publish a prerelease through this workflow. Keep release tags immutable, including after a failed attempt. Retry the workflow for a transient failure; if source needs a fix, merge it and use a new version and tag.

## After publishing

Check the exact version on npm, its provenance and the workflow run. Install it into an empty project and exercise the library and both commands. Keep the local full-gate reports with the source commit and workflow record. The CI `npm-package` artifact records the tarball and its integrity, not the full local gate.

If npm accepted a publish but a later workflow step failed, the version already exists. Inspect the registry before retrying. Never try to replace the published tarball. Deprecate a faulty version with a reason and publish a fix.

The README bundled in an npm version is part of that immutable tarball. Documentation fixes reach the GitHub repository through a PR and reach npm with the next package version.

## The NER package

`@centrst/blind-ner` in `ner/` is a prototype built from this repository, not on npm. It remains `private` and is excluded from versioning and publishing. Build it with `pnpm build` and `pnpm build:ner`. See [ner/README.md](ner/README.md) for model requirements and measured limits.

Publishing it needs its own review of model distribution, notices, a real peer dependency range, package contents, offline installation, release notes and versioning. Training source supports reproducing research; training runs and model distribution remain separate decisions.
