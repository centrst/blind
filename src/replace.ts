/**
 * The two replacement modes beside `fake`: numbered placeholders and unrelated
 * random values. Both are consistent per value and keep a pair for every
 * value, so `unblind` can put the real one back.
 */
import { amountKey, formatNumber, parseNumber, type AmountOcc } from './amounts.js';
import { dateKey, detectDates, type DateOcc } from './dates.js';
import type { Rng } from './prng.js';
import type { PairLog } from './pairlog.js';
import type { DateOrder, Kind, Pair, ReplaceWith } from './types.js';
import { BlindError } from './errors.js';

export const REPLACE_MODES: readonly ReplaceWith[] = ['fake', 'placeholder', 'random'];

/** Any placeholder of the `[REDACTED_PERSON_1]` form, known to the mapping or not. */
export const PLACEHOLDER_RE = /\[REDACTED_[A-Z]+_[1-9]\d*\]/g;

const placeholderOf = (kind: Kind, n: number): string => `[REDACTED_${kind.toUpperCase()}_${n}]`;

/** The number in `fake` when it is a placeholder of `kind`, else null. */
export function placeholderNumber(kind: Kind, fake: string): number | null {
  const m = /^\[REDACTED_([A-Z]+)_([1-9]\d*)\]$/.exec(fake);
  return m && m[1] === kind.toUpperCase() ? Number(m[2]) : null;
}

/**
 * The placeholder literals already written in `texts`, upper case, in order of
 * first appearance. `unblind` matches placeholders in any case, so a literal
 * in lower case counts too.
 */
export function placeholderLiterals(texts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(/\[REDACTED_[A-Z]+_[1-9]\d*\]/gi)) out.add(m[0].toUpperCase());
  return [...out];
}

/**
 * Numbered placeholders, counted per kind in order of first appearance. The key
 * is the value as written, so each spelling comes back exactly as it was. A
 * number whose placeholder is in `literals` (written in the input already) is
 * skipped, so `unblind` never turns that literal into a real value.
 */
export class Placeholders {
  readonly pairs: Pair[] = [];
  private byReal = new Map<string, string>();
  private next = new Map<Kind, number>();
  private readonly literals: ReadonlySet<string>;

  constructor(prev: readonly Pair[], literals: Iterable<string> = []) {
    this.literals = new Set(literals);
    for (const p of prev) {
      this.byReal.set(`${p.kind}|${p.real}`, p.fake);
      const n = placeholderNumber(p.kind, p.fake);
      if (n !== null && n >= (this.next.get(p.kind) ?? 1)) this.next.set(p.kind, n + 1);
    }
  }

  get(kind: Kind, real: string): string {
    const key = `${kind}|${real}`;
    let out = this.byReal.get(key);
    if (out === undefined) {
      let n = this.next.get(kind) ?? 1;
      while (this.literals.has(placeholderOf(kind, n))) n++;
      this.next.set(kind, n + 1);
      out = placeholderOf(kind, n);
      this.byReal.set(key, out);
      this.pairs.push({ kind, real, fake: out });
    }
    return out;
  }
}

const daysIn = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * Random values for `random` mode where the fake generators would keep shape:
 * phones, IBANs and ids get plain random digits in one fixed layout with no
 * checksum, amounts get an unrelated random amount and dates an unrelated
 * random date. Each value gets one fake, and no two values share one. Phones,
 * IBANs and ids are claimed in the pair log as written.
 */
export class RandomFakes {
  private memo = new Map<string, string>();
  private used = new Set<string>();
  private amountMinor = new Map<string, number>();
  private usedAmount = new Set<string>();
  private dateYmd = new Map<string, { y: number | null; m: number; d: number }>();
  private usedDate = new Set<string>();

  constructor(
    private readonly rng: Rng,
    prev: readonly Pair[],
    dateOrder: DateOrder,
    private readonly log: PairLog,
  ) {
    for (const p of prev) {
      if (p.kind === 'phone' || p.kind === 'iban' || p.kind === 'id') {
        this.memo.set(`${p.kind}|${p.real}`, p.fake);
        this.used.add(p.fake);
      } else if (p.kind === 'amount') {
        const r = parseNumber(p.real);
        const f = parseNumber(p.fake);
        if (r && f && r.decimals === f.decimals) {
          this.amountMinor.set(amountKey(r), f.minor);
          this.usedAmount.add(amountKey(f));
        }
      } else if (p.kind === 'date') {
        const r = detectDates(p.real, dateOrder)[0]?.occ;
        const f = detectDates(p.fake, dateOrder)[0]?.occ;
        if (r && f) {
          this.dateYmd.set(dateKey(r), { y: f.y, m: f.m, d: f.d });
          this.usedDate.add(dateKey(f));
        }
      }
    }
  }

  private digits(n: number, first = 1): string {
    let s = String(this.rng.range(first, 9));
    while (s.length < n) s += String(this.rng.digit());
    return s;
  }

  /**
   * `real` is what detection saw, `orig` the value as written. A spelling of
   * the same value that another one already holds the fake of gets a fake of its own.
   */
  private fresh(kind: 'phone' | 'iban' | 'id', real: string, orig: string, make: () => string): string {
    const had = this.log.fakeOf(kind, orig);
    if (had !== undefined) return had;
    for (let n = 0; n < 1000; n++) {
      const key = n ? `${kind}|${real}#${n}` : `${kind}|${real}`;
      let f = this.memo.get(key);
      if (f === undefined) {
        do f = make();
        while (this.used.has(f) || f === real);
        this.used.add(f);
        this.memo.set(key, f);
      }
      if (this.log.claim(kind, orig, f)) return f;
    }
    // Only a number written in more ways than its fakes can tell apart gets here. The error names the kind, never the value.
    throw new BlindError('no-free-fake', `blind: no free fake left for a ${kind}`);
  }

  /** A Spanish mobile number in one layout, whatever the original looked like. */
  phone(real: string, orig: string = real): string {
    return this.fresh('phone', real, orig, () => {
      const d = `6${this.digits(8, 0)}`;
      return `+34 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    });
  }

  /** A Spanish-length IBAN with random digits, so its check digits are almost never valid. */
  iban(real: string, orig: string = real): string {
    return this.fresh('iban', real, orig, () => {
      const d = this.digits(22, 0);
      return `ES${d.slice(0, 2)} ${d.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}`;
    });
  }

  /** Nine random digits, with no letters, layout or checksum of the original. */
  id(real: string, orig: string = real): string {
    return this.fresh('id', real, orig, () => this.digits(9));
  }

  /** A random amount of 1 to 4 integer digits, written with the original's separators and decimals. */
  amount(o: AmountOcc): string {
    const key = amountKey(o);
    let minor = this.amountMinor.get(key);
    if (minor === undefined) {
      let fk: string;
      do {
        const int = Number(this.digits(this.rng.range(1, 4)));
        minor = int * 10 ** o.decimals + this.rng.int(10 ** o.decimals);
        fk = amountKey({ minor, decimals: o.decimals });
      } while (this.usedAmount.has(fk) || minor === o.minor);
      this.usedAmount.add(fk);
      this.amountMinor.set(key, minor);
    }
    return formatNumber(minor, o.decimals, o.dec, o.thou);
  }

  /** A random date within a year either side of `refYear`. A date written without a year stays without one. */
  date(o: DateOcc, refYear: number): DateOcc {
    const key = dateKey(o);
    let ymd = this.dateYmd.get(key);
    if (ymd === undefined) {
      do {
        const y = this.rng.range(refYear - 1, refYear + 1);
        const m = this.rng.range(1, 12);
        // Without a year the day must exist in any year, so 29 February is never drawn.
        ymd = { y: o.y === null ? null : y, m, d: this.rng.range(1, o.y === null ? Math.min(28, daysIn(y, m)) : daysIn(y, m)) };
      } while (this.usedDate.has(dateKey(ymd)) || dateKey(ymd) === key);
      this.usedDate.add(dateKey(ymd));
      this.dateYmd.set(key, ymd);
    }
    return { ...ymd, fmt: o.fmt };
  }
}
