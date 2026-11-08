/** Writes corpus/adversarial/known-misses.md from the case files. Run: pnpm known-misses */
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADV_DIR, loadAdversarial } from '../test/support/adversarial.js';

export function renderKnownMisses(): string {
  const rows: string[] = [];
  let caught = 0;
  for (const f of loadAdversarial()) {
    for (const c of f.cases) {
      if (c.expect !== 'silent') {
        caught++;
        continue;
      }
      const input = JSON.stringify(c.text).replace(/\|/g, '\\|');
      rows.push(`| ${c.id} | ${f.category} | \`${input}\` | ${(c.why ?? '').replace(/\|/g, '\\|')} |`);
    }
  }
  return [
    '# Known misses',
    '',
    'Generated from `corpus/adversarial/*.json` by `pnpm known-misses`. Do not edit by hand.',
    '',
    `${rows.length} inputs slip through silently. ${caught} more in the same set are caught, either replaced or reported by the leak check. Each miss below has a test marked expected-to-fail, so the build notices the day one starts working and this list gets shorter.`,
    '',
    'A miss is silent when the value stays in the blind text and the leak check has nothing recorded to look for. When the leak check can see the value it reports it and the CLI exits 2, which counts as caught.',
    '',
    '| ID | Category | Input | What slips and why |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(join(ADV_DIR, 'known-misses.md'), renderKnownMisses());
  console.log('wrote corpus/adversarial/known-misses.md');
}
