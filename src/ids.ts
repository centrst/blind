/**
 * Typed identifiers: payment cards, US SSNs, Spanish DNI, NIE and CIF, EU VAT
 * numbers and IP addresses. Each scheme has a validator, so a match is a real
 * identifier and not any run of digits, and a generator whose fakes pass the
 * same validator and keep the part that says what the value is (card network,
 * NIE letter, CIF organisation type, VAT country). Recognizer patterns follow
 * Microsoft Presidio's (MIT) where it has one.
 */
import type { Rng } from './prng.js';

export type IdScheme = 'card' | 'ssn' | 'es-dni' | 'es-nie' | 'es-cif' | 'eu-vat' | 'ipv4' | 'ipv6';

export interface IdMeta {
  scheme: IdScheme;
}

export interface IdMatch {
  start: number;
  end: number;
  scheme: IdScheme;
}

/** Letters and digits only, upper case: the form validators and generators work on. */
export const compact = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '').toUpperCase();

const digitsOf = (s: string): number[] => [...s].map(Number);

// ------------------------------------------------------------------ checksums

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  digitsOf(digits)
    .reverse()
    .forEach((d, i) => {
      const x = i % 2 === 1 ? d * 2 : d;
      sum += x > 9 ? x - 9 : x;
    });
  return sum % 10 === 0;
}

/** The digit that makes `payload + digit` pass Luhn. */
export function luhnDigit(payload: string): string {
  let d = 0;
  while (!luhnValid(payload + d)) d++;
  return String(d);
}

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

export function dniLetter(num: number): string {
  return DNI_LETTERS[num % 23] as string;
}

const NIE_PREFIX: Record<string, number> = { X: 0, Y: 1, Z: 2 };

const CIF_LETTER_CONTROL = new Set(['N', 'P', 'Q', 'R', 'S', 'W']);
const CIF_DIGIT_CONTROL = new Set(['A', 'B', 'E', 'H']);
const CIF_ORG = 'ABCDEFGHJNPQRSUVW';

export function cifControl(seven: string): number {
  let sum = 0;
  digitsOf(seven).forEach((d, i) => {
    if (i % 2 === 1) sum += d;
    else {
      const x = d * 2;
      sum += Math.floor(x / 10) + (x % 10);
    }
  });
  return (10 - (sum % 10)) % 10;
}

// ------------------------------------------------------------------ validators

interface Network {
  test: RegExp;
  lengths: number[];
  /**
   * The leading digits of a fake, so it stays on the same network: the first
   * six digits of a test number the network or the big processors publish.
   * Those ranges are where test cards live, but no card range is reserved the
   * way phone ranges are, so a fake can still match an issued card.
   */
  prefix: string;
}

const NETWORKS: Network[] = [
  // Visa 4111 1111 1111 1111.
  { test: /^4/, lengths: [13, 16, 19], prefix: '411111' },
  // Mastercard 5555 5555 5555 4444 and 2223 0031 2200 3222.
  { test: /^5[1-5]/, lengths: [16], prefix: '555555' },
  { test: /^2(?:22[1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)/, lengths: [16], prefix: '222300' },
  // American Express 3782 822463 10005.
  { test: /^3[47]/, lengths: [15], prefix: '378282' },
  // Discover 6011 1111 1111 1117, for all three Discover ranges.
  { test: /^6011/, lengths: [16, 17, 18, 19], prefix: '601111' },
  { test: /^65/, lengths: [16, 17, 18, 19], prefix: '601111' },
  { test: /^64[4-9]/, lengths: [16, 17, 18, 19], prefix: '601111' },
  // JCB 3530 1113 3330 0000.
  { test: /^35(?:2[89]|[3-8]\d)/, lengths: [16, 17, 18, 19], prefix: '353011' },
  // Diners Club 3056 9309 0259 04.
  { test: /^3(?:0[0-5]|[68])/, lengths: [14, 15, 16, 17, 18, 19], prefix: '305693' },
];

const networkOf = (digits: string): Network | undefined =>
  NETWORKS.find((n) => n.test.test(digits) && n.lengths.includes(digits.length));

export function validCard(digits: string): boolean {
  return /^\d{13,19}$/.test(digits) && networkOf(digits) !== undefined && luhnValid(digits);
}

export function validSsn(c: string): boolean {
  const m = /^(\d{3})(\d{2})(\d{4})$/.exec(c);
  if (!m) return false;
  const area = Number(m[1]);
  return area !== 0 && area !== 666 && area < 900 && m[2] !== '00' && m[3] !== '0000';
}

export function validDni(c: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(c);
  return !!m && dniLetter(Number(m[1])) === m[2];
}

export function validNie(c: string): boolean {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(c);
  return !!m && dniLetter((NIE_PREFIX[m[1] as string] as number) * 1e7 + Number(m[2])) === m[3];
}

export function validCif(c: string): boolean {
  const m = /^([A-Z])(\d{7})([0-9A-J])$/.exec(c);
  if (!m || !CIF_ORG.includes(m[1] as string)) return false;
  const org = m[1] as string;
  const control = cifControl(m[2] as string);
  const asDigit = String(control);
  const asLetter = 'JABCDEFGHI'[control] as string;
  if (CIF_LETTER_CONTROL.has(org)) return m[3] === asLetter;
  if (CIF_DIGIT_CONTROL.has(org)) return m[3] === asDigit;
  return m[3] === asDigit || m[3] === asLetter;
}

/** VAT body shapes by country prefix. Spain is checked against NIF, NIE and CIF. */
const VAT_BODY: Record<string, RegExp> = {
  AT: /^U\d{8}$/,
  BE: /^[01]\d{9}$/,
  DE: /^\d{9}$/,
  DK: /^\d{8}$/,
  EL: /^\d{9}$/,
  FI: /^\d{8}$/,
  FR: /^[0-9A-HJ-NP-Z]{2}\d{9}$/,
  IE: /^\d{7}[A-W][A-I]?$/,
  IT: /^\d{11}$/,
  LU: /^\d{8}$/,
  NL: /^\d{9}B\d{2}$/,
  PL: /^\d{10}$/,
  PT: /^\d{9}$/,
  SE: /^\d{10}01$/,
};

export function validVat(c: string): boolean {
  const cc = c.slice(0, 2);
  const body = c.slice(2);
  if (cc === 'ES') return validDni(body) || validNie(body) || validCif(body);
  return VAT_BODY[cc]?.test(body) ?? false;
}

export function parseIpv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^(?:0|[1-9]\d{0,2})$/.test(p) || Number(p) > 255) return null;
    out.push(Number(p));
  }
  return out;
}

/** Eight 16-bit groups, or null. Accepts one `::` and no embedded IPv4. */
export function parseIpv6(s: string): number[] | null {
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const groups = (h: string): number[] | null => {
    if (h === '') return [];
    const out: number[] = [];
    for (const g of h.split(':')) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = groups(halves[0] as string);
  const tail = halves.length === 2 ? groups(halves[1] as string) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  if (head.length + tail.length > 7) return null;
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

// -------------------------------------------------------------------- detection

const SEP = String.raw`[ \-]`;
const CARD_RE = new RegExp(String.raw`(?<![\p{L}\p{N}\-.])\d{4}(?:${SEP}?\d{2,4}){2,4}(?:${SEP}?\d{1,3})?(?![\p{L}\p{N}]|[\-.]\d)`, 'gu');
const SSN_RE = /(?<![\p{L}\p{N}\-.])\d{3}-\d{2}-\d{4}(?![\p{L}\p{N}]|[-.]\d)/gu;
const DNI_RE = /(?<![\p{L}\p{N}\-.])\d{1,2}\.?\d{3}\.?\d{3}[ \-]?[A-Za-z](?![\p{L}\p{N}])/gu;
const NIE_RE = /(?<![\p{L}\p{N}\-.])[XYZxyz][ \-]?\d{7}[ \-]?[A-Za-z](?![\p{L}\p{N}])/gu;
const CIF_RE = /(?<![\p{L}\p{N}\-.])[A-Z][ \-]?\d{2}\.?\d{3}\.?\d{2}[ \-]?[0-9A-J](?![\p{L}\p{N}])/gu;
const VAT_RE = /(?<![\p{L}\p{N}\-.])(?:AT|BE|DE|DK|EL|ES|FI|FR|IE|IT|LU|NL|PL|PT|SE)[ \-]?[0-9A-Z][0-9A-Z \-.]{6,14}[0-9A-Z](?![\p{L}\p{N}])/gu;
const IPV4_RE = /(?<![\p{L}\p{N}_.])\d{1,3}(?:\.\d{1,3}){3}(?![\p{L}\p{N}_]|\.\d)/gu;
const IPV6_RE = /(?<![\p{L}\p{N}_:.])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\p{L}\p{N}_:]|\.\d)/gu;

function* matches(re: RegExp, text: string): Generator<{ start: number; raw: string }> {
  for (const m of text.matchAll(re)) yield { start: m.index!, raw: m[0] };
}

/** Every valid typed identifier in `text`, in order. Where two overlap the longer one is kept. */
export function detectIds(text: string): IdMatch[] {
  const out: IdMatch[] = [];
  const push = (start: number, raw: string, scheme: IdScheme): void => {
    out.push({ start, end: start + raw.length, scheme });
  };
  for (const { start, raw } of matches(CARD_RE, text)) {
    // The pattern can run on into a following number ("4111 1111 1111 1111 12/28"), so try
    // every prefix that ends between digit groups, longest first, and keep the first valid card.
    for (let end = raw.length; end >= 13; end--) {
      const next = raw[end];
      if (next !== undefined && /\d/.test(next)) continue;
      const cand = raw.slice(0, end);
      if (!/\d$/.test(cand)) continue;
      // One separator style throughout, as cards are printed.
      if (new Set(cand.replace(/\d/g, '')).size > 1) continue;
      if (validCard(cand.replace(/\D/g, ''))) {
        push(start, cand, 'card');
        break;
      }
    }
  }
  for (const { start, raw } of matches(SSN_RE, text)) if (validSsn(compact(raw))) push(start, raw, 'ssn');
  for (const { start, raw } of matches(DNI_RE, text)) {
    const c = compact(raw);
    // "pedido 12345678 a nombre de": a lower-case letter after a space is a word, not a control letter.
    if (/ [a-z]$/.test(raw)) continue;
    if (c.length === 9 && validDni(c)) push(start, raw, 'es-dni');
  }
  for (const { start, raw } of matches(NIE_RE, text)) if (validNie(compact(raw))) push(start, raw, 'es-nie');
  for (const { start, raw } of matches(CIF_RE, text)) if (validCif(compact(raw))) push(start, raw, 'es-cif');
  for (const m of text.matchAll(VAT_RE)) {
    // The body may run into following words; take the longest prefix that is a valid number.
    const raw = m[0];
    for (let end = raw.length; end >= 10; end--) {
      const cand = raw.slice(0, end);
      if (/[ \-.]$/.test(cand)) continue;
      const next = raw[end];
      if (next !== undefined && next !== ' ') continue;
      if (validVat(compact(cand))) {
        push(m.index!, cand, 'eu-vat');
        break;
      }
    }
  }
  for (const { start, raw } of matches(IPV4_RE, text)) if (parseIpv4(raw)) push(start, raw, 'ipv4');
  for (const { start, raw } of matches(IPV6_RE, text)) {
    // Two written groups at least, so "::" in code or prose is not an address.
    if (raw.split(':').filter(Boolean).length < 2 || raw.length < 6) continue;
    if (parseIpv6(raw)) push(start, raw, 'ipv6');
  }
  // "ES 12345678Z" is a VAT number that holds a DNI: keep the longer match.
  const kept: IdMatch[] = [];
  for (const m of out.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
    if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  }
  return kept.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------- generation

const randDigits = (rng: Rng, n: number, firstNonZero = false): string => {
  let s = '';
  for (let i = 0; i < n; i++) s += String(rng.digit(i === 0 && firstNonZero ? 1 : 0));
  return s;
};

/** Put the letters and digits of `fake` into the separator layout of `raw`. */
export function renderLike(raw: string, fake: string): string {
  let i = 0;
  let out = '';
  for (const ch of raw) {
    if (/[0-9A-Za-z]/.test(ch)) {
      const f = fake[i++] ?? ch;
      out += ch === ch.toLowerCase() && ch !== ch.toUpperCase() ? f.toLowerCase() : f;
    } else out += ch;
  }
  return out;
}

function fakeCard(real: string, rng: Rng): string {
  const { prefix } = networkOf(real) as Network;
  return prefix + randDigits(rng, real.length - prefix.length - 1);
}

function fakeDni(rng: Rng): string {
  const n = randDigits(rng, 8);
  return n + dniLetter(Number(n));
}

function fakeNie(real: string, rng: Rng): string {
  const p = real[0] as string;
  const n = randDigits(rng, 7);
  return p + n + dniLetter((NIE_PREFIX[p] as number) * 1e7 + Number(n));
}

function fakeCif(real: string, rng: Rng): string {
  const org = real[0] as string;
  const seven = randDigits(rng, 7);
  const control = cifControl(seven);
  const letter = /[A-J]/.test(real[8] as string);
  return org + seven + (letter ? ('JABCDEFGHI'[control] as string) : String(control));
}

function fakeVat(real: string, rng: Rng): string {
  const cc = real.slice(0, 2);
  const body = real.slice(2);
  if (cc === 'ES') {
    if (validDni(body)) return cc + fakeDni(rng);
    if (validNie(body)) return cc + fakeNie(body, rng);
    return cc + fakeCif(body, rng);
  }
  if (cc === 'SE') return `${cc}${randDigits(rng, 10, true)}01`;
  let out = cc;
  for (const ch of body) out += /\d/.test(ch) ? String(rng.digit()) : ch;
  return out;
}

function fakeSsn(rng: Rng): string {
  let area = rng.range(1, 899);
  if (area === 666) area = 667;
  return String(area).padStart(3, '0') + String(rng.range(1, 99)).padStart(2, '0') + String(rng.range(1, 9999)).padStart(4, '0');
}

const TEST_NETS = ['192.0.2', '198.51.100', '203.0.113'];

/** IPv4 documentation ranges (RFC 5737), so a fake address never names a real host. */
export function fakeIpv4(rng: Rng): string {
  return `${rng.pick(TEST_NETS)}.${rng.range(1, 254)}`;
}

/** The IPv6 documentation prefix 2001:db8::/32 (RFC 3849), full form. */
export function fakeIpv6(rng: Rng): string {
  const groups = ['2001', 'db8'];
  for (let i = 0; i < 6; i++) groups.push(rng.range(1, 0xffff).toString(16));
  return groups.join(':');
}

/**
 * A fake for `raw` under `scheme`, rendered in the layout of `raw`. Retries
 * until the fake differs from the original.
 */
export function fakeId(raw: string, scheme: IdScheme, rng: Rng): string {
  if (scheme === 'ipv4') return fakeIpv4(rng);
  if (scheme === 'ipv6') return fakeIpv6(rng);
  const real = compact(raw);
  for (let attempt = 0; attempt < 20; attempt++) {
    let c: string;
    switch (scheme) {
      case 'card':
        c = fakeCard(real, rng);
        c += luhnDigit(c);
        break;
      case 'ssn':
        c = fakeSsn(rng);
        break;
      case 'es-dni':
        c = fakeDni(rng);
        break;
      case 'es-nie':
        c = fakeNie(real, rng);
        break;
      case 'es-cif':
        c = fakeCif(real, rng);
        break;
      default:
        c = fakeVat(real, rng);
    }
    if (c !== real) return renderLike(raw, c);
  }
  return renderLike(raw, real);
}

/** True when `raw` passes the validator for `scheme`. Used by tests and the fakes. */
export function validId(raw: string, scheme: IdScheme): boolean {
  const c = compact(raw);
  switch (scheme) {
    case 'card':
      return validCard(c);
    case 'ssn':
      return validSsn(c);
    case 'es-dni':
      return validDni(c);
    case 'es-nie':
      return validNie(c);
    case 'es-cif':
      return validCif(c);
    case 'eu-vat':
      return validVat(c);
    case 'ipv4':
      return parseIpv4(raw) !== null;
    default:
      return parseIpv6(raw) !== null;
  }
}
