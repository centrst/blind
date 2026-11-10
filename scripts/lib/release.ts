import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CORE = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)`;
const STABLE = new RegExp(`^${CORE}$`);
const PACKAGE = new RegExp(`^${CORE}(?:-next\\.\\d{8}\\.[1-9]\\d*)?$`);
const ALREADY_PUBLISHED = 'The source version is already published. Merge a release PR that raises it first.';

export type Channel = 'next' | 'stable';

/** Where each package the release workflow publishes lives, by the value of its `package` input. */
const PACKAGE_DIRS: Record<string, string> = { blind: '.', 'blind-ner': 'ner' };

/** The directory of the package a release run publishes. No input means the core. */
export function packageDir(root: string, name = 'blind'): string {
  const dir = Object.hasOwn(PACKAGE_DIRS, name) ? PACKAGE_DIRS[name] : undefined;
  if (dir === undefined) throw new Error('Unknown release package.');
  return join(root, dir);
}

export function assertStableVersion(version: string): void {
  if (!STABLE.test(version)) throw new Error('The source version must be a stable X.Y.Z version.');
}

/** The versions this tooling writes: a stable X.Y.Z or a dated X.Y.Z-next.YYYYMMDD.N. */
export function assertPackageVersion(version: string): void {
  if (!PACKAGE.test(version)) throw new Error('Unsupported package version. Only X.Y.Z and X.Y.Z-next.YYYYMMDD.N are supported.');
}

/** The npm dist-tag each channel publishes to. */
export function releaseTag(channel: Channel): 'latest' | 'next' {
  return channel === 'stable' ? 'latest' : 'next';
}

/** True when `.changeset` holds a release note that no release PR has consumed yet. */
export function pendingChangesets(dir: string): boolean {
  return readdirSync(dir).some((name) => name.endsWith('.md') && name !== 'README.md');
}

/** True when a changelog written by hand has a heading for `version`, as the NER package's must before a stable release. */
export function changelogHas(file: string, version: string): boolean {
  return readFileSync(file, 'utf8').split('\n').some((line) => line === `## ${version}` || line.startsWith(`## ${version} `));
}

export interface ReleaseCheck {
  version: string;
  channel: string;
  event: string;
  ref: string;
  sha: string;
  verifiedSha?: string;
  /** The commit `origin/main` points at when the run starts. */
  mainSha: string;
  runAttempt: string;
  published: string[];
  /** Release notes are not ready: pending changesets for the core, no changelog heading for the NER package. */
  pendingNotes: boolean;
  /**
   * For the NER package only: the core in this tree is not the one on npm. Its version
   * is unpublished, or changesets are pending. The NER tarball names that version as
   * its peer and was tested against that source, so the core goes out first.
   */
  coreUnreleased?: boolean;
}

/**
 * Every condition a release run must meet before it builds anything. A run is a
 * manual dispatch from main, of the maintainer-verified commit, which must still
 * be main's head. Re-runs are refused so an old run cannot publish later.
 */
export function checkRelease(input: ReleaseCheck): Channel {
  assertStableVersion(input.version);
  if (input.channel !== 'next' && input.channel !== 'stable') throw new Error('Unknown release channel.');
  if (input.event !== 'workflow_dispatch') throw new Error('Releases run only by manual dispatch.');
  if (input.ref !== 'refs/heads/main') throw new Error('Dispatch releases from main.');
  if (!/^[a-f0-9]{40}$/.test(input.sha) || input.verifiedSha !== input.sha) {
    throw new Error('The verified commit must equal the full SHA selected by this run.');
  }
  if (input.mainSha !== input.sha) throw new Error('main has moved past the verified commit. Verify the new head and dispatch again.');
  if (input.runAttempt !== '1') throw new Error('Dispatch a new run instead of re-running the prepare job.');
  if (input.published.includes(input.version)) throw new Error(ALREADY_PUBLISHED);
  if (input.coreUnreleased) throw new Error('Release the core first. The NER package names the core version in this tree as its peer.');
  if (input.channel === 'stable' && input.pendingNotes) throw new Error('Merge the release PR before publishing a stable version.');
  return input.channel;
}

/** A date counter continues from all published versions, regardless of dist-tags. */
export function nextVersion(base: string, published: string[], date: Date): string {
  assertStableVersion(base);
  if (published.includes(base)) throw new Error(ALREADY_PUBLISHED);
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `${base}-next.${day}.`;
  const counters = published.map((v) => v.split('+')[0] as string)
    .filter((v) => v.startsWith(prefix))
    .map((v) => v.slice(prefix.length))
    .filter((v) => /^[1-9]\d*$/.test(v))
    .map(Number);
  const counter = Math.max(0, ...counters) + 1;
  if (!Number.isSafeInteger(counter)) throw new Error('The prerelease counter exceeds the supported range.');
  return `${prefix}${counter}`;
}

/** Versions already on the registry, or none when the package does not exist yet. */
export function publishedVersions(name: string, cwd: string): string[] {
  const r = spawnSync('npm', ['view', name, 'versions', '--json'], { cwd, encoding: 'utf8' });
  if (r.status === 0) {
    const parsed = JSON.parse(r.stdout) as string | string[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  if (/E404/.test(r.stderr + r.stdout)) return [];
  process.stderr.write(r.stderr);
  throw new Error('npm view failed');
}

/** Writes src/version.ts from package.json, so receipts name the package version. */
export function syncVersion(root: string): void {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  assertPackageVersion(pkg.version);
  writeFileSync(join(root, 'src', 'version.ts'),
    `/** The package version, kept equal to package.json by a build check. */\nexport const VERSION = '${pkg.version}';\n`);
}

/**
 * Sets the version of the package in `dir`, after checking it, so a bad value writes
 * nothing: package.json, and src/version.ts where the package has one (the core).
 */
export function setVersion(dir: string, version: string): void {
  assertPackageVersion(version);
  const file = join(dir, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version: string };
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  if (existsSync(join(dir, 'src', 'version.ts'))) syncVersion(dir);
}
