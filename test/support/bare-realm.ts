/**
 * Runs the built library in a fresh V8 realm that has the language built-ins,
 * Web Crypto, TextEncoder, atob and btoa, and nothing from Node: no require,
 * process, Buffer or built-in modules. A child process is used because vm
 * modules need a flag.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const RUNNER = join(import.meta.dirname, 'bare-realm-runner.mjs');

export async function runInBareRealm(entry: string, body: string): Promise<unknown> {
  const out = execFileSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', RUNNER, entry, body], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out) as unknown;
}
