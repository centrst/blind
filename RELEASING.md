# Releasing

The core package is published as [`@centrst/blind`](https://www.npmjs.com/package/@centrst/blind). Its first usable npm build was `0.1.0-next.20261109.1`, published on 9 November 2026 from commit `ad1bdbe583ad65245d1077a3f8cd5dd940267564`. The earlier `0.0.0-stage` version was a registry bootstrap, not a supported build.

The source version in `package.json` is the next stable version once a release PR has raised it, and the last published stable version until then. A prerelease adds `-next.YYYYMMDD.N` to that base without committing the temporary version. Publishing source, merging a release PR and publishing to npm are separate actions. This page describes the core package. The NER package, `@centrst/blind-ner`, is ready to publish through the same workflow and has not been released; [its section](#the-ner-package) lists what differs.

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
3. In npm's [package settings](https://www.npmjs.com/package/@centrst/blind/access), add a GitHub Actions trusted publisher with organization `centrst`, repository `blind`, workflow filename `release.yml` and environment `release`. Leave **Allow `npm publish`** and **Allow `npm dist-tag`** unchecked, so the workflow can only stage a version and nothing goes public until a maintainer approves it on npm with 2FA. This connection authorizes both channels because both use that workflow and environment. A new connection must complete a successful publish within npm's setup window, currently two days, so configure it when a verified candidate is ready. npm's documentation does not say whether a staged publish counts toward that window, or whether provenance survives approval; check both on the first release.
4. After confirming trusted publishing works, select **Require two-factor authentication and disallow tokens** under npm publishing access. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` belongs in repository secrets. The publish job uses the npm that ships with Node 26, checks that it is 11.15 or newer for staged publishing, and stages the version with provenance from the public repository.

These settings live outside Git. Check them before the first workflow publish. The workflow file alone cannot establish the npm trust relationship or enforce environment reviewers. See npm's [trusted publishing instructions](https://docs.npmjs.com/trusted-publishers/).

## Batch changes into a release PR

Work on feature branches and open PRs. A maintainer merges them after the gate in [CONTRIBUTING.md](CONTRIBUTING.md) passes. Keep local reports, real inputs, mappings, downloaded datasets, weights and credentials out of source changes.

For a change users need to hear about, run:

```sh
pnpm changeset
```

Select `@centrst/blind`, the bump type and a short description of the change. Commit the generated `.changeset/*.md` file with the code. Use patch for compatible fixes and minor for compatible additions. Before 1.0, use minor for API or mapping-format breaks and describe the break. Documentation and tooling changes without a package behavior change need no changeset.

To open the release PR, check out `main` on a feature branch and run `pnpm version:release`. It consumes the pending notes and updates `package.json`, `CHANGELOG.md`, `src/version.ts` and the lockfile together. It versions the workspace root and leaves the NER package alone, which Changesets ignores and a maintainer versions by hand. Run the gate, open the PR as a maintainer, review the version and notes, run `pnpm verify` on that candidate, then merge it. No package is published by that merge. Once Actions may create pull requests, `release-pr.yml` does the same from **Actions**.

For the initial stable `0.1.0`, no changeset is pending, so `pnpm version:release` changes nothing. In its release PR, rename `## Unreleased` in `CHANGELOG.md` to `## 0.1.0` and keep its entries. Changesets inserts each later version above the newest version heading, so do not start a new `Unreleased` section after that. Also rewrite the README's Install section, which still calls the package a preview, because the README ships inside the immutable tarball. If pending changesets propose a later version, use that reviewed version rather than forcing the number back down.

## Node versions

The package supports Node 22 or newer. CI runs the gate on Node 26, the active LTS, and the typecheck, tests and build on 22 and 24. The release workflows run on 26. Drop 22 from the matrix and raise `engines` when Node ends its support on 30 April 2027, and add each new LTS line when it starts.

## Verify the candidate locally

Install the pinned pnpm version and Gitleaks 8.30.1, and set up pip-audit once as described in [CONTRIBUTING.md](CONTRIBUTING.md#python-dependency-audit). `pnpm verify` runs the audit with the `python3` on your PATH, so activate that environment in the same shell. Then run:

```sh
pnpm install --frozen-lockfile
source .local/python-audit-venv/bin/activate
pnpm verify
npm pack --dry-run
```

The gate checks only what the package ships, in about 12 minutes. It covers secrets, the Python audit, typecheck, lint, build, the test suite, 20,000-case properties, corpus floors and `claims --strict` on the core claims. Do not use `--fast` for release evidence. The NER package has its own gate, so its tests are not part of this one. Mutation testing measures the test suite rather than the package, and takes hours. Both run with `pnpm verify --full`, which belongs in the PR that changes the NER package or the test suite. To get a mutation score for a revision without running it locally, start **Actions > Mutation > Run workflow**, which runs `mutation.yml` and fails below the floor.

Review the generated `CLAIMS.md`, `reports/evidence.html` and the tarball contents. Source maps contain source text and need disclosure review too. The pack tests install the tarball offline and run the library and both commands. Retain the reports and record the exact source commit in the release PR or release record. Regenerated claims can be committed through that PR; do not copy evidence from another source revision.

After merge, check out the selected commit on `main` and run `pnpm verify` there before dispatching. The workflow's `verified_sha` input records the maintainer's statement that this local run passed. Matching a SHA does not prove the local run happened. The environment reviewer must review that evidence. The Release workflow's prepare job repeats typecheck, lint, tests and build on the actual version being packed, including the temporary prerelease version. The heavy suites remain local.

## Publish a prerelease

In **Actions > Release > Run workflow**, select branch `main`, package `blind`, channel `next` and the full SHA of the verified commit. The CLI equivalent is:

```sh
gh workflow run release.yml --ref main \
  -f package=blind -f channel=next -f verified_sha="$(git rev-parse HEAD)"
```

Before it builds anything, the workflow refuses a dispatch on another branch, a `verified_sha` that is not `main`'s head at the start of the run, a re-run of the prepare job, and a source version that is already on npm. A preview of a published `X.Y.Z` would sort below it, so after each stable release, merge a release PR that raises the version before the next preview. The workflow then chooses the next unused date counter from npm and updates both version values in the runner. The prepare job builds and packs the tarball and records its sha512 digest as a job output. A separate gate job then runs typecheck, lint and tests on the same source and version, so test dependencies never run beside the digest the publish job trusts. The tests rebuild `dist` and pack it again, and the `tsc` build is deterministic, so that rebuild has the same digest as the uploaded tarball. It uploads the tarball and a `release.json` source and integrity record as the `npm-package` artifact.

Review that candidate and approve the `release` environment. A separate job, with no checkout and no install, downloads the tarball and checks it against the recorded digest. It also checks that the package declares no dependencies and no install scripts. Then it stages the tarball with provenance on `next`, unless npm already has that exact tarball or already has the stable version the preview is based on. The run summary shows the version and the tarball's integrity. Nothing is public yet: approve the staged version as described below.

`pnpm publish:next --dry-run` packs a preview tarball locally for inspection. It temporarily changes the two version files and restores their original contents afterward, also on Ctrl-C. `--prepare` runs only in the release workflow. The script never publishes. Publishing happens only through the workflow, and the dry run is not a substitute for the full verification gate.

## Publish a stable version

Merge the reviewed release PR, with no pending changesets left on `main`, and verify that commit locally. Dispatch **Release** on `main` with channel `stable` and its full `verified_sha`. Approve the `release` environment after reviewing the candidate. The workflow stages the source's exact `X.Y.Z` version on `latest`. Then approve the staged version as described below.

Git tags do not publish. The repository's `Publication hold - tags` ruleset currently blocks creating, updating and deleting every tag. If tags are allowed later, create `vX.Y.Z` after a stable publish as a record of the source commit.

If the publish job fails, use **Re-run failed jobs**. The publish step skips `npm stage publish` when npm already has the tested tarball, so a failure after an approved publish can be retried safely. If the version is staged but not yet approved, approve or reject it instead of re-running: npm refuses to stage a version that is already staged. For the same reason, approve or reject a staged preview before dispatching another preview on the same UTC day: the workflow picks the next counter from published versions only, because the trusted publisher cannot list staged ones. A retry that still needs to publish is refused once `main` has moved past the source commit, and **Re-run all jobs** is refused, because it would repeat the prepare job. In both cases, dispatch a new run. If source needs a fix, merge it first.

## Approve the staged version

The workflow can stage a version but cannot make it public. A maintainer does that with 2FA, on npmjs.com under the package's **Staged Packages** tab or with the CLI:

```sh
npm stage list @centrst/blind
npm stage view <stage-id>        # version, tag and integrity
npm stage download <stage-id>    # the tarball, to inspect
npm stage approve <stage-id>
```

Approve only when the version, the dist-tag and the integrity match the run summary. `npm stage reject <stage-id>` removes a staged version that is wrong; then fix the cause and dispatch a new run. After approving, `npm view @centrst/blind@X.Y.Z dist.integrity` and `npm view @centrst/blind dist-tags` show the tarball's integrity and the version on its channel.

## After publishing

Run `npm view @centrst/blind@X.Y.Z version dependencies bin`. It shows the version, no dependencies and the `blind` and `unblind` bins. The package page shows the provenance badge, linked to the source commit and the workflow run. In an empty folder, run `npm install @centrst/blind@X.Y.Z`. Then `echo 'Pay 120,00 € to ana@example.example' | npx blind --seed check` prints a blind copy and a run id, and `node -e "import('@centrst/blind').then(m => console.log(typeof m.blind))"` prints `function`. Keep the local `pnpm verify` reports with the source commit and workflow record. The CI `npm-package` artifact records the tarball and its integrity, not the local gate.

If npm accepted a publish but a later workflow step failed, the version already exists. Inspect the registry before retrying. Never try to replace the published tarball. Deprecate a faulty version with a reason and publish a fix.

The README bundled in an npm version is part of that immutable tarball. Documentation fixes reach the GitHub repository through a PR and reach npm with the next package version.

## The NER package

`@centrst/blind-ner` in `ner/` is packaged for npm and has not been released: until its first release it is a prototype built from this repository, not on npm. It uses the same workflow, `release` environment, staging and 2FA approval as the core. Select it with the workflow's `package` input. These are the differences.

### Versioning and notes

Changesets ignores this package, so `pnpm changeset` notes are for the core only. In a release PR, set `version` in `ner/package.json` by hand and write the entry in `ner/CHANGELOG.md` under a `## X.Y.Z` heading. The workflow refuses a stable release whose version has no heading there. Use the core's rules for the number: before 1.0, minor for a break.

### The core range

`ner/package.json` names the core as a peer dependency with `workspace:^`. pnpm links the workspace copy and, when it packs, writes a caret range on the core's version in this tree: `^0.2.0` while the core is `0.2.0`. So each NER version names the core it was built and tested with, and nobody edits the range. The tarball is made with `pnpm pack`, never `npm pack`, which would ship the `workspace:` text. The publish job refuses a tarball whose peer range is not a plain version range.

That makes the order fixed: the core first. The workflow refuses an NER release, on either channel, while changesets are pending or while npm does not have the core version in `package.json`. Otherwise the NER tarball would name a core nobody can install, or would have been tested against core source that npm does not have.

The first NER release follows core `0.2.0`, so its range is `^0.2.0`. Before 1.0 a caret range stops at the next minor, so after each core minor, release the NER package again, even with no changes of its own.

### Gate

Run `pnpm verify --full` on the commit, with the model present (`pnpm ner:download`). It adds the NER typecheck, lint, build and tests to the core gate, and mutation testing. The workflow's gate job also runs `pnpm test:ner`, but the runner has no weights, so the model tests skip there. The local run is the evidence for C15 to C18.

`pnpm build && pnpm build:ner && pnpm -C ner pack --dry-run` lists what ships: `dist/`, `licenses/APACHE-2.0.txt`, `README.md`, `THIRD-PARTY-NOTICES.md`, `package.json` and `LICENSE`, which pnpm copies from the workspace root. The pack check (C56) in `pnpm test:ner` unpacks that tarball beside the core with no registry access and uses it by package name.

### Once, before the first release

1. npm shows a package's settings only once the package exists, so the first version is a placeholder a maintainer publishes by hand with 2FA. The core's was `0.0.0-stage`, described as a temporary placeholder for staged publishing. Do the same for `@centrst/blind-ner`.
2. In that package's npm settings, add a GitHub Actions trusted publisher with organization `centrst`, repository `blind`, workflow filename `release.yml` and environment `release`, with **Allow `npm publish`** and **Allow `npm dist-tag`** unchecked, as for the core. After the first workflow publish, select **Require two-factor authentication and disallow tokens**.
3. In the first release PR, rename `## Unreleased` in `ner/CHANGELOG.md` to the version. Also change the status wording, which stops being true once the version is approved: `ner/README.md` ships in the tarball and says the package is not on npm, and the B3 test in `test/readme.test.ts` requires that sentence in every file that reports NER numbers. Change the test and those files together.

### Publish and check

```sh
gh workflow run release.yml --ref main \
  -f package=blind-ner -f channel=next -f verified_sha="$(git rev-parse HEAD)"
```

Use `channel=stable` for a stable version. Approve the `release` environment, then the staged version, as for the core: `npm stage list @centrst/blind-ner`.

Then `npm view @centrst/blind-ner@X.Y.Z version dependencies peerDependencies bin` shows the version, the two pinned libraries, the core range and the `blind-ner-download` command. In an empty folder, `npm install @centrst/blind @centrst/blind-ner@X.Y.Z` and `npx blind-ner-download ./models/gliner_multi-v2.1` fetch the pair and the model, and `node -e "import('@centrst/blind-ner').then(async (m) => console.log(typeof (await m.GlinerModel.load('./models/gliner_multi-v2.1')).predict))"` prints `function`.

The weights are never published by this repository: the download command fetches them from Hugging Face at a pinned revision. Training source supports reproducing research; training runs and distributing a trained model remain separate decisions.
