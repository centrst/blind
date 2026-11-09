/**
 * The release workflow's first check. Fails before anything is built when the run
 * is not a fresh dispatch of the verified main head, when the version is already on
 * npm, or when a stable release still has pending changesets. Writes the version and
 * the dist-tag to GITHUB_OUTPUT.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRelease, pendingChangesets, publishedVersions, releaseTag } from './lib/release.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
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
  pendingNotes: pendingChangesets(join(ROOT, '.changeset')),
});
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${pkg.version}\ntag=${releaseTag(channel)}\n`);
}
