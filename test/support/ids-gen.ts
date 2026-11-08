/** Valid typed identifiers in the layouts people write them, for property P9. */
import fc from 'fast-check';
import { cifControl, dniLetter, luhnDigit, type IdScheme } from '../../src/ids.js';
import { digitString, pick, range, type Src } from './values.js';
import { srcFrom } from './gen.js';

export interface IdCase {
  scheme: IdScheme;
  value: string;
  /** The same identifier in another layout, when the scheme has one. */
  other?: string;
}

const group = (digits: string, sizes: number[], sep: string): string => {
  const out: string[] = [];
  let at = 0;
  for (const n of sizes) {
    out.push(digits.slice(at, at + n));
    at += n;
  }
  return out.join(sep);
};

const NETWORKS: Array<{ prefix: (s: Src) => string; len: number }> = [
  { prefix: () => '4', len: 16 },
  { prefix: () => '4', len: 13 },
  { prefix: (s) => `5${range(s, 1, 5)}`, len: 16 },
  { prefix: (s) => String(range(s, 2221, 2720)), len: 16 },
  { prefix: (s) => pick(s, ['34', '37']), len: 15 },
  { prefix: () => '6011', len: 16 },
  { prefix: (s) => `35${range(s, 28, 89)}`, len: 16 },
];

function card(s: Src): IdCase {
  const net = pick(s, NETWORKS);
  const head = net.prefix(s);
  const body = head + digitString(s, net.len - head.length - 1, false);
  const digits = body + luhnDigit(body);
  const sep = pick(s, ['', ' ', '-']);
  const sizes = net.len === 15 ? [4, 6, 5] : net.len === 16 ? [4, 4, 4, 4] : [net.len];
  return { scheme: 'card', value: sep ? group(digits, sizes, sep) : digits, other: digits };
}

function ssn(s: Src): IdCase {
  let area = range(s, 1, 899);
  if (area === 666) area = 665;
  const g = String(range(s, 1, 99)).padStart(2, '0');
  const n = String(range(s, 1, 9999)).padStart(4, '0');
  return { scheme: 'ssn', value: `${String(area).padStart(3, '0')}-${g}-${n}` };
}

function dni(s: Src): IdCase {
  const n = String(range(s, 10_000_000, 99_999_999));
  const c = n + dniLetter(Number(n));
  const value = pick(s, [c, `${n}-${c[8]}`, `${n.slice(0, 2)}.${n.slice(2, 5)}.${n.slice(5)}-${c[8]}`]);
  return { scheme: 'es-dni', value, other: c };
}

function nie(s: Src): IdCase {
  const p = pick(s, ['X', 'Y', 'Z']);
  const n = digitString(s, 7, false);
  const c = p + n + dniLetter({ X: 0, Y: 1, Z: 2 }[p]! * 1e7 + Number(n));
  return { scheme: 'es-nie', value: pick(s, [c, `${p}-${n}-${c[8]}`]), other: c };
}

function cifCompact(s: Src): string {
  const org = pick(s, [...'ABCDEFGHJNPQRSUVW']);
  const seven = digitString(s, 7, false);
  const ctl = cifControl(seven);
  const letter = 'NPQRSW'.includes(org) || (!'ABEH'.includes(org) && range(s, 0, 1) === 1);
  return org + seven + (letter ? 'JABCDEFGHI'[ctl] : String(ctl));
}

function cif(s: Src): IdCase {
  const c = cifCompact(s);
  return { scheme: 'es-cif', value: pick(s, [c, `${c[0]}-${c.slice(1)}`]), other: c };
}

function vat(s: Src): IdCase {
  const which = range(s, 0, 4);
  if (which === 0) return { scheme: 'eu-vat', value: `ES${cifCompact(s)}` };
  if (which === 1) {
    const n = String(range(s, 10_000_000, 99_999_999));
    return { scheme: 'eu-vat', value: `ES${n}${dniLetter(Number(n))}` };
  }
  if (which === 2) return { scheme: 'eu-vat', value: `DE${digitString(s, 9)}` };
  if (which === 3) return { scheme: 'eu-vat', value: `IT${digitString(s, 11)}` };
  return { scheme: 'eu-vat', value: `NL${digitString(s, 9)}B${digitString(s, 2, false)}` };
}

function ipv4(s: Src): IdCase {
  const octets = [range(s, 1, 223), range(s, 0, 255), range(s, 0, 255), range(s, 1, 254)];
  return { scheme: 'ipv4', value: octets.join('.') };
}

function ipv6(s: Src): IdCase {
  const groups = Array.from({ length: 8 }, (_, i) => (i === 0 ? range(s, 0x2001, 0x2fff) : range(s, 0, 0xffff)));
  const runAt = range(s, 1, 6);
  const runLen = range(s, 0, 7 - runAt);
  if (runLen >= 2) {
    const head = groups.slice(0, runAt).map((g) => g.toString(16));
    const tail = groups.slice(runAt + runLen).map((g) => g.toString(16));
    return { scheme: 'ipv6', value: `${head.join(':')}::${tail.join(':')}` };
  }
  return { scheme: 'ipv6', value: groups.map((g) => g.toString(16)).join(':') };
}

const MAKERS = [card, ssn, dni, nie, cif, vat, ipv4, ipv6];

export const idCase: fc.Arbitrary<IdCase> = fc.gen().map((g) => {
  const s = srcFrom(g);
  return pick(s, MAKERS)(s);
});
