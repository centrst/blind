import { execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Picks one property-test seed for the whole run and builds dist once for the CLI and build suites. */
export default function setup(): void {
  const seed = process.env.SEED ?? String(randomInt(2 ** 31));
  process.env.SEED = seed;
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports', 'seed.txt'), `${seed}\n`);
  if (!process.env.SKIP_BUILD) {
    execFileSync(join(root, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' });
  }
}
