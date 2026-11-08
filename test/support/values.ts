/**
 * Synthetic value makers. Every value is invented. Each maker draws from a
 * `Src`, so the same code feeds fast-check (through `fc.gen`) and the
 * deterministic corpus generator (through its own seeded CorpusRng).
 */
import { IBAN_LENGTHS } from '../../src/names.js';

export interface Src {
  /** Uniform integer in [0, n). n >= 1. */
  int(n: number): number;
}

export const pick = <T>(s: Src, a: readonly T[]): T => a[s.int(a.length)] as T;
export const chance = (s: Src, pct: number): boolean => s.int(100) < pct;
export const range = (s: Src, min: number, max: number): number => min + s.int(max - min + 1);
export const digitString = (s: Src, n: number, noLeadingZero = true): string => {
  let out = '';
  for (let i = 0; i < n; i++) out += String(i === 0 && noLeadingZero ? range(s, 1, 9) : s.int(10));
  return out;
};
const upper = (s: Src, n: number): string => {
  let out = '';
  for (let i = 0; i < n; i++) out += String.fromCharCode(65 + s.int(26));
  return out;
};
export const plain = (v: string): string =>
  v.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export type Lang = 'en' | 'es';

// ------------------------------------------------------------------ people

export const FIRST_ES = [
  'Joaquín', 'Pilar', 'Rosendo', 'Aurora', 'Ernesto', 'Leonor', 'Facundo', 'Gloria', 'Anselmo', 'Belén',
  'Cayetano', 'Dolores', 'Eloy', 'Fermina', 'Genaro', 'Herminia', 'Isidro', 'Jacinta', 'Lisandro', 'Macarena',
  'Nicolás', 'Ofelia', 'Plácido', 'Remedios', 'Saturnino', 'Trinidad', 'Ulises', 'Verónica', 'Wenceslao',
  'Amparo', 'Baldomero', 'Candelaria', 'Demetrio', 'Estefanía', 'Florencio', 'Griselda', 'Honorio', 'Itziar',
];
export const FIRST_EN = [
  'Harold', 'Priscilla', 'Winston', 'Delphine', 'Gareth', 'Imogen', 'Percival', 'Rosalind', 'Cedric', 'Phoebe',
  'Lionel', 'Matilda', 'Ambrose', 'Georgina', 'Humphrey', 'Isadora', 'Jasper', 'Lavinia', 'Nigel', 'Odette',
  'Quentin', 'Rowena', 'Sebastian', 'Tamsin', 'Valentine', 'Wilhelmina', 'Barnaby', 'Cordelia', 'Desmond',
  'Eleanor', 'Frederick', 'Gwendolyn',
];
export const LAST_ES = [
  'Arroyo', 'Bustamante', 'Cifuentes', 'Duarte', 'Espinosa', 'Figueroa', 'Galindo', 'Hidalgo', 'Iglesias',
  'Jaramillo', 'Quintana', 'Rebollo', 'Zamora', 'Villalobos', 'Sepúlveda', 'Peñalver', 'Ocaña', 'Navarrete',
  'Medrano', 'Lazcano', 'Urrutia', 'Echeverría', 'Maldonado', 'Olmos', 'Tejada', 'Barragán', 'Cuesta', 'Fontán',
  'de la Torre', 'del Río', 'de Lara',
];
export const LAST_EN = [
  'Ashworth', 'Bellamy', 'Cartwright', 'Doherty', 'Ellsworth', 'Fairchild', 'Goodwin', 'Haverford', 'Ingram',
  'Jessop', 'Kingsley', 'Lambert', 'Mortimer', 'Nightingale', 'Oakley', 'Pritchard', 'Quigley', 'Rutherford',
  'Somerset', 'Tennant', 'Upshaw', 'Vanderbilt', 'Whitcombe', 'Yardley', 'Abernathy', 'Blackwood', 'Crawley',
];

export interface Person {
  first: string;
  last: string;
  full: string;
}

export function makePerson(s: Src, lang: Lang, taken: Set<string> = new Set()): Person {
  for (let i = 0; i < 50; i++) {
    const first = pick(s, lang === 'es' ? FIRST_ES : FIRST_EN);
    const last = pick(s, lang === 'es' ? LAST_ES : LAST_EN);
    const last2 = lang === 'es' && !last.includes(' ') && chance(s, 30) ? pick(s, LAST_ES.filter((l) => !l.includes(' '))) : '';
    const full = `${first} ${last}${last2 && last2 !== last ? ` ${last2}` : ''}`;
    const toks = full.toLowerCase().split(' ');
    if (toks.some((t) => taken.has(t))) continue;
    toks.forEach((t) => taken.add(t));
    return { first, last: `${last}${last2 && last2 !== last ? ` ${last2}` : ''}`, full };
  }
  return { first: 'Zacarías', last: 'Quevedo', full: 'Zacarías Quevedo' };
}

// -------------------------------------------------------------------- orgs

export const ORG_BASE = [
  'Aldara', 'Bruma', 'Cendal', 'Dorsal', 'Esquilo', 'Farola', 'Galeón', 'Hontanar', 'Isleta', 'Jaspe', 'Kepler',
  'Lumbre', 'Marisma', 'Nevada', 'Ocaso', 'Pinar', 'Quimera', 'Rastro', 'Sotavento', 'Tramuntana', 'Umbral',
  'Vendaval', 'Wicker', 'Yelmo', 'Zafiro', 'Ironbridge', 'Foxglove', 'Larkspur', 'Millstone', 'Pennywhistle',
];
const ORG_NOUN_ES = ['Asesores', 'Gestión', 'Consultores', 'Ingeniería', 'Logística', 'Reformas', 'Transportes', 'Estudio', 'Servicios', 'Clínica'];
const ORG_NOUN_EN = ['Consulting', 'Partners', 'Holdings', 'Labs', 'Studio', 'Logistics', 'Supply', 'Advisory', 'Works', 'Systems'];
const ORG_SUFFIX_ES = ['S.L.', 'S.A.', 'S.L.U.'];
const ORG_SUFFIX_EN = ['Inc.', 'LLC', 'Ltd', 'GmbH'];

export interface Org {
  name: string;
  slug: string;
}

export function makeOrg(s: Src, lang: Lang, taken: Set<string> = new Set()): Org {
  for (let i = 0; i < 50; i++) {
    const base = pick(s, ORG_BASE);
    const noun = pick(s, lang === 'es' ? ORG_NOUN_ES : ORG_NOUN_EN);
    const core = lang === 'es' || chance(s, 30) ? `${noun} ${base}` : `${base} ${noun}`;
    const suffix = chance(s, 50) ? ` ${pick(s, lang === 'es' ? ORG_SUFFIX_ES : ORG_SUFFIX_EN)}` : '';
    const toks = core.toLowerCase().split(' ');
    if (toks.some((t) => taken.has(t))) continue;
    toks.forEach((t) => taken.add(t));
    return { name: core + suffix, slug: plain(core) };
  }
  return { name: 'Kestrel Ventures Inc.', slug: 'kestrel-ventures' };
}

export const PLACE_ES = ['Valdecañas', 'Torrebruna', 'Almendral del Sur', 'Villaluenga Alta', 'Cabo Redondo', 'Puente Nuevo', 'San Telmo de Abajo', 'Montefrío Chico'];
export const PLACE_EN = ['Springvale', 'Harlow Cross', 'Oakmere', 'Brindleton', 'Ashford Reach', 'Stonebridge', 'Maple Hollow', 'Fenwick Bay'];
export function makePlace(s: Src, lang: Lang): string {
  return pick(s, lang === 'es' ? PLACE_ES : PLACE_EN);
}

// ----------------------------------------------------------------- contact

// Fixture mailboxes nobody can own. An address under a reserved name (RFC 2606
// and RFC 6761: .example, .test, .invalid, .localhost, example.com/.net/.org)
// is safe as it is. An address at a real provider keeps the provider, since
// blind treats consumer mail differently from company mail, but gets a local
// part the provider can never issue:
// - Gmail (gmail.com, googlemail.com): an underscore or a dash. Google's
//   username rules say a Gmail username can't contain an underscore (_) or a
//   dash (-) (support.google.com/mail/answer/9211434). Gmail ignores dots, so
//   a doubled dot is not used there.
// - Any other host: two dots in a row. RFC 5322 section 3.4.1 allows a dot in
//   an unquoted local part only between two other characters, so no provider
//   can hand out `ana..ruiz`.

const RESERVED_HOST = /(?:^|\.)(?:example|test|invalid|localhost)$|^example\.(?:com|net|org)$/;
const GMAIL = new Set(['gmail.com', 'googlemail.com']);

/** True when no one can own `local@host`. */
export function unownableMailbox(local: string, host: string): boolean {
  const h = host.toLowerCase();
  if (RESERVED_HOST.test(h)) return true;
  return GMAIL.has(h) ? /[_-]/.test(local) : local.includes('..');
}

export function makeEmail(s: Src, p: Person, host: string): string {
  const f = plain(p.first).replace(/-/g, '');
  const l = plain(p.last.split(' ')[0] ?? p.last).replace(/-/g, '');
  const h = host.toLowerCase();
  const sep = RESERVED_HOST.test(h) ? '' : GMAIL.has(h) ? '_' : '..';
  // blind keeps a run of one or two letters as it is, so "l..de" would come out unchanged. Use a surname word past "de".
  const w = plain(p.last.split(' ').find((x) => x.length > 2) ?? l).replace(/-/g, '');
  const local = sep
    ? pick(s, [`${f}${sep}${w}`, `${f[0]}${sep}${w}`, `${w}${sep}${f}`, `${f}${sep}${w.slice(0, 3)}`, GMAIL.has(h) ? `${f}-${w}` : `${f}${sep}${f[0]}${w}`, `${f.slice(0, 3)}${sep}${w}`])
    : pick(s, [`${f}.${l}`, `${f[0]}${l}`, f, `${f}${l}`, `${f}_${l}`, `${l}.${f}`]);
  return `${local}@${host}`;
}

// Fixture phones sit in ranges no subscriber can hold:
// - North America: NXX-555-0100 to 0199, reserved for fictional use (NANPA).
// - UK: 07700 900000 to 900999, and the landline drama ranges 020 7946 0xxx,
//   011x 496 0xxx and 01x1 496 0xxx (Ofcom, numbers for TV and radio drama).
// - Spain: 75 to 79 as the first two digits. The ministerial resolution that
//   opened the 7 range to mobiles (BOE-A-2010-5251) attributes 71 to 74 and
//   keeps 7X with X from 5 to 9 in reserve, so no line holds one. Spain has no
//   fictional landline range, so fixture Spanish numbers are all in this one.
// - Germany: +49 171 39200 00 to 99, numbers the Bundesnetzagentur lists for
//   use in media ("Drama Numbers").

/** True when `raw`, a phone as written, is in one of the ranges above. */
export function reservedPhone(raw: string): boolean {
  const d = raw.replace(/\D/g, '').replace(/^00/, '');
  return (
    /^1?[2-9]\d{2}55501\d{2}$/.test(d) ||
    /^(?:44|0)(?:7700900\d{3}|2079460\d{3}|11[3-8]4960\d{3}|1[2-6]14960\d{3})$/.test(d) ||
    /^(?:34)?7[5-9]\d{7}$/.test(d) ||
    /^(?:49|0)17139200\d{2}$/.test(d)
  );
}

/**
 * A fixture phone in one of the ranges above. Each layout draws as many values
 * as the live layout it replaced, so the rest of the generated corpus did not
 * move when the numbers did.
 */
export function makePhone(s: Src): string {
  const d = (n: number): string => digitString(s, n, false);
  const m7 = (): string => {
    const a = range(s, 6, 7) - 6;
    const b = Number(d(1));
    return `7${5 + ((a * 5 + b) % 5)}${d(1)}`;
  };
  const area = (): string => `${range(s, 2, 9)}${d(2)}`;
  const exchange = (): string => {
    range(s, 2, 9);
    d(2);
    return '555';
  };
  const line = (): string => `01${d(4).slice(2)}`;
  switch (s.int(10)) {
    case 0: return `+34 ${m7()} ${d(3)} ${d(3)}`;
    case 1: return `+34 ${m7()}${d(6)}`;
    case 2: return `${m7()} ${d(3)} ${d(3)}`;
    case 3: return `${m7()} ${d(2)} ${d(2)} ${d(2)}`;
    case 4: return `(${area()}) ${exchange()}-${line()}`;
    case 5: return `${area()}-${exchange()}-${line()}`;
    case 6: return `+1 ${area()} ${exchange()} ${line()}`;
    case 7: return `+44 7700 900${d(9).slice(6)}`;
    case 8: return `+49 171 392 00${d(8).slice(6)}`;
    default: return `0034 ${m7()} ${d(3)} ${d(3)}`;
  }
}

function ibanCheck(country: string, bban: string): string {
  const num = (bban + country + '00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return String(98 - Number(BigInt(num) % 97n)).padStart(2, '0');
}

export function ibanValid(iban: string): boolean {
  const c = iban.replace(/\s/g, '').toUpperCase();
  const num = (c.slice(4) + c.slice(0, 4)).replace(/[A-Z]/g, (x) => String(x.charCodeAt(0) - 55));
  return BigInt(num) % 97n === 1n;
}

export function makeIban(s: Src): string {
  const country = pick(s, ['ES', 'ES', 'ES', 'DE', 'FR', 'IT', 'PT', 'NL', 'GB']);
  const len = IBAN_LENGTHS[country] as number;
  let bban = '';
  const letters = country === 'GB' || country === 'NL' ? 4 : 0;
  bban += upper(s, letters);
  bban += digitString(s, len - 4 - letters, false);
  const compact = country + ibanCheck(country, bban) + bban;
  return chance(s, 70) ? (compact.match(/.{1,4}/g) as string[]).join(' ') : compact;
}

export function makeId(s: Src): { value: string; label: string } {
  const year = range(s, 2023, 2027);
  switch (s.int(8)) {
    case 0: return { value: `INV-${year}-${digitString(s, 6, false)}`, label: 'invoice' };
    case 1: return { value: `FAC/${year}/${digitString(s, 4, false)}`, label: 'invoice' };
    case 2: return { value: digitString(s, 8), label: 'reference' };
    case 3: return { value: `${digitString(s, 8)}${upper(s, 1)}`, label: 'dni' };
    case 4: return { value: `${pick(s, ['X', 'Y', 'Z'])}${digitString(s, 7, false)}${upper(s, 1)}`, label: 'nie' };
    case 5: return { value: `BK${upper(s, 1)}${digitString(s, 4, false)}${upper(s, 2)}`, label: 'booking' };
    case 6: return { value: `EXP-${year}-${digitString(s, 4, false)}`, label: 'case' };
    default: return { value: `${upper(s, 2)}${digitString(s, 9)}`, label: 'tracking' };
  }
}

// ----------------------------------------------------------------- amounts

export type AmountStyle = 'eu' | 'us';

function group(int: string, sep: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Render minor units (cents) in a given style. `style` fixes the currency habit too. */
export function renderAmount(minor: number, s: Src, style: AmountStyle, forceCents = false): string {
  const whole = Math.floor(minor / 100);
  const cents = String(minor % 100).padStart(2, '0');
  if (style === 'eu') {
    const useThou = whole >= 1000 && chance(s, 80);
    const int = useThou ? group(String(whole), '.') : String(whole);
    const num = `${int},${cents}`;
    switch (s.int(4)) {
      case 0: return `${num} €`;
      case 1: return `${num} €`;
      case 2: return `€ ${num}`;
      default: return `${num} EUR`;
    }
  }
  const int = whole >= 1000 ? group(String(whole), ',') : String(whole);
  const num = `${int}.${cents}`;
  switch (s.int(4)) {
    case 0: return `$${num}`;
    case 1: return `USD ${num}`;
    case 2: return `£${num}`;
    default: return forceCents ? `$${num}` : `${num} USD`;
  }
}

export function makeMinor(s: Src, max = 250000): number {
  const bucket = s.int(4);
  const top = bucket === 0 ? 5000 : bucket === 1 ? 50000 : max;
  return range(s, 100, top);
}

// ------------------------------------------------------------------- dates

const MONTH_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const dim = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export interface DateDraw {
  y: number;
  m: number;
  d: number;
}

export function makeYmd(s: Src): DateDraw {
  const y = range(s, 2024, 2027);
  const m = range(s, 1, 12);
  return { y, m, d: range(s, 1, dim(y, m)) };
}

const ord = (d: number): string => {
  const v = d % 100;
  if (v >= 11 && v <= 13) return 'th';
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[d % 10] ?? 'th';
};

export type DateStyle = 'iso' | 'num' | 'enMdy' | 'enDmy' | 'es';

/** Render a date as text. `order` applies to numeric dates. */
export function renderDateText(s: Src, dt: DateDraw, style: DateStyle, order: 'dmy' | 'mdy', withYear = true): string {
  const { y, m, d } = dt;
  const p2 = (n: number): string => String(n).padStart(2, '0');
  switch (style) {
    case 'iso':
      return `${y}-${p2(m)}-${p2(d)}`;
    case 'num': {
      const sep = pick(s, ['/', '/', '-', '.']);
      const pad = chance(s, 60);
      const dd = pad ? p2(d) : String(d);
      const mm = pad ? p2(m) : String(m);
      const yy = sep !== '.' && chance(s, 25) ? p2(y % 100) : String(y);
      return (order === 'dmy' ? [dd, mm, yy] : [mm, dd, yy]).join(sep);
    }
    case 'enMdy': {
      const full = MONTH_EN[m - 1] as string;
      const mon = chance(s, 30) ? (m === 9 && chance(s, 30) ? 'Sept' : full.slice(0, 3)) + (full.length > 3 && chance(s, 50) ? '.' : '') : full;
      const month = m === 5 && mon.length === 3 ? 'May' : mon;
      const cased = chance(s, 10) ? month.toUpperCase() : month;
      const day = `${d}${chance(s, 25) ? ord(d) : ''}`;
      return withYear ? `${cased} ${day}${chance(s, 70) ? ',' : ''} ${y}` : `${cased} ${day}`;
    }
    case 'enDmy': {
      const full = MONTH_EN[m - 1] as string;
      const month = chance(s, 25) ? (m === 5 ? 'May' : full.slice(0, 3)) : full;
      const useOrd = chance(s, 25);
      const day = `${d}${useOrd ? ord(d) : ''}`;
      const of = useOrd && chance(s, 50) ? 'of ' : '';
      return withYear ? `${day} ${of}${month}${chance(s, 25) ? ',' : ''} ${y}` : `${day} ${of}${month}`;
    }
    case 'es': {
      const mes = MONTH_ES[m - 1] as string;
      const day = `${d}${d === 1 && chance(s, 20) ? 'º' : ''}`;
      const core = `${day} de ${chance(s, 8) ? mes.toUpperCase() : mes}`;
      return withYear ? `${core} ${pick(s, ['de', 'de', 'del'])} ${y}` : core;
    }
  }
}

export const DATE_STYLES: DateStyle[] = ['iso', 'num', 'enMdy', 'enDmy', 'es'];
