# Releasing

The core package is published as [`@centrst/blind`](https://www.npmjs.com/package/@centrst/blind). Its first usable npm build was `0.1.0-next.20261109.1`, published on 9 November 2026 from commit `ad1bdbe583ad65245d1077a3f8cd5dd940267564`. The earlier `0.0.0-stage` version was a registry bootstrap, not a supported build.

The source version in `package.json` is the next stable version once a release PR has raised it, and the last published stable version until then. A prerelease adds `-next.YYYYMMDD.N` to that base without committing the temporary version. Publishing source, merging a release PR and publishing to npm are separate actions. Only the core package is published.

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

The workflow publishes previews with `--tag next` and stable versions with `--tag latest`. Later previews leave an existing stable `latest` unchanged. Published versions are permanent. Never move or reuse a published version. Publish a new version to correct a mistake.

## Set up automation once

1. `release-pr.yml` can open the release PR only when Actions may create pull requests. That needs **Actions > General > Allow GitHub Actions to create and approve pull requests** in the repository settings, and `changesets/action` on the organization's allowed actions list. At setup on 9 November 2026, the organization policy rejected the first with HTTP 409, and the allow-list permitted only GitHub-owned actions and `pnpm/action-setup`. Until an organization owner changes both, the workflow cannot open a PR even by manual dispatch, so prepare release PRs on a feature branch as described below. Once both are allowed, add the `push` trigger on `main` back to the workflow so pending changesets open the PR on their own. It uses the repository's `GITHUB_TOKEN`, with no personal access token, and dispatches the core and Python CI workflows because token-created PRs do not trigger `pull_request` runs.
2. Create the GitHub environment `release`. Add a maintainer as a required reviewer, and turn off administrator bypass so the review cannot be skipped. Allow only the branch `main` through selected deployment branches. Both channels run from `main` by manual dispatch.
3. In npm's [package settings](https://www.npmjs.com/package/@centrst/blind/access), add a GitHub Actions trusted publisher with organization `centrst`, repository `blind`, workflow filename `release.yml` and environment `release`. Allow direct publishing with `npm publish`. This connection authorizes both channels because both use that workflow and environment. A new connection must complete a successful publish within npm's setup window, currently two days, so configure it when a verified candidate is ready.
4. After confirming trusted publishing works, select **Require two-factor authentication and disallow tokens** under npm publishing access. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` belongs in repository secrets. The publish job uses the npm that ships with Node 26, checks that it is 11.5 or newer for trusted publishing, and publishes provenance from the public repository.

These settings live outside Git. Check them before the first workflow publish. The workflow file alone cannot establish the npm trust relationship or enforce environment reviewers. See npm's [trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/).

## Batch changes into a release PR

Work on feature branches and open PRs. A maintainer merges them after the gate in [CONTRIBUTING.md](CONTRIBUTING.md) passes. Keep local reports, real inputs, mappings, downloaded datasets, weights and credentials out of source changes.

For a change users need to hear about, run:

```sh
pnpm changeset
```

Select `@centrst/blind`, the bump type and a short description of the change. Commit the generated `.changeset/*.md` file with the code. Use patch for compatible fixes and minor for compatible additions. Before 1.0, use minor for API or mapping-format breaks and describe the break. Documentation and tooling changes without a package behavior change need no changeset.

To open the release PR, check out `main` on a feature branch and run `pnpm version:release`. It consumes the pending notes and updates `package.json`, `CHANGELOG.md`, `src/version.ts` and the lockfile together. It includes the workspace root and excludes the private NER package. Run the gate, open the PR as a maintainer, review the version and notes, run the full local gate on that candidate, then merge it. No package is published by that merge. Once Actions may create pull requests, `release-pr.yml` does the same from **Actions**.

For the initial stable `0.1.0`, no changeset is pending, so `pnpm version:release` changes nothing. In its release PR, rename `## Unreleased` in `CHANGELOG.md` to `## 0.1.0` and keep its entries. Changesets inserts each later version above the newest version heading, so do not start a new `Unreleased` section after that. Also rewrite the README's Install section, which still calls the package a preview, because the README ships inside the immutable tarball. If pending changesets propose a later version, use that reviewed version rather than forcing the number back down.

## Node versions

The package supports Node 22 or newer. CI runs the gate on Node 26, the active LTS, and the typecheck, tests and build on 22 and 24. The release workflows run on 26. Drop 22 from the matrix and raise `engines` when Node ends its support on 30 April 2027, and add each new LTS line when it starts.

## Verify the candidate locally

Install the pinned pnpm version and Gitleaks 8.30.1, and set up pip-audit once as described in [CONTRIBUTING.md](CONTRIBUTING.md#python-dependency-audit). `pnpm verify` runs the audit with the `python3` on your PATH, so activate that environment in the same shell. Then run:

```sh
pnpm install --frozen-lockfile
pnpm ner:download
source .local/python-audit-venv/bin/activate
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

Before it builds anything, the workflow refuses a dispatch on another branch, a `verified_sha` that is not `main`'s head at the start of the run, a re-run of the prepare job, and a source version that is already on npm. A preview of a published `X.Y.Z` would sort below it, so after each stable release, merge a release PR that raises the version before the next preview. The workflow then chooses the next unused date counter from npm and updates both version values in the runner. The prepare job builds and packs the tarball and records its sha512 digest as a job output. A separate gate job then runs typecheck, lint and tests on the same source and version, so test dependencies never run beside the digest the publish job trusts. The tests rebuild `dist` and pack it again, and the `tsc` build is deterministic, so that rebuild has the same digest as the uploaded tarball. It uploads the tarball and a `release.json` source and integrity record as the `npm-package` artifact.

Review that candidate and approve the `release` environment. A separate job, with no checkout and no install, downloads the tarball and checks it against the recorded digest. It also checks that the package declares no dependencies and no install scripts. Then it publishes the tarball with provenance to `next`, unless npm already has that exact tarball or already has the stable version the preview is based on, and checks that npm serves it with the same integrity on the dist-tag, retrying for a few minutes while the registry catches up.

`pnpm publish:next --dry-run` packs a preview tarball locally for inspection. It temporarily changes the two version files and restores their original contents afterward, also on Ctrl-C. `--prepare` runs only in the release workflow. The script never publishes. Publishing happens only through the workflow, and the dry run is not a substitute for the full verification gate.

## Publish a stable version

Merge the reviewed release PR, with no pending changesets left on `main`, and verify that commit locally. Dispatch **Release** on `main` with channel `stable` and its full `verified_sha`. Approve the `release` environment after reviewing the candidate. The workflow publishes the source's exact `X.Y.Z` version to `latest`.

Git tags do not publish. The repository's `Publication hold - tags` ruleset currently blocks creating, updating and deleting every tag. If tags are allowed later, create `vX.Y.Z` after a stable publish as a record of the source commit.

If the publish job fails, use **Re-run failed jobs**. The publish step skips `npm publish` when npm already has the tested tarball, so a failure after a successful publish can be retried safely. A retry that still needs to publish is refused once `main` has moved past the source commit, and **Re-run all jobs** is refused, because it would repeat the prepare job. In both cases, dispatch a new run. If source needs a fix, merge it first.

## After publishing

Run `npm view @centrst/blind@X.Y.Z version dependencies bin`. It shows the version, no dependencies and the `blind` and `unblind` bins. The package page shows the provenance badge, linked to the source commit and the workflow run. In an empty folder, run `npm install @centrst/blind@X.Y.Z`. Then `echo 'Pay 120,00 € to ana@example.example' | npx blind --seed check` prints a blind copy and a run id, and `node -e "import('@centrst/blind').then(m => console.log(typeof m.blind))"` prints `function`. Keep the local full-gate reports with the source commit and workflow record. The CI `npm-package` artifact records the tarball and its integrity, not the full local gate.

If npm accepted a publish but a later workflow step failed, the version already exists. Inspect the registry before retrying. Never try to replace the published tarball. Deprecate a faulty version with a reason and publish a fix.

The README bundled in an npm version is part of that immutable tarball. Documentation fixes reach the GitHub repository through a PR and reach npm with the next package version.

## The NER package

`@centrst/blind-ner` in `ner/` is a prototype built from this repository, not on npm. It remains `private` and is excluded from versioning and publishing. Build it with `pnpm build` and `pnpm build:ner`. See [ner/README.md](ner/README.md) for model requirements and measured limits.

Publishing it needs its own review of model distribution, notices, a real peer dependency range, package contents, offline installation, release notes and versioning. Training source supports reproducing research; training runs and model distribution remain separate decisions.
