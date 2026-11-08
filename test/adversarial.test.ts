import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderKnownMisses } from '../scripts/known-misses.js';
import { ADV_DIR, loadAdversarial, runCase } from './support/adversarial.js';

const files = loadAdversarial();
const all = files.flatMap((f) => f.cases.map((c) => ({ ...c, category: f.category })));

const CATEGORIES = ['obfuscated', 'unicode', 'splits', 'encodings', 'words', 'context', 'case', 'formats'];

describe('adversarial set shape', () => {
  it('has every category from TESTING.md section 3', () => {
    for (const c of CATEGORIES) expect(files.map((f) => f.category), c).toContain(c);
  });

  it('has unique case ids', () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });

  it('gives every known miss a reason', () => {
    for (const c of all.filter((x) => x.expect === 'silent')) expect(c.why, c.id).toBeTruthy();
  });
});

describe('adversarial cases', () => {
  for (const c of all) {
    // A round-trip case that is caught backs the round trip itself.
    const claim = c.category === 'case' ? 'C3/A-case' : c.check === 'roundtrip' && c.expect !== 'silent' ? 'C1/A-roundtrip' : 'C10';
    const title = `${claim}: ${c.id} ${c.title}`;
    if (c.expect === 'silent') {
      // A known miss. The test states what we want and is expected to fail, so a fix shows up as a failure here.
      it.fails(title, () => {
        expect(runCase(c).outcome).not.toBe('silent');
      });
    } else {
      it(title, () => {
        const { outcome, out } = runCase(c);
        expect(outcome, `blind text: ${JSON.stringify(out)}`).toBe(c.expect);
      });
    }
  }
});

describe('known-misses.md', () => {
  it('C10: lists every silent miss and matches the case files', () => {
    const onDisk = readFileSync(join(ADV_DIR, 'known-misses.md'), 'utf8');
    expect(onDisk, 'run `pnpm known-misses` to refresh it').toBe(renderKnownMisses());
    for (const c of all.filter((x) => x.expect === 'silent')) expect(onDisk).toContain(`| ${c.id} |`);
  });
});
