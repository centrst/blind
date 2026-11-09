/**
 * pnpm publish:next --dry-run | --prepare: a dated prerelease version.
 *
 * --dry-run packs the prerelease locally with `npm publish --dry-run`, so you can see
 * the version and the tarball, then restores package.json and src/version.ts from
 * copies taken first. dist keeps the prerelease build until the next `pnpm build`.
 * --prepare is for the release workflow only. It leaves the version in place for the
 * gate and the pack step, and writes it to GITHUB_OUTPUT. Publishing happens only in
 * the release workflow, never from this script.
 *
 * The version is the package.json version, `-next.`, today's UTC date and a counter
 * that continues from what the registry already has for that date. Both files must
 * be clean to start.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextVersion, publishedVersions, setVersion } from './lib/release.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const prepare = args.includes('--prepare');
const pkgPath = join(ROOT, 'package.json');
const versionPath = join(ROOT, 'src', 'version.ts');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string };

function run(cmd: string, cmdArgs: string[], capture = false): string {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (capture) process.stderr.write(r.stderr);
    throw new Error(`${cmd} ${cmdArgs.join(' ')} exited with ${r.status}`);
  }
  return r.stdout ?? '';
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (args.some((arg) => arg !== '--dry-run' && arg !== '--prepare')) fail('Unknown publish:next argument.');
if (dryRun === prepare) fail('Pass --dry-run to inspect a prerelease locally. Publishing uses the Release workflow in RELEASING.md.');
if (prepare && process.env.GITHUB_ACTIONS !== 'true') fail('--prepare is for the release workflow. Use --dry-run locally.');
if (pkg.version.includes('-')) fail(`package.json is already at a prerelease version (${pkg.version}). Set it to the next real version first.`);

const dirty = run('git', ['status', '--porcelain', '--', 'package.json', 'src/version.ts'], true).trim();
if (dirty) fail(`package.json or src/version.ts has uncommitted changes. Commit or revert them first.\n${dirty}`);

const version = nextVersion(pkg.version, publishedVersions(pkg.name, ROOT), new Date());
const sha = run('git', ['rev-parse', '--short', 'HEAD'], true).trim();

const originalPkg = readFileSync(pkgPath, 'utf8');
const originalVersion = readFileSync(versionPath, 'utf8');
if (!originalVersion.includes(`'${pkg.version}'`)) fail(`src/version.ts does not name ${pkg.version}; the build check C19/B2 would fail too.`);

console.log(`${prepare ? 'preparing' : 'dry run of'} ${pkg.name}@${version} from ${sha}`);
if (prepare) {
  setVersion(ROOT, version);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  process.exit(0);
}

function restore(): void {
  writeFileSync(pkgPath, originalPkg);
  writeFileSync(versionPath, originalVersion);
}
const onSignal = (signal: NodeJS.Signals) => {
  restore();
  process.exit(signal === 'SIGINT' ? 130 : 143);
};
process.once('SIGINT', onSignal);
process.once('SIGTERM', onSignal);
try {
  setVersion(ROOT, version);
  // prepack runs pnpm build, so dist carries the prerelease version in VERSION and receipts.
  run('npm', ['publish', '--tag', 'next', '--dry-run']);
} finally {
  restore();
}
