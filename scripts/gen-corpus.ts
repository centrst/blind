/**
 * Deterministic corpus generator. Same script, same files, every time.
 * Usage: tsx scripts/gen-corpus.ts [count]
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CorpusRng } from '../test/support/corpus-rng.js';
import { CATEGORIES, genEmail, type LangMode } from '../test/support/templates.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'corpus', 'generated');
const count = Number(process.argv[2] ?? 336);
const MODES: LangMode[] = ['en', 'es', 'es', 'mixed', 'en', 'es', 'mixed'];

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith('.txt')) rmSync(join(out, f));

for (let i = 0; i < count; i++) {
  const category = CATEGORIES[i % CATEGORIES.length]!;
  const mode = MODES[Math.floor(i / CATEGORIES.length) % MODES.length]!;
  const rng = new CorpusRng(`corpus-v1-${i}`);
  const body = genEmail(rng, category, mode);
  const name = `${String(i + 1).padStart(3, '0')}-${category}-${mode}.txt`;
  writeFileSync(join(out, name), body);
}
console.log(`wrote ${count} files to corpus/generated`);
