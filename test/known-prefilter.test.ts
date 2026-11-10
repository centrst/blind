/**
 * The known-value matcher looks each entry up by a key before it compiles and
 * runs the entry's pattern. These tests hold it to the matcher that tries every
 * entry on every text: the same spans, in the same order, for any input.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asciiKeyText, everyKnownDetector, knownDetector } from '../src/detect.js';
import { foldLookalikes } from '../src/fold.js';
import type { DetectContext, KnownValue, Span } from '../src/types.js';
import { loadAdversarial } from './support/adversarial.js';
import { loadCorpus } from './support/corpus.js';
import { srcFrom } from './support/gen.js';
import { check } from './support/properties.js';
import { CATEGORIES, genEmail } from './support/templates.js';
import { chance, makeEmail, makeId, makeOrg, makePerson, makePhone, makePlace, pick, range, type Src } from './support/values.js';
import { parseAnnotated } from './support/annotate.js';

const ctx: DetectContext = { dateOrder: 'dmy', isAllowedHost: () => false };

/** The spans of both matchers, or the message each throws. */
function both(known: KnownValue[], text: string): [Span[] | string, Span[] | string] {
  const run = (make: (k: KnownValue[]) => { detect: (t: string, c: DetectContext) => Span[] }): Span[] | string => {
    try {
      return make(known).detect(text, ctx);
    } catch (e) {
      return (e as Error).message;
    }
  };
  return [run(knownDetector), run(everyKnownDetector)];
}

/** Values in scripts and shapes with their own matching rules. All invented. */
const EXOTIC: KnownValue[] = [
  { kind: 'person', value: 'Иван Петров' },
  { kind: 'person', value: 'Γιώργος Παππάς' },
  { kind: 'person', value: '김민수' },
  { kind: 'person', value: '지원' },
  { kind: 'person', value: 'דוד לוי' },
  { kind: 'person', value: 'לאה' },
  { kind: 'person', value: 'محمد ناصر' },
  { kind: 'person', value: '王伟' },
  { kind: 'org', value: '华星科技' },
  { kind: 'place', value: '华' },
  { kind: 'person', value: 'Al' },
  { kind: 'person', value: 'De La' },
  { kind: 'person', value: 'O Li' },
  { kind: 'person', value: 'Li Na' },
  { kind: 'person', value: 'Al Brenner' },
  { kind: 'person', value: 'Ana de la Cruz' },
  { kind: 'person', value: 'J. Orvane' },
  { kind: 'person', value: 'Zoë Ångström-Kask' },
  { kind: 'org', value: 'Kastell Sistemas S.L.' },
  { kind: 'email', value: 'kasia.ostrowska@sklep.example' },
  { kind: 'email', value: 'zoë@straße.example' },
  { kind: 'domain', value: 'straße.example' },
  { kind: 'domain', value: 'kestrel.example' },
  { kind: 'id', value: 'KS-4471-SK' },
  { kind: 'id', value: 'Ä-7' },
  { kind: 'phone', value: '+44 7700 900461' },
  { kind: 'phone', value: '555-0147' },
  { kind: 'org', value: `Norte${' '.repeat(40)}Asesores` },
];

const ZW = '​';
const LOOK: Record<string, string> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', A: 'А', B: 'В', K: 'К' };

/** `v` written another way a text may write it. */
function variant(s: Src, v: string): string {
  switch (s.int(12)) {
    case 0: return v.toUpperCase();
    case 1: return v.toLowerCase();
    case 2: return v.normalize('NFD').replace(/\p{M}/gu, '');
    case 3: return [...v].map((c) => LOOK[c] ?? c).join('');
    case 4: return [...v].map((c) => (/[!-~]/.test(c) && chance(s, 50) ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c)).join('');
    case 5: { const i = range(s, 0, v.length); return v.slice(0, i) + ZW + v.slice(i); }
    case 6: return v.replace(/s/g, 'ſ').replace(/k/g, 'K').replace(/K/g, 'K');
    case 7: return v.replace(/\s+/g, chance(s, 50) ? '  ' : '\n');
    case 8: return v.replace(/\d/g, (d) => (chance(s, 30) ? `${d}.` : chance(s, 30) ? `${d} ` : d));
    case 9: return `${pick(s, ['ל', 'וה', 'ו', 'بال', 'لل'])}${v}`;
    case 10: return `${v}${pick(s, ['는', '님', '的', 'さん', 's', '1', 'x'])}`;
    default: return v;
  }
}

/** A known list of `n` entries from the value makers, the exotic ones among them. */
function knownList(s: Src, n: number): KnownValue[] {
  const out: KnownValue[] = [];
  for (let i = 0; i < n; i++) {
    const lang = pick(s, ['en', 'es'] as const);
    const p = makePerson(s, lang);
    switch (s.int(9)) {
      case 0: out.push({ kind: 'person', value: chance(s, 50) ? p.full : p.last }); break;
      case 1: out.push({ kind: 'org', value: makeOrg(s, lang).name }); break;
      case 2: out.push({ kind: 'place', value: makePlace(s, lang) }); break;
      case 3: out.push({ kind: 'email', value: makeEmail(s, p, pick(s, ['norte.example', 'kestrel.example', 'sklep.example'])) }); break;
      case 4: out.push({ kind: 'phone', value: makePhone(s) }); break;
      case 5: out.push({ kind: 'id', value: makeId(s).value }); break;
      case 6: out.push({ kind: 'domain', value: `${p.last.split(' ')[0]?.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}.example` }); break;
      default: out.push(pick(s, EXOTIC));
    }
  }
  return out;
}

/** A generated email with written variants of some known values put in at random places. */
function textFor(s: Src, known: KnownValue[]): string {
  let text = parseAnnotated(genEmail(s, pick(s, CATEGORIES), pick(s, ['en', 'es', 'mixed'] as const))).text;
  const count = range(s, 0, 8);
  for (let i = 0; i < count && known.length; i++) {
    const v = variant(s, pick(s, known).value);
    const at = range(s, 0, text.length);
    const glue = pick(s, [' ', '', '\n', ', ', '(', '王']);
    text = `${text.slice(0, at)}${glue}${v}${pick(s, [' ', '', '.', ')', '在'])}${text.slice(at)}`;
  }
  return text;
}

describe('C55: the known-value prefilter', () => {
  it('C55: finds exactly the spans of the matcher that tries every entry, on generated lists and texts, as written and folded', () => {
    check(
      fc.property(fc.gen(), (g) => {
        const s = srcFrom(g);
        const known = knownList(s, range(s, 1, 120));
        const text = textFor(s, known);
        for (const t of [text, foldLookalikes(text)]) {
          const [fast, every] = both(known, t);
          expect(fast).toEqual(every);
        }
      }),
      // A tenth of the property count: every case compiles both matchers. test:deep runs 2,000.
      { numRuns: Math.max(100, Math.round(Number(process.env.NUM_RUNS ?? 2000) / 10)) },
    );
  }, 600_000);

  it('C55: finds exactly the spans of the matcher that tries every entry on every corpus and adversarial text', () => {
    const cases: Array<{ text: string; known: KnownValue[] }> = [
      ...loadCorpus().map((f) => {
        const seen = new Set<string>();
        const known = f.parsed.spans
          .filter((sp) => sp.kind === 'person' || sp.kind === 'org' || sp.kind === 'place' || sp.kind === 'email' || sp.kind === 'phone')
          .map((sp) => ({ kind: sp.kind, value: sp.value }) as KnownValue)
          .filter((k) => !seen.has(`${k.kind}|${k.value}`) && seen.add(`${k.kind}|${k.value}`));
        return { text: f.parsed.text, known };
      }),
      ...loadAdversarial().flatMap((f) => f.cases.filter((c) => c.known?.length).map((c) => ({ text: c.text, known: c.known as KnownValue[] }))),
    ];
    expect(cases.length).toBeGreaterThan(100);
    for (const c of cases) {
      for (const t of [c.text, foldLookalikes(c.text)]) {
        const [fast, every] = both(c.known, t);
        expect(fast).toEqual(every);
      }
    }
  });

  it('C55: maps every code point a pattern with the iu flags matches to an ASCII character to that character in lower case', () => {
    // The prefilter compares a value's ASCII runs against `asciiKeyText` of the text, so
    // every code point that matches an ASCII character of a pattern must read as it there.
    const ascii = /^[\0-\x7f]$/iu;
    const found: number[] = [];
    for (let cp = 0x80; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      if (ascii.test(String.fromCodePoint(cp))) found.push(cp);
    }
    expect(found).toEqual([0x17f, 0x212a]);
    for (const cp of found) {
      const ch = String.fromCodePoint(cp);
      const key = asciiKeyText(ch);
      expect(new RegExp(`^${key}$`, 'iu').test(ch)).toBe(true);
      expect(key).toMatch(/^[a-z]$/);
    }
    for (let c = 0; c < 0x80; c++) {
      const ch = String.fromCharCode(c);
      for (let d = 0; d < 0x80; d++) {
        const other = String.fromCharCode(d);
        if (new RegExp(`^[${ch.replace(/[\\\]^-]/, '\\$&')}]$`, 'iu').test(other)) expect(asciiKeyText(other)).toBe(asciiKeyText(ch));
      }
    }
    expect(asciiKeyText('Abé\u{1f600}')).toBe('ab￿￿￿');
  });
});
