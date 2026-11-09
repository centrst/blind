import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function assertStableVersion(version: string): void {
  if (!STABLE.test(version)) throw new Error('The source version must be a stable X.Y.Z version.');
}

export function checkRelease(input: {
  version: string; channel: string; event: string; ref: string; sha: string; verifiedSha?: string;
}): void {
  assertStableVersion(input.version);
  if (input.channel !== 'next' && input.channel !== 'stable') throw new Error('Unknown release channel.');
  if (input.event === 'workflow_dispatch') {
    if (input.ref !== 'refs/heads/main') throw new Error('Dispatch releases from main.');
    if (!/^[a-f0-9]{40}$/.test(input.sha) || input.verifiedSha !== input.sha) {
      throw new Error('The verified commit must equal the full SHA selected by this run.');
    }
  } else if (input.event !== 'push' || input.channel !== 'stable' || input.ref !== `refs/tags/v${input.version}`) {
    throw new Error('A stable release tag must match the source version.');
  }
}

/** A date counter continues from all published versions, regardless of dist-tags. */
export function nextVersion(base: string, published: string[], date: Date): string {
  assertStableVersion(base);
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  const prefix = `${base}-next.${day}.`;
  const counters = published.filter((v) => v.startsWith(prefix))
    .map((v) => v.slice(prefix.length))
    .filter((v) => /^[1-9]\d*$/.test(v))
    .map(Number);
  const counter = Math.max(0, ...counters) + 1;
  if (!Number.isSafeInteger(counter)) throw new Error('The prerelease counter exceeds the supported range.');
  return `${prefix}${counter}`;
}

/** The core stays independent of package.json and Node at runtime. */
export function syncVersion(root: string): void {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-next\.\d{8}\.[1-9]\d*)?$/.test(pkg.version)) {
    throw new Error('Unsupported package version.');
  }
  writeFileSync(join(root, 'src', 'version.ts'),
    `/** The package version, kept equal to package.json by a build check. */\nexport const VERSION = '${pkg.version}';\n`);
}

export function setVersion(root: string, version: string): void {
  const file = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version: string };
  pkg.version = version;
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  syncVersion(root);
}
