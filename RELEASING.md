# Releasing

Publishing the source does not publish an npm package, a model or a hosted service. A release of `@centrst/blind` is a version tag on `main`; `.github/workflows/release.yml` publishes it with provenance through npm trusted publishing, so no publish credential exists anywhere. Only the core package is published. The NER package stays in this repository (see the last section).

## Source changes

Work on a feature branch. Run the gate in [CONTRIBUTING.md](CONTRIBUTING.md), review the files and open a pull request. A maintainer merges approved changes. Do not push directly to `main`.

Keep research code and the measurements supporting published claims available. Do not include local reports, real inputs, mappings, downloaded datasets, model weights or deployment credentials in a source change. The tests use invented data.

## Throwaway builds on the `next` tag

While a release is taking shape, builds can go to npm without a real version:

```sh
pnpm publish:next --dry-run   # shows the version and the tarball, publishes nothing
pnpm publish:next             # publishes to the next dist-tag
```

The script publishes the working tree as `X.Y.Z-next.YYYYMMDD.N`, where `X.Y.Z` is the version in `package.json`, the date is today's in UTC and `N` continues from what the registry already has for that date. It writes that version into `package.json` and `src/version.ts` for the pack and build, so receipts name the build, and restores both from git afterwards, which is why both must be clean to start.

What makes this lane safe to use freely:

- It never touches `latest`. `npm install @centrst/blind` keeps resolving to the last real release, and caret ranges skip prereleases, so nobody gets a build by accident. Consumers that want one pin `@centrst/blind@next` or an exact version.
- A prerelease version is as permanent as any other, so nothing needs unpublishing. The real `X.Y.Z` sorts after every `X.Y.Z-next.*` and takes over when it ships.
- It runs from a maintainer's machine after `npm login`, so it carries no provenance. Only a tag produces a release.

## Once, before the first release

The release workflow authenticates with npm trusted publishing, which is configured on the package's settings page on npmjs.com. That page exists only once the package does, so the very first publish is by hand:

1. On a maintainer's machine, `npm login` as a member of the `centrst` organization on npm, then `pnpm publish:next` from a clean checkout of `main`. This creates `@centrst/blind` on the registry as a prerelease. npm may point `latest` at it because no `latest` exists yet; a plain install then resolves to a version that says `next` in its name until the first release ships.
2. On npmjs.com, open the package, **Settings**, **Trusted Publisher**, choose GitHub Actions and enter the organization `centrst`, the repository `blind`, the workflow filename `release.yml` and the environment `release`. Under **Publishing access**, choose the option that requires two-factor authentication or trusted publishing and disallows tokens.
3. On GitHub, open **Settings**, **Environments**, create `release` and add the maintainers as required reviewers. Limit its deployment branches and tags to tags matching `v*`. Each release run then waits for an approval before the publish job starts.
4. Add the package to the `developers` team of the npm organization if other maintainers need to manage it.

## A release

1. **Gate on a maintainer's machine.** The pinned pnpm version and Gitleaks 8.30.1 installed, the NER model fetched once with `pnpm ner:download`. Then `pnpm secrets`, `pnpm install --frozen-lockfile` and `pnpm verify`, which runs typecheck, lint, build, the unit and property tests, the NER model tests, 20,000 property cases, the corpus floors, mutation testing and `claims --strict`, and stops at the first failure. Red means no release. A skipped model check is not release evidence.
2. **Changelog.** Move the `Unreleased` entries in `CHANGELOG.md` under a heading for the new version with the date. Write for someone who uses the package: new options, changed output, fixed misses, anything that breaks a stored mapping.
3. **Version.** Pick `X.Y.Z` by semver. Before 1.0, a change that breaks the API or the mapping format bumps the minor. Set it in two places, which build check C19/B2 keeps equal: `package.json` with `npm version X.Y.Z --no-git-tag-version`, and `VERSION` in `src/version.ts`, which receipts name. For the first release, also replace the "not on npm yet" paragraph in the README's Install section with `npm install @centrst/blind`.
4. **Tarball.** `npm pack --dry-run` lists what will ship: `dist/` (the built `.js`, `.d.ts` and `.js.map` files, with the bins in `dist/cli/`), `README.md`, `LICENSE`, `THIRD-PARTY-NOTICES.md` and `package.json`, nothing else. Source maps contain source text and need the same disclosure review as source files. The pack check (C37/K1) in `pnpm test` has already installed that tarball offline and run both commands.
5. **Pull request.** Commit the changelog, the version bump and the regenerated `CLAIMS.md` as `Release X.Y.Z` and open a pull request. Its description names the `pnpm verify` run that passed. A maintainer approves and merges it.
6. **Tag.** On the merged commit of `main`: `git tag -a vX.Y.Z -m "X.Y.Z"` and `git push origin vX.Y.Z`. The tag and `package.json` must name the same version; the workflow checks and refuses otherwise.
7. **Approve the run.** The tag starts `release.yml`. It waits for a required reviewer of the `release` environment, then on an Ubuntu runner runs `pnpm install --frozen-lockfile`, typecheck, lint, test and build, and publishes:

   ```sh
   npm publish --provenance --access public
   ```

   A failed step publishes nothing: fix the cause on `main` through a pull request, delete the tag locally and on the remote, and tag again. `prepack` runs `pnpm build` first, so a stale `dist/` cannot ship. Nobody runs `npm publish` by hand for a release; provenance only comes from a CI job npm can verify. Never move or reuse a tag that did publish.
8. **Check npm.** Within a few minutes:
   - `npm view @centrst/blind@X.Y.Z version dependencies bin` shows the version, no dependencies, and the `blind` and `unblind` bins.
   - The package page on npmjs.com shows the provenance badge, linked to the tag's commit and the workflow run.
   - In an empty folder: `npm install @centrst/blind@X.Y.Z`, then `echo 'Pay 120,00 € to ana@example.example' | npx blind --seed check` prints a blind copy and a run id, and `node -e "import('@centrst/blind').then(m => console.log(typeof m.blind))"` prints `function`.
   - If something is wrong, deprecate the version with `npm deprecate @centrst/blind@X.Y.Z "<reason>"` and release a fix. Do not unpublish.

## The NER package

`@centrst/blind-ner` in `ner/` is a prototype. It is marked `private` and is not published with the core. Build it from source with `pnpm build` and `pnpm build:ner`. See [ner/README.md](ner/README.md) for model requirements and measured limits.

Publishing it requires its own review: model distribution and notices, a real peer dependency range for the core, package contents, an offline installation check, release notes and a distinct versioning procedure. Training source is available for reproducing research; training runs and model distribution are separate decisions.
