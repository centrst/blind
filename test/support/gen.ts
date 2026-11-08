/** fast-check arbitraries that build realistic synthetic emails. */
import fc from 'fast-check';
import { parseAnnotated, type AnnSpan } from './annotate.js';
import { CATEGORIES, genEmail, type Category, type LangMode } from './templates.js';
import {
  chance, makeEmail, makeIban, makeId, makeMinor, makePerson, makePhone, makeYmd, pick, plain, range, renderAmount,
  type Src,
} from './values.js';
import type { KnownValue } from '../../src/types.js';

export type GenFn = fc.GeneratorValue;

export const srcFrom = (g: GenFn): Src => ({ int: (n) => g(fc.integer, { min: 0, max: n - 1 }) });

export interface Case {
  /** Text with annotations stripped. */
  text: string;
  /** Every inserted value, with its kind. */
  spans: AnnSpan[];
  /** All persons, orgs and places in the text, the way a careful owner would list them. */
  known: KnownValue[];
  dateOrder: 'dmy' | 'mdy';
}

export function toCase(annotated: string): Case {
  const p = parseAnnotated(annotated);
  const seen = new Set<string>();
  const known: KnownValue[] = [];
  for (const s of p.spans) {
    if (s.kind !== 'person' && s.kind !== 'org' && s.kind !== 'place') continue;
    const k = `${s.kind}|${s.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    known.push({ kind: s.kind, value: s.value });
  }
  return { text: p.text, spans: p.spans, known, dateOrder: p.dateOrder };
}

const MODES: LangMode[] = ['en', 'es', 'mixed'];

/** A realistic email in any category and language. */
export const emailCase: fc.Arbitrary<Case> = fc.gen().map((g) => {
  const s = srcFrom(g);
  const category: Category = pick(s, CATEGORIES);
  return toCase(genEmail(s, category, pick(s, MODES)));
});

export const seedArb = fc.string({ minLength: 1, maxLength: 12 });

// ---------------------------------------------------------- relation texts

export interface RelationCase {
  text: string;
  /** What the checker verifies, per line. */
  checks: Array<
    | { rule: 'surcharge'; p: number }
    | { rule: 'pct'; p: number }
    | { rule: 'sum' }
    | { rule: 'chain'; p: number }
  >;
}

type Intended = { rule: 'pct' | 'sur'; part: number; base: number } | { rule: 'sum'; total: number; a: number; b: number };

/**
 * True when two amounts that the text does not tie together still look tied
 * to the engine: one is a percentage of another, a surcharge on it, or the sum
 * of two others, within a cent. Such a case is ambiguous on its face, so the
 * generator draws again.
 */
function hasSpuriousRelation(all: number[], p: number, intended: Intended[]): boolean {
  const near = (x: number, y: number): boolean => Math.abs(x - y) <= 1.0001; // cents
  const tied = (part: number, base: number, rule: string): boolean => intended.some((i) => i.rule === rule && 'part' in i && i.part === part && i.base === base);
  for (const x of all) {
    for (const y of all) {
      if (x === y) continue;
      if (near(x, (y * p) / 100) && !tied(x, y, 'pct')) return true;
      if (near(x, (y * (100 + p)) / 100) && !tied(x, y, 'sur')) return true;
    }
  }
  for (const c of all) {
    for (const a of all) {
      for (const b of all) {
        if (a >= b || c <= a || c <= b || !near(c, a + b)) continue;
        if (!intended.some((i) => i.rule === 'sum' && i.total === c && i.a === a && i.b === b)) return true;
      }
    }
  }
  return false;
}

/** Texts that contain exact amount relations in EU or US style. */
export const relationCase: fc.Arbitrary<RelationCase> = fc.gen().map((g) => {
  const s = srcFrom(g);
  const eu = chance(s, 50);
  const cur = (m: number): string => {
    const whole = Math.floor(m / 100);
    const cents = String(m % 100).padStart(2, '0');
    const grp = (x: string, sep: string): string => x.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return eu ? `${grp(String(whole), '.')},${cents} €` : `$${grp(String(whole), ',')}.${cents}`;
  };
  // One rate per text, like a real document. Two rates can make unrelated figures look related.
  const p = pick(s, [4, 5, 7, 8, 10, 15, 20, 21]);
  const pctTxt = eu ? `${p} %` : `${p}%`;
  let last: RelationCase = { text: '', checks: [] };
  for (let attempt = 0; attempt < 30; attempt++) {
    const used = new Set<number>();
    // Amounts at least 3 units apart, so two unrelated figures never look like a relation by accident.
    const apart = (v: number): boolean => [...used].every((u) => Math.abs(u - v) > 300);
    const fresh = (min: number, max: number): number => {
      let v = range(s, min, max);
      for (let i = 0; i < 40 && !apart(v); i++) v = range(s, min, max);
      while (!apart(v)) v += 301;
      used.add(v);
      return v;
    };
    const lines: string[] = [];
    const checks: RelationCase['checks'] = [];
    const intended: Intended[] = [];
    const n = range(s, 1, 3);
    for (let i = 0; i < n; i++) {
      const kind = s.int(4);
      const base = fresh(1000, 900000);
      const vat = Math.round((base * p) / 100);
      if (kind === 0) {
        lines.push(eu ? `Base ${cur(base)} + ${pctTxt} = ${cur(base + vat)}` : `Base ${cur(base)} plus ${pctTxt} comes to ${cur(base + vat)}`);
        checks.push({ rule: 'surcharge', p });
        used.add(base + vat);
        intended.push({ rule: 'sur', part: base + vat, base });
      } else if (kind === 1) {
        lines.push(eu ? `El ${pctTxt} de ${cur(base)} son ${cur(vat)}` : `${pctTxt} of ${cur(base)} is ${cur(vat)}`);
        checks.push({ rule: 'pct', p });
        used.add(vat);
        intended.push({ rule: 'pct', part: vat, base });
      } else if (kind === 2) {
        const b = fresh(1000, 900000);
        lines.push(eu ? `${cur(base)} + ${cur(b)} = ${cur(base + b)}` : `Items: ${cur(base)} + ${cur(b)} = ${cur(base + b)}`);
        checks.push({ rule: 'sum' });
        used.add(base + b);
        intended.push({ rule: 'sum', total: base + b, a: Math.min(base, b), b: Math.max(base, b) });
      } else {
        lines.push(eu ? `Base ${cur(base)}. IVA ${pctTxt}: ${cur(vat)}. Total ${cur(base + vat)}.` : `Net ${cur(base)}. Tax ${pctTxt}: ${cur(vat)}. Total ${cur(base + vat)}.`);
        checks.push({ rule: 'chain', p });
        used.add(vat);
        used.add(base + vat);
        intended.push({ rule: 'pct', part: vat, base }, { rule: 'sur', part: base + vat, base }, { rule: 'sum', total: base + vat, a: Math.min(base, vat), b: Math.max(base, vat) });
      }
    }
    last = { text: lines.join('\n'), checks };
    if (!hasSpuriousRelation([...used], p, intended)) break;
  }
  return last;
});

// ----------------------------------------------------- single-value shapes

export interface ShapeCase {
  kind: 'phone' | 'iban' | 'id' | 'email' | 'amount';
  value: string;
  /** For amounts, the style the value was rendered in. */
  style?: 'eu' | 'us';
}

export const shapeCase: fc.Arbitrary<ShapeCase> = fc.gen().map((g) => {
  const s = srcFrom(g);
  switch (s.int(5)) {
    case 0: return { kind: 'phone', value: makePhone(s) };
    case 1: return { kind: 'iban', value: makeIban(s) };
    case 2: return { kind: 'id', value: makeId(s).value };
    case 3: {
      const p = makePerson(s, pick(s, ['en', 'es'] as const));
      return { kind: 'email', value: makeEmail(s, p, `${plain(p.last.split(' ')[0] ?? 'x')}-${pick(s, ['studio', 'clinic', 'group'])}.example`) };
    }
    default: {
      const style = pick(s, ['eu', 'us'] as const);
      return { kind: 'amount', value: renderAmount(makeMinor(s), s, style), style };
    }
  }
});

export const dayArb = fc.gen().map((g) => makeYmd(srcFrom(g)));
