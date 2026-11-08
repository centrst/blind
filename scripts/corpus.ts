/**
 * pnpm corpus: score the labeled corpus, write reports/corpus.json, compare to floors.
 * `--init` writes corpus/floors.json from this run (floors only ever go up).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { belowFloors, CORPUS_DIR, floorsFrom, loadCorpus, loadFloors, ROOT, SCORED_KINDS, scoreCorpus, type Floors, type Scorecard } from '../test/support/corpus.js';

const files = loadCorpus();
const cards = { bare: scoreCorpus(files, 'bare'), known: scoreCorpus(files, 'known') };

const show = (c: Scorecard): void => {
  console.log(`\n${c.mode} mode, ${c.files} files, round trip ${c.roundTrip.ok}/${c.roundTrip.total}`);
  console.log('kind     annotated  recall  replaced  precision  values-left  coverage');
  for (const k of SCORED_KINDS) {
    const s = c.perKind[k];
    console.log(`${k.padEnd(8)} ${String(s.annotated).padStart(9)} ${String(s.recall).padStart(6)}% ${String(s.replaced).padStart(9)} ${String(s.precision).padStart(8)}% ${String(s.survivors).padStart(10)} ${String(s.coverage).padStart(10)}%`);
  }
  console.log(`leak check flagged ${c.safetyNet.flagged}/${c.safetyNet.filesWithMisses} files with misses, ${c.safetyNet.falseAlarms} false alarms`);
};
show(cards.bare);
show(cards.known);

mkdirSync(join(ROOT, 'reports'), { recursive: true });
const prev = loadFloors();
if (process.argv.includes('--init')) {
  const next: Floors = { bare: floorsFrom(cards.bare, prev?.bare), known: floorsFrom(cards.known, prev?.known) };
  writeFileSync(join(CORPUS_DIR, 'floors.json'), `${JSON.stringify(next, null, 2)}\n`);
  console.log('\nwrote corpus/floors.json');
}
const floors = loadFloors();
const failures = floors ? [...belowFloors(cards.bare, floors.bare), ...belowFloors(cards.known, floors.known)] : ['corpus/floors.json is missing'];
writeFileSync(join(ROOT, 'reports', 'corpus.json'), `${JSON.stringify({ floors, cards, failures, generatedAt: new Date().toISOString() }, null, 2)}\n`);
if (failures.length) {
  console.error(`\nbelow floor:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nall kinds at or above their floors');
