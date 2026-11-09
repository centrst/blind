import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { checkRelease } from './lib/release.js';

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
const channel = process.env.CHANNEL ?? '';
checkRelease({
  version,
  channel,
  event: process.env.GITHUB_EVENT_NAME ?? '',
  ref: process.env.GITHUB_REF ?? '',
  sha: process.env.GITHUB_SHA ?? '',
  verifiedSha: process.env.VERIFIED_SHA,
});
if (channel === 'stable' && readdirSync('.changeset').some((name) => name.endsWith('.md') && name !== 'README.md')) {
  throw new Error('Merge the release PR before publishing a stable version.');
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${channel === 'stable' ? 'latest' : 'next'}\n`);
}
