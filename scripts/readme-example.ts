/** pnpm readme:example: rewrite the generated examples in README.md and docs/languages/spanish.md from the current code. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../test/support/corpus.js';
import { withExamples, withSpanishExample } from '../test/support/readme-example.js';

for (const [file, rewrite] of [
  ['README.md', withExamples],
  [join('docs', 'languages', 'spanish.md'), withSpanishExample],
] as const) {
  const path = join(ROOT, file);
  const before = readFileSync(path, 'utf8');
  const after = rewrite(before);
  writeFileSync(path, after);
  console.log(before === after ? `${file} examples already current.` : `${file} examples rewritten.`);
}
