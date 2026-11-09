/**
 * pnpm bench:paranoid: how the paranoid sweep does on a dataset blind was not tuned on.
 *
 * Reads reports/gretel-input.json (the first step of `pnpm bench:gretel` writes it), or the
 * file after --input in the same shape. Runs blind bare with `paranoid: true` on every file
 * and prints:
 *   - survivors: labelled values, dates, times and amounts aside, that still show in the
 *     blind text (`containsWord`, the scorer's rule), and how many of them a suspect overlaps
 *   - held: files whose report fails, so a reviewer sees them
 *   - falseAlarms: suspects that overlap no label. Gretel's labels are not complete, so some
 *     of these are private values the labels missed
 * No value is printed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blind } from '../../src/index.js';
import { containsWord, FIXED_NOW, ROOT } from '../../test/support/corpus.js';

interface InputFile {
  name: string;
  text: string;
  spans: Array<{ start: number; end: number; label: string }>;
}

const at = process.argv.indexOf('--input');
const input = at > 0 ? (process.argv[at + 1] as string) : join(ROOT, 'reports', 'gretel-input.json');
const { files } = JSON.parse(readFileSync(input, 'utf8')) as { files: InputFile[] };

let held = 0;
let survivors = 0;
let flagged = 0;
let falseAlarms = 0;
for (const f of files) {
  const res = blind([f.text], { seed: f.name, now: FIXED_NOW, paranoid: true });
  const out = res.texts[0] as string;
  const suspects = res.leaks.suspects ?? [];
  if (!res.leaks.ok) held++;
  for (const a of f.spans) {
    if (/date|time|amount/.test(a.label) || !containsWord(out, f.text.slice(a.start, a.end))) continue;
    survivors++;
    if (suspects.some((s) => s.start < a.end && a.start < s.end)) flagged++;
  }
  falseAlarms += suspects.filter((s) => !f.spans.some((a) => s.start < a.end && a.start < s.end)).length;
}
const pct = (n: number, d: number): string => `${d ? ((100 * n) / d).toFixed(1) : '0.0'}%`;
console.log(`files ${files.length}, held ${held} (${pct(held, files.length)})`);
console.log(`survivors ${survivors}, flagged ${flagged} (${pct(flagged, survivors)})`);
console.log(`false alarms ${falseAlarms}, ${(falseAlarms / Math.max(1, files.length)).toFixed(1)} per file`);
