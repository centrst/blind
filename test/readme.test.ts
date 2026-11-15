import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';
import { withExamples, withSpanishExample } from './support/readme-example.js';

describe('README examples', () => {
  it('show what the code does: every marked example equals blind output for the same input and seed', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect((readme.match(/<!-- example:\w+ -->/g) ?? []).length).toBe(4);
    expect(readme, 'run `pnpm readme:example` to refresh them').toBe(withExamples(readme));
  });

  it('show what the code does on the Spanish page too', () => {
    const doc = readFileSync(join(ROOT, 'docs', 'languages', 'spanish.md'), 'utf8');
    expect((doc.match(/<!-- example:spanish -->/g) ?? []).length).toBe(1);
    expect(doc, 'run `pnpm readme:example` to refresh it').toBe(withSpanishExample(doc));
  });
});

describe('what the docs say the leak check covers', () => {
  // Pinned word for word: an edit that widens either sentence has to change this test too.
  const LEAKS_OK = "| `leaksOk` | The leak check result for what was sent: true when the leak check found no hit; a `known` entry the check enforces only as written or in capitals, or a two-syllable Korean one only where a word starts, is listed in the response's `unenforced` and does not change it. It says nothing about a private value that nothing found and nobody listed. |";
  const RECEIPT_OK = "true when the leak check found no hit; a `known` entry the check enforces only as written or in capitals, or a two-syllable Korean one only where a word starts, is listed in the response's `unenforced` and does not change it.";
  const README_CHECK = 'The check covers the values blind found and the ones it was given in `known` and `deny`, not every private value: one that nothing found and nobody listed is neither replaced nor reported.';

  it('B3: docs/PROXY.md describes leaksOk as covering only found, known and deny values', () => {
    expect(readFileSync(join(ROOT, 'docs', 'PROXY.md'), 'utf8').split('\n')).toContain(LEAKS_OK);
  });

  it('B3: the README describes the leak check as covering only found, known and deny values', () => {
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain(README_CHECK);
  });

  it('B3: the receipt type describes leaksOk the way docs/PROXY.md does, with unenforced entries left out of it', () => {
    const src = readFileSync(join(ROOT, 'src', 'receipt.ts'), 'utf8');
    const doc = /\/\*\*((?:(?!\*\/)[\s\S])*)\*\/\s*leaksOk:/.exec(src)?.[1] ?? '';
    expect(doc.replace(/\n\s*\*\s?/g, ' ').replace(/\s+/g, ' ')).toContain(RECEIPT_OK);
  });

  it('B3: the README says assertNoLeaks throws on hits only and an unenforced entry does not make it throw', () => {
    expect(readFileSync(join(ROOT, 'README.md'), 'utf8')).toContain('`assertNoLeaks(result)` throws `LeakError` when `result.leaks` has hits. A `known` entry the check enforces only as written or in capitals, or a two-syllable Korean one only where a word starts, is listed in `leaks.unenforced` and does not make it throw.');
  });
});

describe('what the docs say about the NER package status', () => {
  // The repository's own wording, in the forms README.md and ner/README.md use it.
  const STATUS = /prototype[^.]*?built from this repository,?(?: and is)? not on npm/i;
  const NAMES_NER = /gliner|@centrst\/blind-ner/i;
  // Files that report numbers measured with @centrst/blind-ner.
  const REPORTS = [
    'TESTING.md',
    'docs/BROWSER-NER.md',
    'docs/languages/spanish.md',
    'ner/CANDIDATES.md',
    'ner/README.md',
    'ner/TRAINED.md',
    'scripts/bench/RESULTS-llmguard-gretel.md',
    'scripts/bench/RESULTS.md',
  ];
  // Files that name the package or the model but report no number measured with it.
  const NAMES_ONLY = [
    'AGENTS.md', // commands and layout
    'CHANGELOG.md', // the Detector interface entry
    'CLAIMS.md', // generated from TESTING.md claim rows, which carry the status
    'CONTRIBUTING.md', // the ner:download command
    'RELEASING.md', // states the prototype status in its own words
    'THIRD-PARTY-NOTICES.md', // model licence
    'corpus/adversarial/known-misses.md', // generated from adversarial case reasons
    'ner/CHANGELOG.md', // what the package holds
    'ner/THIRD-PARTY-NOTICES.md', // model and library licences
  ];
  const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
  const tracked = execFileSync('git', ['ls-files', '-z', '--', '*.md'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '' && existsSync(join(ROOT, path)));

  it('B3: every Markdown file naming GLiNER or @centrst/blind-ner is classed as a report or as naming it only', () => {
    const naming = tracked.filter((path) => NAMES_NER.test(read(path)));
    expect(naming.filter((path) => !REPORTS.includes(path) && !NAMES_ONLY.includes(path)), 'add a new file to REPORTS or NAMES_ONLY').toEqual([]);
    expect(REPORTS.filter((path) => !naming.includes(path))).toEqual([]);
  });

  it('B3: every Markdown file reporting NER numbers says the package is a prototype built from this repository, not on npm', () => {
    expect(REPORTS.filter((path) => !STATUS.test(read(path)))).toEqual([]);
  });

  it('B3: every table with a GLiNER row or column and a number in it has the status note in the paragraph just before or after it', () => {
    const NUMBER = /^\s*\d[\d.,]*\s*(?:%|ms|MB|GB|MiB)?\s*(?:\([^)]*\))?\s*$|^\s*\d+ \/ \d+\s*$/;
    const missing: string[] = [];
    for (const path of REPORTS) {
      const lines = read(path).split('\n');
      const isRow = (i: number) => lines[i]?.startsWith('|') ?? false;
      const paragraph = (from: number, step: number) => {
        let i = from;
        while (lines[i] !== undefined && lines[i]!.trim() === '') i += step;
        const out: string[] = [];
        while (lines[i] !== undefined && lines[i]!.trim() !== '' && !isRow(i)) {
          out.push(lines[i]!);
          i += step;
        }
        return out.join(' ');
      };
      for (let start = 0; start < lines.length; start++) {
        if (!isRow(start)) continue;
        let end = start;
        while (isRow(end + 1)) end++;
        const rows = lines.slice(start, end + 1);
        const numeric = rows.some((row) => row.split('|').some((cell) => cell.trim() !== '' && NUMBER.test(cell)));
        if (numeric && NAMES_NER.test(rows.join('\n')) && !STATUS.test(paragraph(start - 1, -1)) && !STATUS.test(paragraph(end + 1, 1))) {
          missing.push(`${path}:${start + 1}`);
        }
        start = end;
      }
    }
    expect(missing).toEqual([]);
  });
});
