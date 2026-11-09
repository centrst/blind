/**
 * pnpm publish:next [--dry-run]: publishes the working tree to npm as a throwaway
 * prerelease on the `next` dist-tag, for example 0.1.0-next.20261109.2, and
 * leaves the repository at its real version. Nothing here touches `latest`, so
 * `npm install @centrst/blind` keeps resolving to the last real release while
 * `npm install @centrst/blind@next` gets the newest build.
 *
 * The version is the package.json version, `-next.`, today's UTC date and a
 * counter that continues from what the registry already has for that date.
 * package.json and src/version.ts carry the prerelease version while npm packs
 * and builds, then come back from git, so both must be clean to start.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../test/support/corpus.js';

const dryRun = process.argv.includes('--dry-run');
const pkgPath = join(ROOT, 'package.json');
const versionPath = join(ROOT, 'src', 'version.ts');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name: string; version: string };

function run(cmd: string, args: string[], capture = false): string {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    if (capture) process.stderr.write(r.stderr);
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`);
  }
  return r.stdout ?? '';
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (pkg.version.includes('-')) fail(`package.json is already at a prerelease version (${pkg.version}). Set it to the next real version first.`);

const dirty = run('git', ['status', '--porcelain', '--', 'package.json', 'src/version.ts'], true).trim();
if (dirty) fail(`package.json or src/version.ts has uncommitted changes. Commit or revert them first, the script restores both files from git when it is done.\n${dirty}`);

/** Versions already on the registry, or none when the package does not exist yet. */
function publishedVersions(): string[] {
  const r = spawnSync('npm', ['view', pkg.name, 'versions', '--json'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) {
    const parsed = JSON.parse(r.stdout) as string | string[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  if (/E404/.test(r.stderr + r.stdout)) return [];
  process.stderr.write(r.stderr);
  throw new Error('npm view failed');
}

const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
const prefix = `${pkg.version}-next.${today}.`;
const taken = publishedVersions()
  .filter((v) => v.startsWith(prefix))
  .map((v) => Number(v.slice(prefix.length)))
  .filter((n) => Number.isInteger(n));
const version = `${prefix}${taken.length ? Math.max(...taken) + 1 : 1}`;
const sha = run('git', ['rev-parse', '--short', 'HEAD'], true).trim();

const originalPkg = readFileSync(pkgPath, 'utf8');
const originalVersion = readFileSync(versionPath, 'utf8');
if (!originalVersion.includes(`'${pkg.version}'`)) fail(`src/version.ts does not name ${pkg.version}; the build check C19/B2 would fail too.`);

console.log(`${dryRun ? 'dry run of' : 'publishing'} ${pkg.name}@${version} from ${sha}${dryRun ? '' : ' to the next tag'}`);
try {
  writeFileSync(pkgPath, originalPkg.replace(`"version": "${pkg.version}"`, `"version": "${version}"`));
  writeFileSync(versionPath, originalVersion.replace(`'${pkg.version}'`, `'${version}'`));
  // prepack runs pnpm build, so dist carries the prerelease version in VERSION and receipts.
  run('npm', ['publish', '--tag', 'next', ...(dryRun ? ['--dry-run'] : [])]);
} finally {
  writeFileSync(pkgPath, originalPkg);
  writeFileSync(versionPath, originalVersion);
}

if (!dryRun) console.log(`\ninstall it with: npm install ${pkg.name}@${version}\nor follow the lane: npm install ${pkg.name}@next`);
