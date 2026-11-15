/**
 * The release workflow's first check, for the package RELEASE_PACKAGE names (the
 * core when unset). Fails before anything is built when the run is not a fresh
 * dispatch of the verified main head, when the version is already on npm, or when
 * a stable release has no release notes yet: pending changesets for the core, no
 * heading for the version in ner/CHANGELOG.md for the NER package. The NER package
 * is also refused on either channel while the core in this tree is not the one on
 * npm, since its tarball names that core version as its peer. Writes the package
 * name, the version and the dist-tag to GITHUB_OUTPUT.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogHas, checkRelease, packageDir, pendingChangesets, publishedVersions, releaseTag } from './lib/release.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = packageDir(ROOT, process.env.RELEASE_PACKAGE || undefined);
const core = dir === packageDir(ROOT);
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string };
const pendingCore = pendingChangesets(join(ROOT, '.changeset'));
const corePkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
const main = spawnSync('git', ['rev-parse', 'origin/main'], { cwd: ROOT, encoding: 'utf8' });
if (main.status !== 0) throw new Error('Could not read origin/main. The checkout needs the main branch history.');

const channel = checkRelease({
  version: pkg.version,
  channel: process.env.CHANNEL ?? '',
  event: process.env.GITHUB_EVENT_NAME ?? '',
  ref: process.env.GITHUB_REF ?? '',
  sha: process.env.GITHUB_SHA ?? '',
  verifiedSha: process.env.VERIFIED_SHA,
  mainSha: main.stdout.trim(),
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '',
  published: publishedVersions(pkg.name, ROOT),
  pendingNotes: core ? pendingCore : !changelogHas(join(dir, 'CHANGELOG.md'), pkg.version),
  coreUnreleased: !core && (pendingCore || !publishedVersions(corePkg.name, ROOT).includes(corePkg.version)),
});
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `name=${pkg.name}\nversion=${pkg.version}\ntag=${releaseTag(channel)}\n`);
}
