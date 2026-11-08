import type { DateOrder } from './types.js';

export const EN_MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december',
];
export const ES_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre',
];
const EN_ABBREV: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export interface DateFmt {
  style: 'iso' | 'num' | 'enMdy' | 'enDmy' | 'es';
  order: 'dmy' | 'mdy';
  sep: string;
  pad: boolean;
  yearDigits: 0 | 2 | 4;
  monthCase: 'cap' | 'lower' | 'upper';
  abbrev: 0 | 3 | 4;
  dot: boolean;
  ordinal: boolean;
  comma: boolean;
  of: boolean;
  ordSign: string;
  yearLink: string;
}

export interface DateOcc {
  y: number | null;
  m: number;
  d: number;
  fmt: DateFmt;
}

export interface DateMatch {
  start: number;
  end: number;
  occ: DateOcc;
}

const baseFmt: DateFmt = {
  style: 'iso', order: 'dmy', sep: '/', pad: true, yearDigits: 4, monthCase: 'cap', abbrev: 0, dot: false,
  ordinal: false, comma: false, of: false, ordSign: '', yearLink: 'de',
};

const EN_TOKENS = [...EN_MONTHS, ...Object.keys(EN_ABBREV)].sort((a, b) => b.length - a.length).join('|');
const ES_TOKENS = ES_MONTHS.join('|');

const ISO_RE = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?!\d)/gd;
const NUM_RE = /(?<![\d/.-])(\d{1,2})([/.-])(\d{1,2})\2(\d{4}|\d{2})(?!\d)/gd;
const EN_MDY_RE = new RegExp(
  String.raw`(?<![\p{L}\d])(${EN_TOKENS})(\.?)[ \t]{1,4}(\d{1,2})(st|nd|rd|th)?(?:(,)?[ \t]{1,4}(\d{4}))?(?!\d)`,
  'giud',
);
const EN_DMY_RE = new RegExp(
  String.raw`(?<![\d])(\d{1,2})(st|nd|rd|th)?[ \t]{1,4}(of[ \t]{1,4})?(${EN_TOKENS})(\.?)(?:(,)?[ \t]{1,4}(\d{4}))?(?![\d\p{L}])`,
  'giud',
);
const ES_RE = new RegExp(
  String.raw`(?<![\d])(\d{1,2})([º°]?)[ \t]{1,4}de[ \t]{1,4}(${ES_TOKENS})(?:[ \t]{1,4}(de|del)[ \t]{1,4}(\d{4}))?(?![\d\p{L}])`,
  'giud',
);

function daysIn(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function validDay(y: number | null, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y ?? 2000, m);
}

function caseOf(tok: string): DateFmt['monthCase'] {
  if (tok.length > 1 && tok === tok.toUpperCase()) return 'upper';
  if (tok[0] === tok[0]?.toLowerCase() && tok[0] !== tok[0]?.toUpperCase()) return 'lower';
  return 'cap';
}

function enMonth(tok: string): { m: number; abbrev: 0 | 3 | 4 } | null {
  const l = tok.toLowerCase();
  const full = EN_MONTHS.indexOf(l);
  if (full >= 0) return { m: full + 1, abbrev: 0 };
  const ab = EN_ABBREV[l];
  if (ab === undefined) return null;
  // Short forms need a capital, otherwise "mar 5 items" would read as a date.
  if (tok[0] !== tok[0]?.toUpperCase()) return null;
  return { m: ab, abbrev: l.length === 4 ? 4 : 3 };
}

export function detectDates(text: string, order: DateOrder): DateMatch[] {
  const out: DateMatch[] = [];

  for (const mt of text.matchAll(ISO_RE)) {
    const y = Number(mt[1]);
    const m = Number(mt[2]);
    const d = Number(mt[3]);
    if (y < 1900 || y > 2200 || !validDay(y, m, d)) continue;
    const [s, e] = mt.indices![0] as [number, number];
    out.push({ start: s, end: e, occ: { y, m, d, fmt: { ...baseFmt, style: 'iso' } } });
  }

  for (const mt of text.matchAll(NUM_RE)) {
    const sep = mt[2] as string;
    const ys = mt[4] as string;
    if (sep === '.' && ys.length !== 4) continue;
    const a = Number(mt[1]);
    const b = Number(mt[3]);
    let used: 'dmy' | 'mdy' = order;
    let d = order === 'dmy' ? a : b;
    let m = order === 'dmy' ? b : a;
    if (m > 12 && d <= 12) {
      [d, m] = [m, d];
      used = order === 'dmy' ? 'mdy' : 'dmy';
    }
    const y = ys.length === 2 ? 2000 + Number(ys) : Number(ys);
    if (!validDay(y, m, d)) continue;
    const pad = (mt[1] as string).length === 2 && (mt[3] as string).length === 2;
    const [s, e] = mt.indices![0] as [number, number];
    out.push({
      start: s,
      end: e,
      occ: { y, m, d, fmt: { ...baseFmt, style: 'num', order: used, sep, pad, yearDigits: ys.length === 2 ? 2 : 4 } },
    });
  }

  for (const mt of text.matchAll(EN_MDY_RE)) {
    const mo = enMonth(mt[1] as string);
    if (!mo) continue;
    const d = Number(mt[3]);
    const y = mt[6] ? Number(mt[6]) : null;
    if (!validDay(y, mo.m, d)) continue;
    const [s, e] = mt.indices![0] as [number, number];
    out.push({
      start: s,
      end: e,
      occ: {
        y, m: mo.m, d,
        fmt: {
          ...baseFmt, style: 'enMdy', yearDigits: y === null ? 0 : 4, monthCase: caseOf(mt[1] as string),
          abbrev: mo.abbrev, dot: mt[2] === '.', ordinal: Boolean(mt[4]), comma: Boolean(mt[5]),
        },
      },
    });
  }

  for (const mt of text.matchAll(EN_DMY_RE)) {
    const mo = enMonth(mt[4] as string);
    if (!mo) continue;
    const d = Number(mt[1]);
    const y = mt[7] ? Number(mt[7]) : null;
    if (!validDay(y, mo.m, d)) continue;
    const [s, e] = mt.indices![0] as [number, number];
    out.push({
      start: s,
      end: e,
      occ: {
        y, m: mo.m, d,
        fmt: {
          ...baseFmt, style: 'enDmy', yearDigits: y === null ? 0 : 4, monthCase: caseOf(mt[4] as string),
          abbrev: mo.abbrev, dot: mt[5] === '.', ordinal: Boolean(mt[2]), comma: Boolean(mt[6]), of: Boolean(mt[3]),
        },
      },
    });
  }

  for (const mt of text.matchAll(ES_RE)) {
    const m = ES_MONTHS.indexOf((mt[3] as string).toLowerCase()) + 1;
    const d = Number(mt[1]);
    const y = mt[5] ? Number(mt[5]) : null;
    if (!validDay(y, m, d)) continue;
    const [s, e] = mt.indices![0] as [number, number];
    out.push({
      start: s,
      end: e,
      occ: {
        y, m, d,
        fmt: {
          ...baseFmt, style: 'es', yearDigits: y === null ? 0 : 4, monthCase: caseOf(mt[3] as string),
          ordSign: (mt[2] as string) ?? '', yearLink: ((mt[4] as string | undefined) ?? 'de').toLowerCase(),
        },
      },
    });
  }

  return out;
}

export interface YMD {
  y: number;
  m: number;
  d: number;
}

export function shiftYmd(y: number, m: number, d: number, days: number): YMD {
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCFullYear(y, m - 1, d); // years below 100 would otherwise map to 19xx
  t.setUTCDate(t.getUTCDate() + days);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Shift a parsed date. Dates without a year use `refYear` and stay without one. */
export function shiftOcc(occ: DateOcc, days: number, refYear: number): DateOcc {
  const s = shiftYmd(occ.y ?? refYear, occ.m, occ.d, days);
  return { y: occ.y === null ? null : s.y, m: s.m, d: s.d, fmt: occ.fmt };
}

function ordinal(d: number): string {
  const v = d % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[d % 10] ?? 'th';
}

function monthName(f: DateFmt, m: number, es: boolean): string {
  let name = (es ? ES_MONTHS : EN_MONTHS)[m - 1] as string;
  if (!es && f.abbrev) name = f.abbrev === 4 && m === 9 ? 'sept' : name.slice(0, 3);
  if (f.dot) name += '.';
  if (f.monthCase === 'upper') return name.toUpperCase();
  if (f.monthCase === 'cap') return name[0]!.toUpperCase() + name.slice(1);
  return name;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

export function renderDate(o: DateOcc): string {
  const f = o.fmt;
  const yearStr = o.y === null ? '' : f.yearDigits === 2 ? p2(o.y % 100) : String(o.y);
  switch (f.style) {
    case 'iso':
      return `${o.y}-${p2(o.m)}-${p2(o.d)}`;
    case 'num': {
      const d = f.pad ? p2(o.d) : String(o.d);
      const m = f.pad ? p2(o.m) : String(o.m);
      return (f.order === 'dmy' ? [d, m, yearStr] : [m, d, yearStr]).join(f.sep);
    }
    case 'enMdy': {
      const day = `${o.d}${f.ordinal ? ordinal(o.d) : ''}`;
      const tail = o.y === null ? '' : `${f.comma ? ',' : ''} ${yearStr}`;
      return `${monthName(f, o.m, false)} ${day}${tail}`;
    }
    case 'enDmy': {
      const day = `${o.d}${f.ordinal ? ordinal(o.d) : ''}`;
      const tail = o.y === null ? '' : `${f.comma ? ',' : ''} ${yearStr}`;
      return `${day} ${f.of ? 'of ' : ''}${monthName(f, o.m, false)}${tail}`;
    }
    case 'es': {
      const tail = o.y === null ? '' : ` ${f.yearLink} ${yearStr}`;
      return `${o.d}${f.ordSign} de ${monthName(f, o.m, true)}${tail}`;
    }
  }
}

/** Stable identity of a date, for comparing without caring how it is written. */
export function dateKey(o: { y: number | null; m: number; d: number }): string {
  return `${o.y ?? '?'}-${o.m}-${o.d}`;
}

/** Other ways to write a date in format `f`, fewest changed fields first, then the earlier field listed changed. */
function otherFormats(f: DateFmt, hasYear: boolean): DateFmt[] {
  const flip = (b: boolean): boolean[] => [b, !b];
  const axes: Partial<{ [K in keyof DateFmt]: Array<DateFmt[K]> }> =
    f.style === 'enMdy' || f.style === 'enDmy'
      ? {
          ordinal: flip(f.ordinal),
          comma: hasYear ? flip(f.comma) : [f.comma],
          dot: flip(f.dot),
          of: f.style === 'enDmy' ? flip(f.of) : [f.of],
          style: [f.style, f.style === 'enDmy' ? 'enMdy' : 'enDmy'],
        }
      : f.style === 'es'
        ? { ordSign: [f.ordSign, ...['', 'º', '°'].filter((x) => x !== f.ordSign)], yearLink: hasYear ? [f.yearLink, f.yearLink === 'de' ? 'del' : 'de'] : [f.yearLink] }
        : f.style === 'num'
          ? {
              pad: flip(f.pad),
              sep: [f.sep, ...['/', '-', '.'].filter((x) => x !== f.sep)],
              yearDigits: [f.yearDigits, f.yearDigits === 2 ? 4 : 2],
              order: [f.order, f.order === 'dmy' ? 'mdy' : 'dmy'],
            }
          : {};
  let out: Array<{ fmt: DateFmt; changed: number }> = [{ fmt: f, changed: 0 }];
  for (const [field, values] of (Object.entries(axes) as Array<[keyof DateFmt, unknown[]]>).reverse()) {
    out = out.flatMap((x) => values.map((v, i) => ({ fmt: { ...x.fmt, [field]: v }, changed: x.changed + (i > 0 ? 1 : 0) })));
  }
  return out.filter((x) => x.changed > 0).sort((a, b) => a.changed - b.changed).map((x) => x.fmt);
}

/**
 * The fake for date `o`, already shifted. It is `renderDate(o)` unless `taken`
 * holds that string, then the first other spelling of the same date that is
 * free and reads back as that one date. Two spellings of one real date can render
 * the same ("1 Jun" and "1 June" both land on "11 May"), and each needs its own
 * fake to come back as written. Returns the plain rendering when every
 * spelling is taken; unblind reports that pair as a collision.
 */
export function freeDateFake(o: DateOcc, order: DateOrder, taken: (fake: string) => boolean): string {
  const plain = renderDate(o);
  if (!taken(plain)) return plain;
  for (const fmt of otherFormats(o.fmt, o.y !== null)) {
    const s = renderDate({ ...o, fmt });
    if (taken(s)) continue;
    const back = detectDates(s, order);
    if (back.length === 1 && back[0]!.start === 0 && back[0]!.end === s.length && dateKey(back[0]!.occ) === dateKey(o)) return s;
  }
  return plain;
}
