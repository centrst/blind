// Time of `blind` against the size of `known`. Each size and text runs in a
// fresh process, so the first call pays every pattern compile, as an app's
// first call does. Prints the first call and the best of two more, in ms.
// The optional argument is a module path relative to this script, to measure a
// saved baseline build.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';

const [arg, child, nArg, which] = process.argv.slice(2);

if (child !== 'child') {
  const self = fileURLToPath(import.meta.url);
  const dist = arg ?? '../../dist/index.js';
  console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, statistic: 'wall ms: first call in a fresh process, then best of two' }));
  for (const text of ['short', 'long']) {
    for (const n of [0, 1000, 4000, 10000]) {
      const r = spawnSync(process.execPath, [self, dist, 'child', String(n), text], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(r.stderr);
      process.stdout.write(r.stdout);
    }
  }
} else {
  const { blind } = await import(arg);
  let text = 'Hello Marta42 Vandermeer42, see you.';
  if (which === 'long') {
    // Generated corpus texts without their annotations, one after another, cut to 200 KB.
    const dir = new URL('../../corpus/generated/', import.meta.url);
    const parts = readdirSync(dir).filter((f) => f.endsWith('.txt')).sort().map((f) =>
      readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.startsWith('%')).join('\n').replace(/\{\{[a-z]+:([^}]*)\}\}/g, '$1'));
    text = '';
    for (let i = 0; text.length < 200 * 1024; i++) text += `${parts[i % parts.length]}\n\n`;
    text = text.slice(0, 200 * 1024);
  }
  const n = Number(nArg);
  const known = Array.from({ length: n }, (_, i) => ({ kind: 'person', value: `Marta${i} Vandermeer${i}` }));
  const ms = (fn) => {
    const t = performance.now();
    fn();
    return performance.now() - t;
  };
  const opts = { known, seed: 'known-list' };
  const first = ms(() => blind([text], opts));
  const again = Math.min(ms(() => blind([text], opts)), ms(() => blind([text], opts)));
  console.log(JSON.stringify({ text: which, known: n, first: Math.round(first), again: Math.round(again) }));
}
