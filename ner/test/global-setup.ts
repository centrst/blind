import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Builds the core and then this package once, for the pack check. SKIP_BUILD=1 trusts the two dist folders already there. */
export default function setup(): void {
  if (process.env.SKIP_BUILD) return;
  const tsc = join(root, 'node_modules', '.bin', 'tsc');
  // The package build reads the core's types from the core's dist.
  for (const project of ['tsconfig.build.json', join('ner', 'tsconfig.build.json')]) {
    execFileSync(tsc, ['-p', project], { cwd: root, stdio: 'inherit' });
  }
}
