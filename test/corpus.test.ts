import { describe, expect, it } from 'vitest';
import { blind, unblind } from '../src/index.js';
import {
  belowFloors, containsWord, FIXED_NOW, loadCorpus, loadFloors, lintCorpusText, resolvedSpans, scoreCorpus, survives,
} from './support/corpus.js';
import { loadAdversarial } from './support/adversarial.js';
import { parseAnnotated } from './support/annotate.js';
import { foldLookalikes } from '../src/fold.js';
import { CATEGORIES } from './support/templates.js';

const files = loadCorpus();

describe('corpus shape', () => {
  it('has at least 300 generated and 40 handwritten emails', () => {
    expect(files.filter((f) => f.group === 'generated').length).toBeGreaterThanOrEqual(300);
    expect(files.filter((f) => f.group === 'handwritten').length).toBeGreaterThanOrEqual(40);
  });

  it('covers every category in English, Spanish and mixed', () => {
    for (const c of CATEGORIES) {
      expect(files.filter((f) => f.category === c).length, c).toBeGreaterThanOrEqual(5);
    }
    for (const l of ['en', 'es', 'mixed']) expect(files.filter((f) => f.lang === l).length, l).toBeGreaterThanOrEqual(20);
  });

  it('keeps every annotation well formed', () => {
    for (const f of files) {
      for (const sp of f.parsed.spans) {
        expect(f.parsed.text.slice(sp.start, sp.end), f.name).toBe(sp.value);
        expect(sp.value.trim(), f.name).not.toBe('');
      }
      expect(f.parsed.text, f.name).not.toMatch(/\{\{|\}\}/);
    }
  });
});

describe('corpus lint', () => {
  it('passes for every corpus file', () => {
    for (const f of files) expect(lintCorpusText(f.source), f.name).toEqual([]);
  });

  it('passes for every adversarial case, read with look-alikes folded and line breaks as spaces', () => {
    // Read the way the detectors read it, so a phone split over two lines is linted whole and the tail of an IBAN
    // spelled with a Cyrillic letter is read as part of the IBAN, not as a phone of its own.
    const cases = loadAdversarial().flatMap((f) => f.cases);
    expect(cases.length).toBeGreaterThan(50);
    for (const c of cases) expect(lintCorpusText(foldLookalikes(c.text).replace(/\n/g, ' ')), c.id).toEqual([]);
  });

  it('refuses private domains that are not .example', () => {
    expect(lintCorpusText('mail ana@rejected-mail.invalid now')).toHaveLength(1);
    expect(lintCorpusText('see https://www.rejected-link.invalid/citas')).toHaveLength(1);
    expect(lintCorpusText('ana@gestoria.example and ana_ruiz@gmail.com and https://booksy.com/x')).toEqual([]);
  });

  it('refuses a mailbox at a public provider that someone could own', () => {
    // Both local parts are over Gmail's 30-character limit, so no one holds them, but the lint, which knows only the
    // underscore and dash rule, still refuses them: a local part of letters at Gmail is what a real mailbox looks like.
    expect(lintCorpusText('Escribe a anabelenquintanarebollodelasierraruiz@gmail.com')).toHaveLength(1);
    // Gmail ignores dots, so a doubled one there could still reach a real mailbox.
    expect(lintCorpusText('Escribe a anabelenquintanarebollodelasierra..ruiz@gmail.com')).toHaveLength(1);
    expect(lintCorpusText('Escribe a ana_ruiz@gmail.com, ana-ruiz%40gmail.com, ana..ruiz@outlook.com o no..reply@booksy.com')).toEqual([]);
  });

  it('refuses a phone outside the reserved and unallocated ranges', () => {
    expect(lintCorpusText('Llama al +34 612 345 678')).toHaveLength(1);
    expect(lintCorpusText('Call (415) 555-0234 or +44 7911 123456')).toHaveLength(2);
    expect(lintCorpusText('Llama al +34 791 345 678, 0034 755 12 34 56 o al 781 22 33 44')).toEqual([]);
    expect(lintCorpusText('Call (415) 555-0134, +1 212 555 0199, +44 7700 900123, 020 7946 0321 or +49 171 392 0012')).toEqual([]);
  });
});

describe('corpus evidence', () => {
  it('C1/corpus: every file unblinds back to its stripped original', () => {
    for (const mode of ['bare', 'known'] as const) {
      for (const f of files) {
        const res = blind([f.parsed.text], { known: mode === 'known' ? f.parsed.known : [], seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder });
        expect(unblind(res.texts[0] as string, res.mapping).text, `${mode} ${f.name}`).toBe(f.parsed.text);
      }
    }
  });

  it('C2/corpus: a detected value never survives silently, and structured kinds never survive', () => {
    for (const f of files) {
      const { text, known, dateOrder } = f.parsed;
      const res = blind([text], { known, seed: f.name, now: FIXED_NOW, dateOrder });
      const out = res.texts[0] as string;
      const fakes = new Set(res.mapping.pairs.map((p) => p.fake.toLowerCase()));
      for (const s of resolvedSpans(text, known, dateOrder)) {
        const value = text.slice(s.start, s.end);
        if (fakes.has(value.toLowerCase())) continue; // a fake that equals another real value
        if (!survives(s.kind, value, out)) continue;
        expect(res.leaks.ok, `${f.name}: ${s.kind} survived but the leak check passed`).toBe(false);
        if (!['person', 'org', 'place', 'domain'].includes(s.kind)) {
          expect.fail(`${f.name}: a detected ${s.kind} survived in the blind text`);
        }
      }
    }
  });

  it('C9: recall and precision stay at or above the published floors', () => {
    const floors = loadFloors();
    expect(floors, 'corpus/floors.json').not.toBeNull();
    expect(belowFloors(scoreCorpus(files, 'bare'), floors!.bare)).toEqual([]);
    expect(belowFloors(scoreCorpus(files, 'known'), floors!.known)).toEqual([]);
  });

  it('C9: recall counts a value as found only when it is gone from the whole output', () => {
    // The first Ana Ruiz sits next to an email, so a detector covers it. The text also writes "ruiz" as a
    // plain word, so the surname is not carried to the second, bare mention, and that one survives.
    const source = 'From: {{person:Ana Ruiz}} <{{email:ana.ruiz@firma.example}}>\n\nLater {{person:Ana Ruiz}} wrote again about the ruiz file.\n';
    const f = { name: 'synthetic/x', group: 'generated' as const, category: 'x', lang: 'en', source, parsed: parseAnnotated(source) };
    const card = scoreCorpus([f], 'bare');
    expect(card.perKind.email.recall).toBe(100);
    expect(card.perKind.person.annotated).toBe(2);
    expect(card.perKind.person.coverage).toBeGreaterThan(card.perKind.person.recall);
    expect(card.perKind.person.survivors).toBeGreaterThan(0);
  });

  it('C9: the scorer notices a missed value', () => {
    expect(survives('email', 'ana@x.example', 'write to ana@x.example')).toBe(true);
    expect(survives('person', 'Ana Ruiz', 'Hola Ruiz')).toBe(true);
    expect(survives('person', 'Ana Ruiz', 'Hola Clara')).toBe(false);
    expect(containsWord('Banana split', 'Ana')).toBe(false);
  });
});
