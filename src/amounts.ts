/** Amount detection, parsing, formatting and the scaling plan. */

import { foldLookalikes } from './fold.js';

/** A space that groups thousands: a plain, no-break, narrow no-break or thin space (`1 240,80 €`). */
const GROUP_SPACE = String.raw`[ \u00a0\u202f\u2009]`;
const GROUP_SPACE_RE = new RegExp(GROUP_SPACE, 'g');

export interface ParsedNumber {
  minor: number;
  decimals: number;
  dec: ',' | '.' | null;
  /** The thousands separator: a comma, a dot or the space the number groups with, written back as it was. */
  thou: string | null;
}

export interface AmountOcc extends ParsedNumber {
  /** Digits only, the part that gets rewritten. */
  start: number;
  end: number;
  /** Digits plus currency, for reporting. */
  fullStart: number;
  fullEnd: number;
  raw: string;
}

// At most five spaced groups after the first: the sixteen digits the fake of the largest amount may have. An open
// count would read a long run of three-digit groups with no currency again from each group, time that grows with its square.
const NUM = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,3}(?:${GROUP_SPACE}\d{3}){1,5}(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const SYM = String.raw`[€$£¥]`;
const CODE = String.raw`(?:EUR|USD|GBP|CHF|MXN|CAD|AUD|JPY|COP|ARS|CLP|BRL)`;
const WORD = String.raw`(?:euros?|d[óo]lares|dollars?|pounds?|libras)`;

const PREFIX_RE = new RegExp(
  String.raw`(?:${SYM}|(?<![\p{L}\d])${CODE}(?![\p{L}]))[ \t  ]?(?<n>${NUM})(?![\d])`,
  'giud',
);
const SUFFIX_RE = new RegExp(
  String.raw`(?<![\d.,])(?<n>${NUM})[ \t  ]?(?:${SYM}|(?:${CODE}|${WORD})(?![\p{L}]))`,
  'giud',
);
const PERCENT_RE = /(?<![\d.,])(\d+(?:[.,]\d+)?)[ \t  ]?%/g;

/**
 * Reads a number as written: its value in units of its last decimal, how many decimals it has, and its decimal and
 * thousands marks, told apart by position and group size. Null for anything that is not digits and marks, or a
 * value a double does not hold exactly.
 */
export function parseNumber(raw: string): ParsedNumber | null {
  const hasDot = raw.includes('.');
  const hasComma = raw.includes(',');
  let dec: ParsedNumber['dec'] = null;
  let thou: ParsedNumber['thou'] = null;
  const space = raw.match(GROUP_SPACE_RE)?.[0];
  if (space !== undefined) {
    // Groups of three split by spaces: the one dot or comma left, if any, is the decimal mark.
    const [intPart = '', frac = '', ...more] = raw.replace(GROUP_SPACE_RE, '').split(/[.,]/);
    if (more.length > 0 || !/^\d+$/.test(intPart) || (frac && !/^\d+$/.test(frac))) return null;
    const minor = Number(intPart + frac);
    if (!Number.isSafeInteger(minor)) return null;
    return { minor, decimals: frac.length, dec: frac ? (hasDot ? '.' : ',') : null, thou: space };
  }
  if (hasDot && hasComma) {
    if (raw.lastIndexOf('.') > raw.lastIndexOf(',')) {
      dec = '.';
      thou = ',';
    } else {
      dec = ',';
      thou = '.';
    }
  } else if (hasDot || hasComma) {
    const sep = hasDot ? '.' : ',';
    const count = raw.split(sep).length - 1;
    const last = raw.slice(raw.lastIndexOf(sep) + 1);
    const first = raw.slice(0, raw.indexOf(sep));
    if (count > 1) thou = sep;
    else if (last.length === 3 && first.length <= 3 && first !== '0') thou = sep;
    else dec = sep;
  }
  const noThou = thou ? raw.split(thou).join('') : raw;
  const [intPart, frac = ''] = dec ? noThou.split(dec) : [noThou, ''];
  if (!/^\d+$/.test(intPart as string) || (frac && !/^\d+$/.test(frac))) return null;
  // Any whole number of units a double holds exactly. `blind` takes amounts up to `MAX_AMOUNT_DIGITS`, so the
  // fake of the largest one, a digit longer under a factor above 1, still reads back here.
  const minor = Number((intPart as string) + frac);
  if (!Number.isSafeInteger(minor)) return null;
  return { minor, decimals: frac.length, dec, thou };
}

export function formatNumber(
  minor: number,
  decimals: number,
  dec: ParsedNumber['dec'],
  thou: ParsedNumber['thou'],
): string {
  const s = String(Math.abs(minor)).padStart(decimals + 1, '0');
  let int = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(-decimals) : '';
  if (thou) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, thou);
  return decimals ? `${int}${dec ?? '.'}${frac}` : int;
}

/** The most digits an amount `blind` scales may have: its fake, at most 1.6 times as large, is still an exact number. */
export const MAX_AMOUNT_DIGITS = 15;

/** Every amount in `text`: a number with a currency sign, code or word before or after it, in text order. */
export function detectAmounts(text: string): AmountOcc[] {
  const out: AmountOcc[] = [];
  const seen = new Set<number>();
  for (const re of [PREFIX_RE, SUFFIX_RE]) {
    for (const m of text.matchAll(re)) {
      const [s, e] = m.indices!.groups!.n as [number, number];
      if (seen.has(s)) continue;
      const raw = text.slice(s, e);
      const p = parseNumber(raw);
      if (!p) continue;
      seen.add(s);
      const [fs, fe] = m.indices![0] as [number, number];
      out.push({ ...p, start: s, end: e, fullStart: fs, fullEnd: fe, raw });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

export function detectPercents(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(PERCENT_RE)) {
    const v = Number((m[1] as string).replace(',', '.'));
    if (v > 0 && v <= 1000) out.push(v);
  }
  return out;
}

export const amountKey = (o: { minor: number; decimals: number }): string => `${o.decimals}:${o.minor}`;

type Deriv =
  | { rule: 'sum'; a: string; b: string }
  | { rule: 'surcharge'; a: string; p: number }
  | { rule: 'pct'; a: string; p: number };

/**
 * One factor for every amount in the call. Where the text shows a relation
 * (a percentage of a base, a base plus a surcharge, a sum), the derived amount
 * is recomputed from the scaled operands instead of being scaled on its own. A
 * total one cent off the sum of its parts stays one cent off. No two amounts
 * get the same fake, so unblind
 * can always tell them apart: a fake another amount already has is moved to the
 * nearest free one, by the smallest unit.
 */
export class AmountPlan {
  private info = new Map<string, { minor: number; decimals: number }>();
  private deriv = new Map<string, Deriv>();
  /** Relations found for an amount after its first, by an id of the amount, rule and operands. */
  private extra = new Map<string, { key: string; d: Deriv }>();
  private cache = new Map<string, number>();
  private readonly pinned: ReadonlyMap<string, number>;
  /** Units added to an independent amount to move it off a fake another amount has. */
  private offset = new Map<string, number>();
  /** Derived amounts scaled on their own, because no move of an operand set them apart. */
  private loose = new Set<string>();

  /** `pinned` holds fakes an earlier call already gave out, by amount key. They are kept as they are. */
  constructor(
    perText: AmountOcc[][],
    percents: number[][],
    private readonly factor: number,
    pinned: ReadonlyMap<string, number> = new Map(),
  ) {
    this.pinned = pinned;
    for (const occs of perText) for (const o of occs) this.info.set(amountKey(o), o);
    perText.forEach((occs, i) => this.findRelations(occs, [...new Set(percents[i] ?? [])]));
    this.settle();
  }

  private real(key: string): number {
    const i = this.info.get(key)!;
    return i.minor / 10 ** i.decimals;
  }

  private near(key: string, expected: number): boolean {
    const i = this.info.get(key)!;
    return Math.abs(this.real(key) - expected) <= 1.0001 / 10 ** i.decimals;
  }

  private findRelations(occs: AmountOcc[], pcts: number[]): void {
    const keys = [...new Set(occs.map(amountKey))].filter((k) => this.info.get(k)!.minor > 0).slice(0, 60);
    for (const p of pcts) {
      for (const s of keys) {
        for (const a of keys) {
          if (a !== s && this.near(s, (this.real(a) * p) / 100)) {
            this.relate(s, { rule: 'pct', a, p });
            break;
          }
        }
      }
    }
    for (const c of keys) {
      let found = false;
      for (let i = 0; i < keys.length && !found; i++) {
        for (let j = i + 1; j < keys.length && !found; j++) {
          const a = keys[i]!;
          const b = keys[j]!;
          if (a === c || b === c) continue;
          if (this.real(c) > this.real(a) && this.real(c) > this.real(b) && this.near(c, this.real(a) + this.real(b))) {
            this.relate(c, { rule: 'sum', a, b });
            found = true;
          }
        }
      }
    }
    for (const p of pcts) {
      for (const c of keys) {
        for (const a of keys) {
          if (a !== c && this.near(c, this.real(a) * (1 + p / 100))) {
            this.relate(c, { rule: 'surcharge', a, p });
            break;
          }
        }
      }
    }
  }

  /**
   * The first relation found for an amount computes its fake. Any later one
   * (10,43 as 4 % of 260,63 and as 10,03 plus 4 %) is kept as a check:
   * `broken` counts the ones the plan does not keep, so the caller can draw
   * another factor.
   */
  private relate(key: string, d: Deriv): void {
    if (!this.deriv.has(key)) {
      this.deriv.set(key, d);
      return;
    }
    const id = `${key}|${d.rule}|${d.a}|${d.rule === 'sum' ? d.b : d.p}`;
    const first = this.deriv.get(key)!;
    if (id === `${key}|${first.rule}|${first.a}|${first.rule === 'sum' ? first.b : first.p}`) return;
    if (!this.extra.has(id)) this.extra.set(id, { key, d });
  }

  /** The value `d` gives `key` from the planned fakes of its operands, in units of `key`. */
  private derived(key: string, d: Deriv, visiting: Set<string>): number {
    const scaled = (k: string): number => this.fakeMinor(k, visiting) / 10 ** this.info.get(k)!.decimals;
    const { minor, decimals: dt } = this.info.get(key)!;
    // A total written one unit off the sum of its parts stays that far off,
    // so it never lands on the fake of the exact total. A percentage is
    // rounded afresh: the real one may be rounded either way.
    const residual = d.rule === 'sum' ? minor - Math.round(AmountPlan.apply(d, (k) => this.real(k)) * 10 ** dt) : 0;
    return Math.round(AmountPlan.apply(d, scaled) * 10 ** dt) + residual;
  }

  /** How many relations beyond an amount's first one its fake does not keep, to the smallest unit. */
  broken(): number {
    let n = 0;
    for (const { key, d } of this.extra.values()) {
      if (this.pinned.has(key) && this.pinned.has(d.a) && (d.rule !== 'sum' || this.pinned.has(d.b))) continue;
      if (this.fakeMinor(key) !== this.derived(key, d, new Set())) n++;
    }
    return n;
  }

  private relation(key: string): Deriv | undefined {
    return this.loose.has(key) ? undefined : this.deriv.get(key);
  }

  private independent(key: string): number {
    const { minor } = this.info.get(key)!;
    return Math.max(minor > 0 ? 1 : 0, Math.round(minor * this.factor)) + (this.offset.get(key) ?? 0);
  }

  /** `d` applied to `value`, which gives each operand's value in its own units. */
  private static apply(d: Deriv, value: (k: string) => number): number {
    if (d.rule === 'sum') return value(d.a) + value(d.b);
    if (d.rule === 'surcharge') return value(d.a) * (1 + d.p / 100);
    return (value(d.a) * d.p) / 100;
  }

  fakeMinor(key: string, visiting: Set<string> = new Set()): number {
    const hit = this.cache.get(key) ?? this.pinned.get(key);
    if (hit !== undefined) return hit;
    const d = this.relation(key);
    let out: number;
    if (!d || visiting.has(key)) {
      out = this.independent(key);
    } else {
      visiting.add(key);
      const m = this.derived(key, d, visiting);
      out = m > 0 ? m : this.independent(key);
      visiting.delete(key);
    }
    this.cache.set(key, out);
    return out;
  }

  /** Independent amounts `key` is computed from, itself included when it is one. */
  private roots(key: string, seen: Set<string> = new Set()): Set<string> {
    if (seen.has(key)) return new Set();
    seen.add(key);
    const d = this.relation(key);
    if (!d) return new Set(this.pinned.has(key) ? [] : [key]);
    return new Set([...this.roots(d.a, seen), ...(d.rule === 'sum' ? this.roots(d.b, seen) : [])]);
  }

  /**
   * Moves fakes apart until no two amounts share one, per number of decimals,
   * pinned fakes included. The first clash in order of real value is settled
   * each round: the larger amount moves when it is independent, else the
   * smaller one, else an operand of one of them, else the larger one is scaled
   * on its own. A move lands on the free fake nearest to the amount times the
   * factor.
   */
  private settle(): void {
    const order = [...this.info.keys()].filter((k) => !this.pinned.has(k)).sort((a, b) => {
      const x = this.info.get(a)!;
      const y = this.info.get(b)!;
      return x.decimals - y.decimals || this.real(a) - this.real(b);
    });
    const slot = (key: string, v: number): string => `${key.split(':')[0]}:${v}`;
    for (let round = 0; round < 50 + 20 * order.length; round++) {
      this.cache = new Map();
      const at = new Map<string, string>();
      for (const [k, v] of this.pinned) at.set(slot(k, v), k);
      let clash: [string, string] | null = null;
      for (const k of order) {
        const s = slot(k, this.fakeMinor(k));
        const other = at.get(s);
        if (other !== undefined) {
          clash = [other, k];
          break;
        }
        at.set(s, k);
      }
      if (!clash) return;
      const [low, high] = clash;
      const movable = (k: string): boolean => !this.pinned.has(k) && !this.relation(k);
      // The free fake nearest to the amount times the factor, on either side.
      const move = (k: string): boolean => {
        const v = this.fakeMinor(k);
        const { minor } = this.info.get(k)!;
        const ideal = minor * this.factor;
        const floor = minor > 0 ? 1 : 0;
        for (let step = 1; step < 1000; step++) {
          const sides = [v + step, v - step].sort((x, y) => Math.abs(x - ideal) - Math.abs(y - ideal));
          const w = sides.find((x) => x >= floor && !at.has(slot(k, x)));
          if (w !== undefined) {
            this.offset.set(k, (this.offset.get(k) ?? 0) + (w - v));
            return true;
          }
        }
        return false;
      };
      if (movable(high) && move(high)) continue;
      if (movable(low) && move(low)) continue;
      const lowRoots = this.roots(low);
      const highRoots = this.roots(high);
      const only = [...highRoots].find((r) => !lowRoots.has(r)) ?? [...lowRoots].find((r) => !highRoots.has(r));
      if (only !== undefined) {
        this.offset.set(only, (this.offset.get(only) ?? 0) + 1);
        continue;
      }
      this.loose.add(this.relation(high) ? high : low);
    }
    // Moving operands went round in circles. Scale every amount on its own:
    // then each move settles one clash for good and the loop ends.
    for (const k of this.deriv.keys()) this.loose.add(k);
    this.settle();
  }
}

const FULL_WIDTH_OFFSET = 0xfee0;
const isFullWidth = (ch: string): boolean => {
  const cp = ch.codePointAt(0) as number;
  return cp >= 0xff01 && cp <= 0xff5e;
};
const toFullWidth = (ch: string): string => String.fromCharCode((ch.codePointAt(0) as number) + FULL_WIDTH_OFFSET);

/**
 * Writes `plain` in the full-width habit of `written`: digits and separators
 * are each taken in turn, a class written all full-width stays all full-width,
 * a mixed one is copied place by place from the left.
 */
function styleLike(plain: string, written: string): string {
  const classOf = (ch: string): 'digit' | 'sep' => (/\d/.test(foldLookalikes(ch)) ? 'digit' : 'sep');
  const wide = { digit: [] as boolean[], sep: [] as boolean[] };
  for (const ch of written) wide[classOf(ch)].push(isFullWidth(ch));
  const all = (xs: boolean[]): boolean => xs.length > 0 && xs.every(Boolean);
  const seen = { digit: 0, sep: 0 };
  let out = '';
  for (const ch of plain) {
    const c = classOf(ch);
    const i = seen[c]++;
    out += all(wide[c]) || wide[c][i] === true ? toFullWidth(ch) : ch;
  }
  return out;
}

/**
 * The fake of one written spelling of an amount whose fake value is `minor`
 * with `o.decimals` decimals. The fake keeps the spelling's separators and its
 * full-width digits, so two spellings of one amount get two fakes. When that
 * rendering is `taken` by another spelling, the same value is written another
 * way: with or without a thousands separator, with the other decimal mark,
 * with trailing zeros, full-width, plain, or partly full-width. Every rendering reads back as the same value, so sums
 * and percentages stay intact. When every rendering is taken the plain one is
 * returned and the pair shows up in `collisions`.
 */
export function freeAmountFake(
  minor: number,
  o: ParsedNumber,
  written: string,
  thouHint: ParsedNumber['thou'],
  taken: (fake: string) => boolean,
): string {
  const thou = o.thou ?? thouHint;
  const plain = styleLike(formatNumber(minor, o.decimals, o.dec, thou), written);
  if (!taken(plain)) return plain;
  const other = (c: ',' | '.' | null): ',' | '.' => (c === ',' ? '.' : ',');
  // Other separators for the same value, then the value with trailing zeros
  // added to two decimals (`7` as `7.00`), which reads as the same amount.
  const bases = [formatNumber(minor, o.decimals, o.dec, thou), formatNumber(minor, o.decimals, o.dec, thou ? null : other(o.dec))];
  const decs = [o.dec ?? '.', other(o.dec ?? '.')];
  if (o.decimals > 0) bases.push(formatNumber(minor, o.decimals, decs[1]!, null), formatNumber(minor, o.decimals, decs[1]!, other(decs[1]!)));
  if (o.decimals < 2) {
    const more = minor * 10 ** (2 - o.decimals);
    for (const dec of decs) bases.push(formatNumber(more, 2, dec, null), formatNumber(more, 2, dec, other(dec)));
  }
  const same = (s: string): boolean => {
    const back = parseNumber(foldLookalikes(s));
    return back !== null && back.decimals >= o.decimals && back.minor === minor * 10 ** (back.decimals - o.decimals);
  };
  // Each is tried in the spelling's full-width habit, with every digit
  // full-width, plain, then with the digits full-width place by place, so a
  // short amount still has renderings enough to tell three or more spellings apart.
  const masked = (v: string, mask: number): string => {
    let i = 0;
    return [...v].map((ch) => (/\d/.test(ch) && mask & (1 << i++) ? toFullWidth(ch) : ch)).join('');
  };
  const styles: Array<(v: string) => string[]> = [(v) => [styleLike(v, written)], (v) => [masked(v, -1)], (v) => [v]];
  styles.push((v) => Array.from({ length: Math.max(0, 2 ** Math.min(v.replace(/\D/g, '').length, 8) - 2) }, (_, i) => masked(v, i + 1)));
  for (const style of styles) {
    for (const base of bases) {
      for (const v of style(base)) if (!taken(v) && same(v)) return v;
    }
  }
  return plain;
}
