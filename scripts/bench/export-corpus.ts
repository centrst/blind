/**
 * Step 1 of `pnpm bench:presidio`: write the stripped corpus to reports/presidio-input.json
 * so the Python step sees exactly the text `pnpm corpus` scores.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCorpus, ROOT } from '../../test/support/corpus.js';

const files = loadCorpus().map((f) => ({ name: f.name, lang: f.lang, text: f.parsed.text }));
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(join(ROOT, 'reports', 'presidio-input.json'), `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`wrote reports/presidio-input.json, ${files.length} files`);
