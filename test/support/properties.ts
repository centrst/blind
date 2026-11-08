/**
 * The property suite P1 to P20. Each property is a function so the same checks
 * run in the normal suite and again under the no-network patches (N1). The
 * six files in test/properties/ hold them in groups of about equal running
 * time, so Vitest spreads them over its workers: in a single file they ran one
 * after another, and that file alone set how long `pnpm test` took. Not one
 * file per property, because a fresh worker pays its own warm-up for each.
 */
import fc from 'fast-check';
import { detectAmounts } from '../../src/amounts.js';
import { detectDates, EN_MONTHS, ES_MONTHS, shiftYmd } from '../../src/dates.js';
import { stopWordValue } from '../../src/detect.js';
import { assertNoLeaks, blind, checkMapping, createUnblinder, LeakError, unblind } from '../../src/index.js';
import { FAKES, PARTICLES, type Lang } from '../../src/names.js';
import { containsWord } from './corpus.js';
import { emailCase, relationCase, seedArb, shapeCase, srcFrom, toCase, type Case } from './gen.js';
import { CATEGORIES, genEmail } from './templates.js';
import { chance, digitString, FIRST_EN, FIRST_ES, ibanValid, LAST_EN, LAST_ES, makeEmail, makeOrg, makePerson, makePhone, pick, plain, range, renderAmount } from './values.js';
import { idCase } from './ids-gen.js';
import { compact, validId } from '../../src/ids.js';
import type { Detector, KnownValue, Mapping, Pair, ReplaceWith, Span } from '../../src/types.js';

export const numRuns = (): number => Number(process.env.NUM_RUNS ?? 2000);
export const seedOf = (): number => Number(process.env.SEED ?? 1) | 0;

/**
 * The timeout of every property, instead of the 120 s in vitest.config.ts. At
 * 2,000 cases the slowest (P10) takes about 50 s on an idle 6-core machine and
 * P1 has passed 120 s under load; at 20,000 cases P3, P5, P6 and P8 take 185 to
 * 320 s. LONG is over ten times the slowest time measured and grows with
 * NUM_RUNS so test:deep keeps the same margin. TESTING.md has the measurements.
 */
export const LONG = 600_000 * Math.max(1, numRuns() / 2000);

export function params(extra: Partial<fc.Parameters<unknown>> = {}): fc.Parameters<unknown> {
  return { numRuns: numRuns(), seed: seedOf(), ...(process.env.FC_PATH ? { path: process.env.FC_PATH } : {}), ...extra };
}

/** True when `message` holds an 8-character slice of any of `inputs`. */
export function quotes(message: string, inputs: readonly string[]): boolean {
  for (const t of inputs) for (let i = 0; i + 8 <= t.length; i++) if (message.includes(t.slice(i, i + 8))) return true;
  return false;
}

/** Every string inside a generated value, and every number written out, to check a message against. */
function textsIn(v: unknown, out: string[] = [], depth = 0): string[] {
  if (typeof v === 'string') out.push(v);
  else if (typeof v === 'number' || typeof v === 'bigint') out.push(String(v));
  else if (v && typeof v === 'object' && depth < 8) for (const x of Object.values(v)) textsIn(x, out, depth + 1);
  return out;
}

/** The kind and length of a generated argument, never its text. */
export function shapeOf(v: unknown): string {
  if (typeof v === 'string') return `string of ${v.length}`;
  if (Array.isArray(v)) return `array of ${v.length}`;
  if (v === null) return 'null';
  if (typeof v === 'object') return `object of ${Object.keys(v).length} keys`;
  return typeof v;
}

/**
 * The cause of a failure as a message that quotes nothing generated. A message
 * that holds an 8-character slice of the counterexample, six digits in a row
 * (separators allowed between them) or an `@` is withheld, since it may quote
 * a value or a fake of one.
 */
function causeOf(error: unknown, counterexample: unknown): string {
  if (error === undefined || error === null) return 'the property returned false';
  if (!(error instanceof Error)) return `the property threw a ${typeof error}`;
  const m = error.message;
  if (quotes(m, textsIn(counterexample)) || /\d(?:[\s().\/-]*\d){5}/.test(m) || m.includes('@')) {
    return `${error.name} with a message of ${m.length} characters, withheld because it may quote a generated value`;
  }
  return `${error.name}: ${m}`;
}

/**
 * Runs a property and re-throws a failure with the replay command up front.
 * Generated inputs may fall in live ranges (phones, cards, IBANs, ids, IP
 * addresses), so the failure names the seed, the path and the kind and length
 * of each argument, never the generated text. Replay the seed and path under
 * a debugger to see the value.
 */
export function check(property: fc.IPropertyWithHooks<unknown[]>, extra: Partial<fc.Parameters<unknown>> = {}): void {
  const p = params(extra);
  const r = fc.check(property as fc.IProperty<unknown[]>, p as fc.Parameters<unknown[]>);
  if (!r.failed) return;
  const args = r.counterexample ?? [];
  throw new Error(
    `property failed after ${r.numRuns} runs and ${r.numShrinks} shrinks. Replay with SEED=${p.seed} NUM_RUNS=${p.numRuns} FC_PATH=${r.counterexamplePath ?? ''}\n` +
      `cause: ${causeOf(r.errorInstance, args)}\ncounterexample: ${args.map(shapeOf).join(', ') || 'none'} (values not shown)`,
  );
}

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const NOW = new Date('2026-06-01T00:00:00Z');

const numericPart = (v: string): string => /\d[\d.,]*\d|\d/.exec(v)?.[0] ?? v;

/**
 * Returns the inserted values still present in `out`. A date or amount that
 * shows up only because it is (part of) the fake of another real value does
 * not count, so those fakes are masked before looking.
 */
export function survivors(c: Case, out: string, pairs: Array<{ kind: string; fake: string }>): string[] {
  let masked = out;
  const fakes = pairs.filter((p) => p.kind === 'date' || p.kind === 'amount').map((p) => p.fake).sort((x, y) => y.length - x.length);
  for (const f of fakes) masked = masked.split(f).join('\u0000');
  const left: string[] = [];
  for (const sp of c.spans) {
    if (sp.kind === 'person') {
      const toks = sp.value.split(/\s+/).filter((t) => t.length >= 2 && !PARTICLES.has(t.toLowerCase()));
      for (const t of toks) if (containsWord(out, t)) left.push(`person:${t.length}`);
    } else if (sp.kind === 'amount') {
      if (containsWord(masked, numericPart(sp.value))) left.push('amount');
    } else if (sp.kind === 'date') {
      if (containsWord(masked, sp.value)) left.push('date');
    } else if (containsWord(out, sp.value)) left.push(sp.kind);
  }
  return left;
}

// -------------------------------------------------------------------- P1

/**
 * The round trip is exact. The one case blind cannot avoid, every spelling of
 * a date already taken, would show in `collisions`, so that must stay empty.
 */
function roundTrips(back: { text: string; collisions: unknown[] }, text: string, what: string): void {
  if (back.collisions.length) throw new Error(`${what}: unblind reported ${back.collisions.length} collisions`);
  if (back.text !== text) throw new Error(`${what} did not round trip`);
}

export function p1RoundTrip(): void {
  check(
    fc.property(fc.array(emailCase, { minLength: 1, maxLength: 3 }), seedArb, (cases, seed) => {
      const texts = cases.map((c) => c.text);
      const known = dedupe(cases.flatMap((c) => c.known));
      const res = blind(texts, { known, seed, now: NOW, dateOrder: cases[0]!.dateOrder });
      res.texts.forEach((t, i) => {
        if (res.collisions.length) throw new Error(`blind reported ${res.collisions.length} collisions`);
        roundTrips(unblind(t, JSON.parse(JSON.stringify(res.mapping))), texts[i] as string, `text ${i}`);
      });
    }),
  );
}

// -------------------------------------------------------------------- P2

export function p2NoSurvivors(): void {
  check(
    fc.property(emailCase, seedArb, (c, seed) => {
      const res = blind([c.text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder });
      const left = survivors(c, res.texts[0] as string, res.mapping.pairs);
      if (left.length) throw new Error(`still in the blind text: ${left.join(', ')}`);
    }),
  );
}

// -------------------------------------------------------------------- P3

function dedupe(known: KnownValue[]): KnownValue[] {
  const seen = new Set<string>();
  return known.filter((k) => {
    const key = `${k.kind}|${k.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const recase = (v: string, mode: number): string => (mode === 0 ? v.toUpperCase() : mode === 1 ? v.toLowerCase() : v);

export function p3KnownAndDeny(): void {
  const mode = fc.integer({ min: 0, max: 2 });
  check(
    fc.property(emailCase, seedArb, fc.array(mode, { minLength: 1, maxLength: 4 }), fc.nat(5), (c, seed, modes, pick) => {
      // Re-case some known values inside the text, then ask for them again.
      let text = c.text;
      const known = c.known.filter((k) => k.kind !== 'place' || text.includes(k.value));
      known.forEach((k, i) => {
        const m = modes[i % modes.length] as number;
        text = text.split(k.value).join(recase(k.value, m));
      });
      // Deny entries: a planted codeword, an org, and a whole mail domain.
      const emails = c.spans.filter((s) => s.kind === 'email').map((s) => s.value);
      const domain = emails[pick % Math.max(1, emails.length)]?.split('@')[1];
      const deny = ['Project Falcon', ...(domain ? [`*@${domain}`] : [])];
      text = `${text}\nStatus of Project Falcon: open.`;
      const res = blind([text], { known, deny, seed, now: NOW, dateOrder: c.dateOrder });
      const out = res.texts[0] as string;
      known.forEach((k, i) => {
        // A value made only of stop words is matched as written or in capitals (C3), so its lower-case copy is an ordinary word.
        if (stopWordValue(k.value) && modes[i % modes.length] === 1) return;
        const toks = k.kind === 'person' ? k.value.split(/\s+/).filter((t) => t.length >= 2 && !PARTICLES.has(t.toLowerCase())) : [k.value];
        for (const t of toks) if (containsWord(out, t)) throw new Error(`known ${k.kind} survived (${t.length} chars)`);
      });
      // The report lists exactly the entries C3 leaves partly unenforced: made of stop words, or a full name with a one-letter part or a capitalised stop-word part.
      const expected = known.flatMap((k, index) => {
        if (stopWordValue(k.value)) return [{ kind: k.kind, index, reason: 'stop-word' }];
        const words = k.value.split(/[\s,]+/).filter(Boolean);
        if (k.kind !== 'person' || words.length < 2) return [];
        if (words.some((w) => /^\p{Lu}$/u.test(w.replace(/[^\p{L}\p{N}]+/gu, '')))) return [{ kind: k.kind, index, reason: 'one-letter-part' }];
        return words.some((w) => /^\p{Lu}/u.test(w) && stopWordValue(w)) ? [{ kind: k.kind, index, reason: 'stop-word-part' }] : [];
      });
      if (JSON.stringify(res.leaks.unenforced) !== JSON.stringify(expected)) throw new Error(`unenforced lists ${res.leaks.unenforced.length} entries, expected ${expected.length}`);
      if (domain) {
        const re = new RegExp(`@(?:[a-z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}`, 'i');
        if (re.test(out)) throw new Error('an address on a denied domain survived');
      }
      // A deny entry that is still in the output must be reported.
      if (norm(out).includes('project falcon') && !res.leaks.hits.some((h) => h.kind === 'deny')) {
        throw new Error('denied text survived and the leak check stayed quiet');
      }
    }),
  );
}

// -------------------------------------------------------------------- P4

const digitsOf = (s: string): number => Number(s.replace(/\D/g, ''));
const amountsIn = (line: string): number[] => (line.match(/\d[\d.,]*\d|\d/g) ?? []).filter((x) => /[.,]\d{2}$/.test(x)).map(digitsOf);

export function p4Relations(): void {
  check(
    fc.property(relationCase, seedArb, (rc, seed) => {
      const res = blind([rc.text], { seed, now: NOW });
      const lines = (res.texts[0] as string).split('\n');
      rc.checks.forEach((chk, i) => {
        const line = lines[i] as string;
        const nums = line.replace(/\d+\s?%/g, '').match(/\d[\d.,]*\d/g) ?? [];
        const v = nums.filter((x) => /[.,]\d{2}$/.test(x)).map(digitsOf);
        const off = (a: number, b: number): number => Math.abs(a * 100 - b); // for |x*100 - base*(100+p)| <= 50
        if (chk.rule === 'surcharge') {
          const [base, total] = v as [number, number];
          if (off(total, base * (100 + chk.p)) > 50) throw new Error(`surcharge broke: ${line}`);
        } else if (chk.rule === 'pct') {
          const [base, part] = v as [number, number];
          if (off(part, base * chk.p) > 50) throw new Error(`percentage broke: ${line}`);
        } else if (chk.rule === 'sum') {
          const [a, b, c] = v as [number, number, number];
          if (a + b !== c) throw new Error(`sum broke: ${line}`);
        } else {
          const [base, vat, total] = v as [number, number, number];
          if (total !== base + vat) throw new Error(`chain total broke: ${line}`);
          if (off(vat, base * chk.p) > 50) throw new Error(`chain tax broke: ${line}`);
        }
        void amountsIn;
      });
    }),
  );
}

// -------------------------------------------------------------------- P5

const dayNumber = (y: number, m: number, d: number): number => Math.round(Date.UTC(y, m - 1, d) / 86400000);

export function p5Dates(): void {
  check(
    fc.property(emailCase, seedArb, (c, seed) => {
      const res = blind([c.text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder });
      const { dayShift, refYear } = res.mapping;
      if (dayShift % 7 !== 0 || dayShift === 0) throw new Error(`bad shift ${dayShift}`);
      // An IBAN such as NL15 JUNE 1007 0000 52 contains a parseable date,
      // but is replaced as an IBAN. The fixture's annotations define dates.
      const annotations = c.spans.filter((s) => s.kind === 'date');
      const dates = detectDates(c.text, c.dateOrder).filter((d) => annotations.some((s) => d.start < s.end && s.start < d.end));
      if (annotations.some((s) => !dates.some((d) => d.start < s.end && s.start < d.end))) {
        throw new Error('an annotated date was not recognized');
      }
      const parseDate = (value: string) => {
        const ds = detectDates(value, c.dateOrder);
        if (ds.length !== 1) throw new Error('an annotated date or its replacement is not one readable date');
        return ds[0]!.occ;
      };
      const before = dates.map((d) => d.occ);
      const after = dates.map((d) => {
        const real = c.text.slice(d.start, d.end);
        const pair = res.mapping.pairs.find((p) => p.kind === 'date' && p.real === real);
        if (!pair || !res.texts[0]!.includes(pair.fake)) throw new Error('an annotated date has no replacement in the output');
        return parseDate(pair.fake);
      });
      const dated: Array<[number, number]> = [];
      before.forEach((b, i) => {
        const a = after[i]!;
        const want = shiftYmd(b.y ?? refYear, b.m, b.d, dayShift);
        if (a.m !== want.m || a.d !== want.d || (a.y !== null && a.y !== want.y)) throw new Error(`date ${i} moved by something other than ${dayShift} days`);
        if (b.y !== null && a.y !== null) {
          const wd = (y: number, m: number, d: number): number => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
          if (wd(b.y, b.m, b.d) !== wd(a.y, a.m, a.d)) throw new Error(`weekday changed for date ${i}`);
          dated.push([dayNumber(b.y, b.m, b.d), dayNumber(a.y, a.m, a.d)]);
        }
      });
      for (let i = 1; i < dated.length; i++) {
        const [b0, a0] = dated[0] as [number, number];
        const [bi, ai] = dated[i] as [number, number];
        if (bi - b0 !== ai - a0) throw new Error('gap between two dates changed');
      }
    }),
  );
}

// -------------------------------------------------------------------- P6

export function p6Determinism(): void {
  check(
    fc.property(emailCase, seedArb, (c, seed) => {
      const a = blind([c.text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder });
      const b = blind([c.text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder });
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('same seed gave different output');
    }),
  );
}

/** Over 100 seed pairs on one rich input, different seeds must change the surrogates. */
export function p6DifferentSeeds(): void {
  check(
    fc.property(emailCase, fc.uuid(), (c, salt) => {
      let differing = 0;
      const pairs = 100;
      for (let i = 0; i < pairs; i++) {
        const a = blind([c.text], { known: c.known, seed: `${salt}-a${i}`, now: NOW, dateOrder: c.dateOrder });
        const b = blind([c.text], { known: c.known, seed: `${salt}-b${i}`, now: NOW, dateOrder: c.dateOrder });
        if (a.texts[0] !== b.texts[0]) differing++;
      }
      // An input with nothing to replace cannot differ.
      if (c.spans.length > 0 && differing < pairs * 0.95) throw new Error(`only ${differing}/${pairs} seed pairs changed the output`);
    }),
    { numRuns: Math.max(5, Math.ceil(numRuns() / 100)) },
  );
}

// -------------------------------------------------------------------- P7

const pattern = (v: string): string => v.replace(/\d/g, '9').replace(/[a-z]/g, 'a').replace(/[A-Z]/g, 'A');

export function p7Shape(): void {
  check(
    fc.property(shapeCase, seedArb, (sc, seed) => {
      const text = `Ref: ${sc.value} end.`;
      const res = blind([text], { seed, now: NOW });
      const out = res.texts[0] as string;
      const m = /^Ref: (.*) end\.$/.exec(out);
      if (!m) throw new Error('the surrounding text changed');
      const fake = m[1] as string;
      if (sc.kind === 'phone' || sc.kind === 'id') {
        if (pattern(fake) !== pattern(sc.value)) throw new Error(`${sc.kind} changed shape: ${pattern(sc.value)} -> ${pattern(fake)}`);
        if (fake === sc.value) throw new Error(`${sc.kind} was not replaced`);
        if (sc.kind === 'phone' && /^(\+|00)/.test(sc.value) && sc.value.includes(' ') && fake.split(' ')[0] !== sc.value.split(' ')[0]) {
          throw new Error('country code changed');
        }
      } else if (sc.kind === 'iban') {
        if (fake.slice(0, 2) !== sc.value.slice(0, 2)) throw new Error('IBAN country changed');
        if (pattern(fake).replace(/9/g, 'x') !== pattern(sc.value).replace(/9/g, 'x') && fake.length !== sc.value.length) throw new Error('IBAN length changed');
        if (fake.replace(/\S/g, 'x') !== sc.value.replace(/\S/g, 'x')) throw new Error('IBAN grouping changed');
        if (!ibanValid(fake)) throw new Error('fake IBAN has a bad checksum');
        if (fake === sc.value) throw new Error('IBAN was not replaced');
      } else if (sc.kind === 'email') {
        if (!/^[^@\s]+@[^@\s]+\.example$/.test(fake)) throw new Error('fake email is not on an .example domain');
        if (fake === sc.value) throw new Error('email was not replaced');
      } else {
        const [a] = detectAmounts(sc.value);
        const [b] = detectAmounts(fake);
        if (!a || !b) throw new Error('fake amount is not readable as an amount');
        if (sc.value.slice(0, a.start - 0).replace(/[\d.,]+$/, '') !== fake.slice(0, b.start)) throw new Error('currency prefix changed');
        if (sc.value.slice(a.end) !== fake.slice(b.end)) throw new Error('currency suffix changed');
        if (a.decimals !== b.decimals || (a.decimals > 0 && a.dec !== b.dec)) throw new Error('decimal style changed');
        if (b.thou !== null && a.thou !== null && a.thou !== b.thou) throw new Error('thousands separator changed');
      }
    }),
  );
}

// -------------------------------------------------------------------- P8

export function p8LeakCheckClean(): void {
  check(
    fc.property(emailCase, seedArb, (c, seed) => {
      const res = blind([c.text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder });
      try {
        assertNoLeaks(res);
      } catch (e) {
        if (e instanceof LeakError) throw new Error(`leak check fired: ${e.message}`);
        throw e;
      }
      // The report never carries values.
      const dump = JSON.stringify(res.leaks);
      if (/[@]/.test(dump)) throw new Error('leak report holds a value');
    }),
  );
}

// -------------------------------------------------------------------- P9

const layout = (v: string): string => v.replace(/[0-9A-Za-z]/g, 'x');

/** What a fake keeps of its original: the part that says what kind of number it is. */
function keptPrefix(scheme: string, real: string, fake: string): boolean {
  const r = compact(real);
  const f = compact(fake);
  switch (scheme) {
    case 'card':
      return r[0] === f[0];
    case 'es-nie':
    case 'es-cif':
      return r[0] === f[0];
    case 'eu-vat':
      return r.slice(0, 2) === f.slice(0, 2);
    case 'ipv4':
      return /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/.test(fake);
    case 'ipv6':
      return fake.startsWith('2001:db8:');
    default:
      return true;
  }
}

export function p9TypedIds(): void {
  check(
    fc.property(idCase, seedArb, (c, seed) => {
      const texts = [`Ref: ${c.value} end.`, ...(c.other ? [`Again: ${c.other} end.`] : [])];
      const res = blind(texts, { seed, now: NOW });
      const fake = /^Ref: (.*) end\.$/.exec(res.texts[0] as string)?.[1];
      if (fake === undefined) throw new Error('the surrounding text changed');
      if (fake === c.value) throw new Error(`${c.scheme} was not replaced`);
      if (!validId(fake, c.scheme)) throw new Error(`fake ${c.scheme} fails its own check`);
      if (!keptPrefix(c.scheme, c.value, fake)) throw new Error(`fake ${c.scheme} lost its prefix`);
      if (c.scheme !== 'ipv4' && c.scheme !== 'ipv6' && layout(fake) !== layout(c.value)) {
        throw new Error(`fake ${c.scheme} changed layout: ${layout(c.value)} -> ${layout(fake)}`);
      }
      if (c.other) {
        const again = /^Again: (.*) end\.$/.exec(res.texts[1] as string)?.[1] ?? '';
        if (compact(again) !== compact(fake)) throw new Error('one value in two layouts got two fakes');
      }
      texts.forEach((t, i) => {
        if (unblind(res.texts[i] as string, res.mapping).text !== t) throw new Error('round trip failed');
      });
      if (!res.leaks.ok) throw new Error('leak check fired');
    }),
  );
}

// -------------------------------------------------------------------- P10

/**
 * A conversation: each turn is blinded with the mapping the previous turn
 * returned, and passes only its own known values. A person from turn one is
 * mentioned again in the last turn, bare, so only the carried mapping can find it.
 */
export function p10Conversation(): void {
  check(
    fc.property(fc.array(emailCase, { minLength: 2, maxLength: 3 }), seedArb, (cases, seed) => {
      const firstPerson = cases[0]!.spans.find((sp) => sp.kind === 'person')?.value;
      const texts = cases.map((c, i) => (i === cases.length - 1 && firstPerson ? `${c.text}\n\nP.S. ${firstPerson} confirmed it.` : c.text));
      let mapping: Mapping | undefined;
      const outs: string[] = [];
      // A later turn lists only names it brings in itself, so names from earlier turns must come from the mapping.
      const listed = new Set<string>();
      texts.forEach((text, i) => {
        const before: Mapping | undefined = mapping ? JSON.parse(JSON.stringify(mapping)) : undefined;
        const known = cases[i]!.known.filter((k) => !listed.has(`${k.kind}|${k.value}`));
        for (const k of cases[i]!.known) listed.add(`${k.kind}|${k.value}`);
        const res = blind([text], { known, seed, now: NOW, dateOrder: cases[0]!.dateOrder, mapping });
        if (before) {
          const m = res.mapping;
          if (m.seed !== before.seed || m.factor !== before.factor || m.dayShift !== before.dayShift || m.refYear !== before.refYear) {
            throw new Error(`turn ${i} changed the seed, factor, shift or reference year`);
          }
          const had = new Map(before.pairs.map((p) => [`${p.kind}|${p.real.toLowerCase()}`, p.fake]));
          for (const p of before.pairs) {
            if (!m.pairs.some((q) => q.kind === p.kind && q.real === p.real && q.fake === p.fake)) throw new Error(`turn ${i} dropped a pair`);
          }
          for (const q of m.pairs.slice(before.pairs.length)) {
            const old = had.get(`${q.kind}|${q.real.toLowerCase()}`);
            if (old !== undefined && old.toLowerCase() !== q.fake.toLowerCase() && q.kind !== 'amount' && q.kind !== 'date') {
              throw new Error(`turn ${i} gave a ${q.kind} seen before a second fake`);
            }
          }
        }
        if (!res.leaks.ok) throw new Error(`leak check fired on turn ${i}`);
        mapping = res.mapping;
        outs.push(res.texts[0] as string);
      });
      if (firstPerson) {
        const last = outs[outs.length - 1] as string;
        for (const t of firstPerson.split(/\s+/).filter((x) => x.length >= 2 && !PARTICLES.has(x.toLowerCase()))) {
          if (containsWord(last, t)) throw new Error('a person from turn one survived in the last turn');
        }
      }
      outs.forEach((out, i) => {
        roundTrips(unblind(out, mapping as Mapping), texts[i] as string, `turn ${i} with the latest mapping`);
      });
    }),
  );
}

// -------------------------------------------------------------------- P11

/** Text a model might add around the blind copy: amounts and dates of its own, in both formats. */
const replyNoise = fc.constantFrom(
  '', 'Summary: the total is 1.250,00 € due 14 de mayo de 2026.', 'I estimate $310.40 by June 3, 2026.',
  'Nueva cita: 07/11/2026, importe 89,90 €.', 'Write to someone@else.example if needed.',
);

/**
 * A streamed answer: the blind text plus noise, cut into random chunks. The
 * pieces joined equal the one-shot unblind, and so does the invented list.
 */
export function p11Streaming(): void {
  check(
    fc.property(emailCase, seedArb, replyNoise, fc.array(fc.integer({ min: 1, max: 48 }), { minLength: 1, maxLength: 200 }), (c, seed, noise, sizes) => {
      const res = blind([c.text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder });
      const answer = `${noise}\n${res.texts[0] as string}\n${noise}`;
      const whole = unblind(answer, res.mapping);
      const u = createUnblinder(res.mapping);
      let streamed = '';
      let at = 0;
      for (let i = 0; at < answer.length; i++) {
        const n = sizes[i % sizes.length] as number;
        streamed += u.push(answer.slice(at, at + n));
        at += n;
      }
      const tail = u.end();
      streamed += tail.text;
      if (streamed !== whole.text) throw new Error('the streamed text differs from one-shot unblind');
      if (JSON.stringify(tail.invented) !== JSON.stringify(whole.invented)) throw new Error('the invented list differs');
    }),
  );
}

// ------------------------------------------------------------- P12 to P15

/** The two modes beside `fake`. */
const otherMode = fc.constantFrom<ReplaceWith>('placeholder', 'random');
const PLACEHOLDER = /\[REDACTED_([A-Z]+)_(\d+)\]/g;

/**
 * Placeholders: every pair is `[REDACTED_<KIND>_<n>]` for its own kind, the
 * numbers of each kind first appear in the blind texts as 1, 2, 3 in reading
 * order, one value as written has one placeholder in every text of the call,
 * and no placeholder stands for two values.
 */
export function p12Placeholders(): void {
  check(
    fc.property(fc.array(emailCase, { minLength: 1, maxLength: 3 }), seedArb, (cases, seed) => {
      const texts = cases.map((c) => c.text);
      const known = dedupe(cases.flatMap((c) => c.known));
      const res = blind(texts, { known, seed, now: NOW, dateOrder: cases[0]!.dateOrder, replaceWith: 'placeholder' });
      const byReal = new Map<string, string>();
      const byFake = new Map<string, string>();
      for (const p of res.mapping.pairs) {
        const m = /^\[REDACTED_([A-Z]+)_([1-9]\d*)\]$/.exec(p.fake);
        if (!m || m[1] !== p.kind.toUpperCase()) throw new Error(`a ${p.kind} pair is not a ${p.kind} placeholder`);
        const r = `${p.kind}|${p.real}`;
        if (byReal.has(r) && byReal.get(r) !== p.fake) throw new Error(`one ${p.kind} value got two placeholders`);
        if (byFake.has(p.fake) && byFake.get(p.fake) !== r) throw new Error(`one placeholder stands for two values`);
        byReal.set(r, p.fake);
        byFake.set(p.fake, r);
      }
      const seen = new Map<string, number>();
      for (const out of res.texts) {
        for (const m of out.matchAll(PLACEHOLDER)) {
          const kind = m[1] as string;
          const n = Number(m[2]);
          const last = seen.get(kind) ?? 0;
          if (n > last + 1) throw new Error(`${kind} ${n} first appears before ${kind} ${last + 1}`);
          if (n === last + 1) seen.set(kind, n);
          if (!byFake.has(m[0])) throw new Error('a placeholder in the text is not in the mapping');
        }
      }
      if (res.mapping.replaceWith !== 'placeholder' || res.mapping.factor !== 1 || res.mapping.dayShift !== 0) {
        throw new Error('the mapping does not record placeholder mode with nothing scaled or shifted');
      }
      checkMapping(JSON.parse(JSON.stringify(res.mapping)));
    }),
  );
}

/** Model-like additions: its own amounts and dates, an address, and a placeholder the mapping never made. */
const otherNoise = fc.constantFrom(
  '', 'Summary: the total is 1.250,00 € due 14 de mayo de 2026.', 'I estimate $310.40 by June 3, 2026.',
  'Write to someone@else.example if needed.', 'Also [REDACTED_PERSON_97] and [REDACTED_AMOUNT_98] €.',
);

/** A placeholder literal already in the input, low numbers most often so it meets the ones blind hands out. */
const existingLiteral = fc.option(
  fc.tuple(fc.constantFrom('PERSON', 'EMAIL', 'AMOUNT', 'DATE', 'ID', 'ORG'), fc.integer({ min: 1, max: 4 }), fc.boolean())
    .map(([kind, n, lower]) => (lower ? `[redacted_${kind.toLowerCase()}_${n}]` : `[REDACTED_${kind}_${n}]`)),
  { nil: '' },
);

/**
 * Round trip in `placeholder` and `random` mode: every text of a multi-text
 * call unblinds to itself, and a streamed answer in any chunking joins to
 * exactly the one-shot result with the same invented list.
 */
export function p13OtherModesRoundTrip(): void {
  check(
    fc.property(
      fc.array(emailCase, { minLength: 1, maxLength: 3 }), seedArb, otherMode, otherNoise,
      fc.array(fc.integer({ min: 1, max: 48 }), { minLength: 1, maxLength: 200 }), existingLiteral,
      (cases, seed, replaceWith, noise, sizes, literal) => {
        // A placeholder literal already in the input (a text redacted once before) must come back as itself.
        const texts = cases.map((c, i) => (i === 0 && literal ? `${c.text}\nAs noted, ${literal} agreed.` : c.text));
        const known = dedupe(cases.flatMap((c) => c.known));
        const res = blind(texts, { known, seed, now: NOW, dateOrder: cases[0]!.dateOrder, replaceWith });
        const mapping = JSON.parse(JSON.stringify(res.mapping)) as Mapping;
        res.texts.forEach((t, i) => {
          roundTrips(unblind(t, mapping), texts[i] as string, `${replaceWith}: text ${i}`);
        });
        const answer = `${noise}\n${res.texts.join('\n')}\n${noise}`;
        const whole = unblind(answer, mapping);
        const u = createUnblinder(mapping);
        let streamed = '';
        let at = 0;
        for (let i = 0; at < answer.length; i++) {
          const n = sizes[i % sizes.length] as number;
          streamed += u.push(answer.slice(at, at + n));
          at += n;
        }
        const tail = u.end();
        streamed += tail.text;
        if (streamed !== whole.text) throw new Error(`${replaceWith}: the streamed text differs from one-shot unblind`);
        if (JSON.stringify(tail.invented) !== JSON.stringify(whole.invented)) throw new Error(`${replaceWith}: the invented list differs`);
        if (replaceWith === 'placeholder' && noise.includes('REDACTED') && !whole.invented.includes('[REDACTED_PERSON_97]')) {
          throw new Error('a placeholder the mapping does not know was not reported as invented');
        }
        if (replaceWith === 'placeholder' && literal && res.mapping.pairs.some((p) => p.fake.toUpperCase() === literal.toUpperCase())) {
          throw new Error('a placeholder literal of the input was given to a value');
        }
        if (replaceWith === 'placeholder' && res.collisions.length) throw new Error('placeholder: blind reported collisions');
      },
    ),
  );
}

/**
 * A conversation in `placeholder` or `random` mode. Only the first turn names
 * the mode. Every later turn keeps it, scales and shifts nothing, keeps every
 * pair, never gives a value seen before a second fake, finds a person from turn
 * one again bare, and round trips with the latest mapping.
 */
export function p14OtherModesConversation(): void {
  check(
    fc.property(fc.array(emailCase, { minLength: 2, maxLength: 3 }), seedArb, otherMode, (cases, seed, replaceWith) => {
      const firstPerson = cases[0]!.spans.find((sp) => sp.kind === 'person')?.value;
      const texts = cases.map((c, i) => (i === cases.length - 1 && firstPerson ? `${c.text}\n\nP.S. ${firstPerson} confirmed it.` : c.text));
      let mapping: Mapping | undefined;
      const outs: string[] = [];
      const listed = new Set<string>();
      texts.forEach((text, i) => {
        const before: Mapping | undefined = mapping ? JSON.parse(JSON.stringify(mapping)) : undefined;
        const known = cases[i]!.known.filter((k) => !listed.has(`${k.kind}|${k.value}`));
        for (const k of cases[i]!.known) listed.add(`${k.kind}|${k.value}`);
        const res = blind([text], { known, seed, now: NOW, dateOrder: cases[0]!.dateOrder, mapping, ...(i === 0 ? { replaceWith } : {}) });
        const m = res.mapping;
        if (m.replaceWith !== replaceWith || m.factor !== 1 || m.dayShift !== 0) throw new Error(`turn ${i} did not keep ${replaceWith} mode`);
        if (before) {
          const had = new Map(before.pairs.map((p) => [`${p.kind}|${p.real}`, p.fake]));
          before.pairs.forEach((p, j) => {
            const q = m.pairs[j];
            if (!q || q.kind !== p.kind || q.real !== p.real || q.fake !== p.fake) throw new Error(`turn ${i} changed or dropped a pair`);
          });
          for (const q of m.pairs.slice(before.pairs.length)) {
            const old = had.get(`${q.kind}|${q.real}`);
            if (old !== undefined && old !== q.fake) throw new Error(`turn ${i} gave a ${q.kind} seen before a second fake`);
          }
        }
        if (!res.leaks.ok) throw new Error(`leak check fired on turn ${i}`);
        mapping = m;
        outs.push(res.texts[0] as string);
      });
      if (firstPerson) {
        const last = outs[outs.length - 1] as string;
        for (const t of firstPerson.split(/\s+/).filter((x) => x.length >= 2 && !PARTICLES.has(x.toLowerCase()))) {
          if (containsWord(last, t)) throw new Error('a person from turn one survived in the last turn');
        }
      }
      checkMapping(JSON.parse(JSON.stringify(mapping)));
      outs.forEach((out, i) => {
        roundTrips(unblind(out, mapping as Mapping), texts[i] as string, `turn ${i} with the latest mapping`);
      });
    }),
  );
}

/**
 * The leak check in `placeholder` and `random` mode: no inserted value and no
 * known value survives, the check is clean, a planted deny entry is reported,
 * and the report holds no value.
 */
export function p15OtherModesLeakCheck(): void {
  check(
    fc.property(emailCase, seedArb, otherMode, (c, seed, replaceWith) => {
      const text = `${c.text}\nStatus of Project Falcon: open.`;
      const res = blind([text], { known: c.known, seed, now: NOW, dateOrder: c.dateOrder, replaceWith });
      const out = res.texts[0] as string;
      const left = survivors(c, out, res.mapping.pairs);
      if (left.length) throw new Error(`${replaceWith}: still in the blind text: ${left.join(', ')}`);
      for (const k of c.known) {
        const toks = k.kind === 'person' ? k.value.split(/\s+/).filter((t) => t.length >= 2 && !PARTICLES.has(t.toLowerCase())) : [k.value];
        for (const t of toks) if (containsWord(out, t)) throw new Error(`${replaceWith}: known ${k.kind} survived (${t.length} chars)`);
      }
      try {
        assertNoLeaks(res);
      } catch (e) {
        if (e instanceof LeakError) throw new Error(`${replaceWith}: leak check fired: ${e.message}`);
        throw e;
      }
      const denied = blind([text], { known: c.known, deny: ['Project Falcon'], seed, now: NOW, dateOrder: c.dateOrder, replaceWith });
      if (norm(denied.texts[0] as string).includes('project falcon') && !denied.leaks.hits.some((h) => h.kind === 'deny')) {
        throw new Error(`${replaceWith}: a deny entry left in the text was not reported`);
      }
      if (/@|Falcon/i.test(JSON.stringify(denied.leaks))) throw new Error('the leak report holds a value');
    }),
  );
}

export { toCase };

// -------------------------------------------------------------------- P16

interface AmountSetCase {
  text: string;
  /** Whole units (no cents written) or cents. */
  cents: boolean;
}

/**
 * Amounts in one style, many of them one unit apart, plus the sum of two of
 * them written exactly and one unit off, so the relation finder reads several
 * amounts as the same sum. Whole amounts are written without cents.
 */
const amountSetCase: fc.Arbitrary<AmountSetCase> = fc.gen().map((g) => {
  const s = srcFrom(g);
  const style = pick(s, ['eu', 'us'] as const);
  const cents = chance(s, 70);
  const unit = cents ? 1 : 100;
  const minors: number[] = [];
  for (let i = 0, n = range(s, 2, 7); i < n; i++) {
    // From 1.00, or 1,000 whole units, up, and at least 10 units from the
    // others, with at most one neighbour each side. A tighter crowd under a
    // factor below 1 leaves fewer fakes than amounts, so some must move further
    // (the dense case has its own unit test in safety.test.ts). Below 1,000
    // whole units one unit is more than the 0.5% the usability rule allows.
    const v = cents ? range(s, 100, 2_000_000) : range(s, 1_000, 30_000) * 100;
    if (minors.some((m) => Math.abs(m - v) < 10 * unit)) continue;
    minors.push(v);
    if (chance(s, 50)) minors.push(v + unit);
    if (chance(s, 30) && v > unit) minors.push(v - unit);
  }
  if (chance(s, 70)) {
    const sum = (minors[0] as number) + (minors[1] as number);
    minors.push(sum);
    if (chance(s, 70)) minors.push(sum + unit);
    if (chance(s, 40)) minors.push(sum - unit);
  }
  const whole = (m: number): string => {
    const int = String(m / 100).replace(/\B(?=(\d{3})+(?!\d))/g, style === 'eu' ? '.' : ',');
    return style === 'eu' ? `${int} €` : `$${int}`;
  };
  const lines = minors.map((m, i) => `Line ${i + 1}: ${cents ? renderAmount(m, s, style) : whole(m)}`);
  if (chance(s, 30)) lines.push(`Tax ${pick(s, [5, 10, 21])} %`);
  return { text: lines.join('\n'), cents };
});

/**
 * No two amounts share a fake. Amounts one unit apart, and two amounts the
 * relation finder reads as the same sum, used to scale onto one fake and
 * unblind could not tell them apart. Every text round trips, equal amounts
 * keep one fake, different amounts get different ones, and each fake stays
 * usable: within 5 cents or 0.5% of the real amount times the factor, the
 * rule `scripts/bench/score.ts` scores, and within 3 units or 0.5% for
 * amounts written without cents, where a sum carries the moves of both its
 * parts. Turning off the move to a free fake makes it fail.
 */
export function p16AmountsApart(): void {
  check(
    fc.property(amountSetCase, seedArb, (c, seed) => {
      const res = blind([c.text], { seed, now: NOW });
      const out = res.texts[0] as string;
      if (unblind(out, res.mapping).text !== c.text) throw new Error('the amounts did not round trip');
      const before = detectAmounts(c.text);
      const after = detectAmounts(out);
      if (before.length !== after.length) throw new Error(`amount count changed: ${before.length} -> ${after.length}`);
      const fakeOf = new Map<number, number>();
      const realOf = new Map<number, number>();
      before.forEach((b, i) => {
        const real = b.minor / 10 ** b.decimals;
        const fake = after[i]!.minor / 10 ** after[i]!.decimals;
        if ((fakeOf.get(real) ?? fake) !== fake) throw new Error('one amount got two fakes');
        if ((realOf.get(fake) ?? real) !== real) throw new Error('two amounts got one fake');
        fakeOf.set(real, fake);
        realOf.set(fake, real);
        const want = real * res.mapping.factor;
        const slack = c.cents ? Math.max(0.05, want * 0.005) : Math.max(3, want * 0.005);
        if (Math.abs(fake - want) > slack + 1e-9) throw new Error(`a fake moved too far from the factor (${Math.abs(fake - want).toFixed(2)})`);
      });
    }),
  );
}

// -------------------------------------------------------------------- P17

const stripAccents = (v: string): string => v.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
const escRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Role words a NER model tags as an org in any letter case, the way GLiNER does on contracts. */
const ROLE_PHRASES = ['la Empresa', 'the Company', 'el Prestamista', 'the Insurer', 'la Aseguradora'];

export interface SpellingCase {
  text: string;
  known: KnownValue[];
  role: string;
  /** The letters of a user name written straight before digits. */
  user: string;
}

/** Cyrillic letters that look like Latin ones, as a homoglyph attack writes them. */
const LOOK_ALIKE: Record<string, string> = {
  a: '\u0430', e: '\u0435', o: '\u043e', p: '\u0440', c: '\u0441', x: '\u0445', y: '\u0443', i: '\u0456',
  A: '\u0410', B: '\u0412', E: '\u0415', K: '\u041a', M: '\u041c', H: '\u041d', O: '\u041e', P: '\u0420', C: '\u0421', T: '\u0422', X: '\u0425',
};
/** The value with its first letter that has a look-alike swapped for it, or every such letter. */
const lookAlike = (v: string, all: boolean): string => {
  let done = false;
  return [...v].map((ch) => {
    const to = LOOK_ALIKE[ch];
    if (to === undefined || (done && !all)) return ch;
    done = true;
    return to;
  }).join('');
};
/** Digits in their full-width forms, U+FF10 to U+FF19. */
const fullWidth = (v: string): string => v.replace(/\d/g, (d) => String.fromCharCode(0xff10 + Number(d)));
/** Some digits full-width, the rest plain. */
const someFullWidth = (s: ReturnType<typeof srcFrom>, v: string): string => v.replace(/\d/g, (d) => (chance(s, 50) ? fullWidth(d) : d));

const cap = (w: string): string => w[0]!.toUpperCase() + w.slice(1);
const EN_MONTH_NAMES = EN_MONTHS.map(cap);
const ES_MONTH_NAMES = ES_MONTHS;
const DATE_SHAPES: Array<(d: number, m: number, y: number) => string> = [
  (d, m, y) => `${d} ${EN_MONTH_NAMES[m - 1]} ${y}`,
  (d, m, y) => `${d} ${EN_MONTH_NAMES[m - 1]!.slice(0, 3)} ${y}`,
  (d, m, y) => `${d}  ${EN_MONTH_NAMES[m - 1]} ${y}`,
  (d, m, y) => `${EN_MONTH_NAMES[m - 1]} ${d}, ${y}`,
  (d, m, y) => `${EN_MONTH_NAMES[m - 1]!.toUpperCase()} ${d} ${y}`,
  (d, m, y) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`,
  (d, m, y) => `${d}/${m}/${y}`,
  (d, m, y) => `0${d}/${m}/${y}`.replace(/^0(\d\d)/, '$1'),
  (d, m, y) => `${d} de ${ES_MONTH_NAMES[m - 1]} de ${y}`,
  (d, m, y) => `${d} de ${ES_MONTH_NAMES[m - 1]} del ${y}`,
  (d, m) => `${d} ${EN_MONTH_NAMES[m - 1]}`,
  (d, m) => `${d} ${EN_MONTH_NAMES[m - 1]!.slice(0, 3)}`,
];

/**
 * One amount written one way: English or Spanish separators, the thousands
 * separator present or absent, digits plain, all full-width or some, and a
 * currency before or after it.
 */
function amountSpelling(s: ReturnType<typeof srcFrom>, int: number, cents: number | null): string {
  const [thou, dec] = pick(s, [[',', '.'], ['.', ',']] as const);
  const grouped = chance(s, 50) ? String(int).replace(/\B(?=(\d{3})+(?!\d))/g, thou) : String(int);
  const n = cents === null ? grouped : `${grouped}${dec}${String(cents).padStart(2, '0')}`;
  const digits = pick(s, [(v: string) => v, fullWidth, (v: string) => someFullWidth(s, v)]);
  return pick(s, [(v: string) => `€${v}`, (v: string) => `$${v}`, (v: string) => `£${v}`, (v: string) => `${v} €`, (v: string) => `${v} EUR`])(digits(n));
}

/**
 * One person, org, role phrase and address, each written several ways: as
 * given, in capitals, in lower case, without accents, with the first letter
 * lowered, with one or every letter swapped for a Cyrillic look-alike. A user
 * name is the first name glued to digits, some of them full-width, and a phone
 * carries an extension glued on with `x`. One date is written in several
 * spellings, plain and with full-width digits, and so is one amount.
 */
export const spellingCase: fc.Arbitrary<SpellingCase> = fc.gen().map((g) => {
  const s = srcFrom(g);
  const lang = pick(s, ['en', 'es'] as const);
  const taken = new Set<string>();
  const p = makePerson(s, lang, taken);
  const o = makeOrg(s, lang, taken);
  const email = makeEmail(s, p, `${o.slug}.example`);
  const role = pick(s, ROLE_PHRASES);
  const forms = (v: string): string[] => [
    v, v.toUpperCase(), v.toLowerCase(), stripAccents(v), v.replace(/^\p{L}/u, (ch) => ch.toLowerCase()), v.replace(/^\p{L}/u, (ch) => ch.toUpperCase()),
    lookAlike(v, false), lookAlike(v, true),
  ];
  const some = (v: string): string => Array.from({ length: range(s, 2, 4) }, () => pick(s, forms(v))).join(', ');
  const user = plain(p.first).replace(/-/g, '');
  const month = range(s, 1, 12);
  const day = range(s, 1, 28);
  const amountInt = range(s, 1000, 99_999);
  const amountCents = chance(s, 50) ? range(s, 0, 99) : null;
  const at = email.indexOf('@');
  const emailForms = [email, email.toUpperCase(), email[0]!.toUpperCase() + email.slice(1), email.slice(0, at).toUpperCase() + email.slice(at)];
  const lines = [
    `From: ${p.full} <${email}>`,
    `${some(role)}: ${some(o.name)}.`,
    `${pick(s, ['Dear', 'Hola', 'Hi'])} ${some(p.full)},`,
    `User: ${user}${someFullWidth(s, digitString(s, range(s, 1, 4)))}. Phone: ${someFullWidth(s, makePhone(s))}x${digitString(s, range(s, 1, 5))}`,
    `Dates: ${Array.from({ length: range(s, 2, 4) }, () => {
      const written = pick(s, DATE_SHAPES)(day, month, 2026);
      return chance(s, 25) ? fullWidth(written) : written;
    }).join('; ')}.`,
    `Amounts: ${Array.from({ length: range(s, 2, 3) }, () => amountSpelling(s, amountInt, amountCents)).join('; ')}.`,
    `Reply to ${pick(s, emailForms)} or ${pick(s, emailForms)}. Signed for ${pick(s, forms(role))}, ${pick(s, forms(p.first))}.`,
  ];
  return { text: lines.join('\n'), known: [{ kind: 'person', value: p.full }, { kind: 'org', value: o.name }], role, user };
});

/** A stand-in for a NER model: the role phrase in any case, and the user name's letters when digits follow. */
function spellingDetector(c: SpellingCase): Detector {
  const role = new RegExp(`(?<!\\p{L})${escRe(c.role)}(?!\\p{L})`, 'giu');
  const user = new RegExp(`(?<!\\p{L})${escRe(c.user)}(?=\\p{N})`, 'giu');
  return {
    name: 'p17-stub',
    detect(text) {
      const out: Span[] = [];
      for (const m of text.matchAll(role)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'org', priority: 50 });
      for (const m of text.matchAll(user)) out.push({ start: m.index, end: m.index + m[0].length, kind: 'person', priority: 50 });
      return out;
    },
  };
}

/**
 * The Gretel failures as a class. A value written in another letter case,
 * without its accents or with look-alike letters, a name glued to digits
 * plain or full-width, a phone with an extension, an address in two cases and
 * one date and one amount in several spellings all round trip exactly, in every `replaceWith` mode,
 * with a NER-like detector plugged in. In `fake` mode the role phrase keeps one
 * fake in every letter case. Restoring a name in the case habit of the first
 * spelling, the old rule that a fake may not touch a digit, or rendering every
 * spelling of a date or an amount the one way it scales or shifts to, makes it fail.
 */
export function p17Spellings(): void {
  check(
    fc.property(spellingCase, seedArb, fc.constantFrom<ReplaceWith>('fake', 'placeholder', 'random'), (c, seed, replaceWith) => {
      const res = blind([c.text], { known: c.known, seed, now: NOW, detectors: [spellingDetector(c)], replaceWith });
      const back = unblind(res.texts[0] as string, JSON.parse(JSON.stringify(res.mapping)) as Mapping);
      if (back.text !== c.text) throw new Error(`${replaceWith}: the text did not round trip`);
      if (replaceWith === 'fake') {
        const fakes = new Set(res.mapping.pairs.filter((p) => p.kind === 'org' && p.real.toLowerCase() === c.role.toLowerCase()).map((p) => p.fake.toLowerCase()));
        if (fakes.size > 1) throw new Error('the role phrase got two fakes in two letter cases');
      }
    }),
  );
}

// ------------------------------------------------------------ P18 to P20

const foldName = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const listOf = (xs: readonly string[]): Set<string> => new Set(xs.map(foldName));
const FAKE_SETS = Object.fromEntries(
  (['en', 'es'] as const).map((l) => {
    const f = FAKES[l];
    return [l, { name: listOf([...f.female, ...f.male, ...f.last]), org: listOf(f.orgBases), place: listOf(f.places), host: listOf([...f.domainNouns, ...f.domainNames]) }];
  }),
) as Record<Lang, { name: Set<string>; org: Set<string>; place: Set<string>; host: Set<string> }>;

/** The language of the lists a fake came from, or undefined when it is in neither. */
export function fakeListLanguage(kind: 'person' | 'org' | 'place' | 'email', fake: string): Lang | undefined {
  for (const l of ['en', 'es'] as const) {
    const sets = FAKE_SETS[l];
    if (kind === 'person' && sets.name.has(foldName(fake))) return l;
    if (kind === 'place' && sets.place.has(foldName(fake))) return l;
    if (kind === 'org' && fake.split(/\s+/).some((w) => sets.org.has(foldName(w)))) return l;
    if (kind === 'email') {
      const reg = /@([a-z]+)-([a-z]+)\.example$/.exec(fake.toLowerCase());
      if (reg && sets.host.has(reg[1] as string) && sets.host.has(reg[2] as string)) return l;
    }
  }
  return undefined;
}

/** Every person word, org, place and address of `c` with a fake in the mapping, and the language of that fake. */
function fakeLanguages(c: Case, pairs: readonly Pair[]): Array<{ kind: string; value: string; lang: Lang | undefined }> {
  const out: Array<{ kind: string; value: string; lang: Lang | undefined }> = [];
  const fakeOf = (kind: string, real: string): string | undefined => pairs.find((p) => p.kind === kind && p.real === real)?.fake;
  for (const sp of c.spans) {
    // When the generator runs out of names it falls back to one Spanish person and one English company in either language.
    if (/zacar[ií]as|quevedo|kestrel.ventures/i.test(sp.value)) continue;
    if (sp.kind === 'person') {
      for (const t of sp.value.split(/\s+/).filter((w) => w.length >= 2 && !PARTICLES.has(w.toLowerCase()))) {
        const f = fakeOf('person', t);
        if (f) out.push({ kind: 'person', value: t, lang: fakeListLanguage('person', f) });
      }
    } else if (sp.kind === 'org' || sp.kind === 'place' || sp.kind === 'email') {
      const f = fakeOf(sp.kind, sp.value);
      // An address on a public mail host keeps its host, so only its local part is a fake.
      if (f && f.toLowerCase() !== sp.value.toLowerCase() && !(sp.kind === 'email' && !f.endsWith('.example'))) out.push({ kind: sp.kind, value: sp.value, lang: fakeListLanguage(sp.kind, f) });
    }
  }
  return out;
}

const monolingual = (lang: Lang): fc.Arbitrary<Case> =>
  fc.gen().map((g) => {
    const s = srcFrom(g);
    return toCase(genEmail(s, pick(s, CATEGORIES), lang));
  });

/**
 * A fake follows the language of the text. An English email gets English
 * names, companies, places and hosts, a Spanish one Spanish ones, and a thread
 * with an English reply above a quoted Spanish email gets each part's own.
 * Picking from one mixed list, as blind did before, makes it fail.
 */
export function p18LanguageFollows(): void {
  check(
    fc.property(fc.constantFrom<Lang | 'thread'>('en', 'es', 'thread'), monolingual('en'), monolingual('es'), seedArb, (which, en, es, seed) => {
      const parts: Array<{ lang: Lang; c: Case }> = which === 'thread' ? [{ lang: 'en', c: en }, { lang: 'es', c: es }] : [{ lang: which, c: which === 'en' ? en : es }];
      const text = parts.map((p) => p.c.text).join('\n\n-------- Mensaje original --------\n\n');
      const known = dedupe(parts.flatMap((p) => p.c.known));
      const res = blind([text], { known, seed, now: NOW });
      for (const { lang, c } of parts) {
        for (const v of fakeLanguages(c, res.mapping.pairs)) {
          if (v.lang !== lang) throw new Error(`${v.kind} in ${lang} text got a fake from the ${v.lang ?? 'syllable'} lists`);
        }
      }
    }),
  );
}

/** The generator's first names by gender, and a few more women's names that do not end in "a". */
const WOMEN = new Set(['Priscilla', 'Delphine', 'Imogen', 'Rosalind', 'Phoebe', 'Matilda', 'Georgina', 'Isadora', 'Lavinia', 'Odette', 'Rowena', 'Tamsin', 'Wilhelmina', 'Cordelia', 'Eleanor', 'Gwendolyn', 'Pilar', 'Aurora', 'Gloria', 'Leonor', 'Belén', 'Dolores', 'Fermina', 'Herminia', 'Jacinta', 'Macarena', 'Ofelia', 'Remedios', 'Trinidad', 'Verónica', 'Amparo', 'Candelaria', 'Estefanía', 'Griselda', 'Itziar']);
const GIVEN_BY: Record<Lang, Record<'female' | 'male', string[]>> = {
  en: { female: [...FIRST_EN.filter((n) => WOMEN.has(n)), 'Rose', 'Ruth', 'Hazel', 'Grace', 'Alice'], male: FIRST_EN.filter((n) => !WOMEN.has(n) && n !== 'Valentine') },
  es: { female: [...FIRST_ES.filter((n) => WOMEN.has(n)), 'Carmen', 'Isabel', 'Mercedes', 'Rocío', 'Inés'], male: FIRST_ES.filter((n) => !WOMEN.has(n)) },
};

/**
 * A first name keeps its gender and language: a woman's English or Spanish
 * name gets a woman's fake from the same language, a man's a man's, also for
 * names that do not end in "a" (Imogen, Rose, Belén) and for the fakes
 * themselves written as real names. The old rule, a final "a" and a short
 * Spanish list, gives Imogen and Rose men's names and makes it fail.
 */
export function p19Gender(): void {
  const fakes = (['en', 'es'] as const).flatMap((lang) => (['female', 'male'] as const).flatMap((g) => FAKES[lang][g].map((name) => ({ lang, g, name }))));
  const named = fc.oneof(
    fc.constantFrom(...(['en', 'es'] as const).flatMap((lang) => (['female', 'male'] as const).flatMap((g) => GIVEN_BY[lang][g].map((name) => ({ lang, g, name }))))),
    fc.constantFrom(...fakes),
  );
  check(
    fc.property(named, fc.nat(), seedArb, ({ lang, g, name }, n, seed) => {
      const surnames = (lang === 'en' ? LAST_EN : LAST_ES).filter((l) => !l.includes(' '));
      const full = `${name} ${surnames[n % surnames.length] as string}`;
      const text = lang === 'en' ? `Dear ${full}, thank you for the note. We will call you on Monday.` : `Hola ${full}, gracias por la nota. Te llamamos el lunes.`;
      const res = blind([text], { known: [{ kind: 'person', value: full }], seed, now: NOW });
      const fake = res.mapping.pairs.find((p) => p.kind === 'person' && p.real === name)?.fake;
      if (!fake) throw new Error('the first name got no fake');
      if (!FAKES[lang][g].some((f) => foldName(f) === foldName(fake))) throw new Error(`a ${g} ${lang} first name got a fake that is not a ${g} ${lang} name`);
    }),
  );
}

const digitsArb = (n: number): fc.Arbitrary<string> => fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).map((d) => d.join(''));
const oneOf = (digits: string): fc.Arbitrary<string> => fc.constantFrom(...digits.split(''));
/** NXX: a North American area code or exchange, never N11. */
const nxx = fc.tuple(oneOf('23456789'), oneOf('012345678'), oneOf('0123456789')).map((d) => d.join('')).filter((c) => c.slice(1) !== '11');

/**
 * Mobile numbers in the layouts people write them, with the rule that says the
 * national part is a mobile. Every input is in a reserved range (UK 07700
 * 900xxx, Spanish 75 to 79, North American NXX-555-01XX), so no generated
 * number is anyone's. The fake generator treats a reserved mobile like any
 * other of its country, and the detector reads digits, not ranges. The live
 * prefixes (UK 071 to 078, Spanish 6 and 71 to 74, any exchange) are unit
 * cases in `test/detect.test.ts`.
 */
export const mobileCase: fc.Arbitrary<{ country: 'uk' | 'es' | 'us'; phone: string; national: (fake: string) => string; mobile: RegExp }> = fc.oneof(
  fc.tuple(digitsArb(3), fc.constantFrom('+44 7', '0044 7', '07', '+447')).chain(([n, lead]) =>
    fc.constantFrom(
      `${lead}700 900${n}`,
      ...(lead === '07' ? [`07700 900 ${n}`, `07700900${n}`] : []),
    ).map((phone) => ({ country: 'uk' as const, phone, national: (f: string) => f.replace(/\D/g, '').replace(/^(0044|44|0)/, ''), mobile: /^7700900\d{3}$/ })),
  ),
  fc.tuple(oneOf('56789').map((b) => `7${b}`), digitsArb(7), fc.constantFrom('+34 ', '0034 ', '')).chain(([m, d, lead]) =>
    fc.constantFrom(`${lead}${m}${d[0]} ${d.slice(1, 4)} ${d.slice(4)}`, `${lead}${m}${d}`, ...(lead ? [] : [`${m}${d[0]} ${d.slice(1, 3)} ${d.slice(3, 5)} ${d.slice(5)}`])).map((phone) => ({
      country: 'es' as const,
      phone,
      national: (f: string) => f.replace(/\D/g, '').replace(/^(0034|34(?=\d{9}$))/, ''),
      mobile: /^7[5-9]\d{7}$/,
    })),
  ),
  fc.tuple(nxx, digitsArb(2)).chain(([a, n]) =>
    fc.constantFrom(`(${a}) 555-01${n}`, `${a}-555-01${n}`, `+1 ${a} 555 01${n}`, `+1 (${a}) 555-01${n}`).map((phone) => ({
      country: 'us' as const,
      phone,
      national: (f: string) => f.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''),
      mobile: /^[2-9][0-8]\d55501\d{2}$/,
    })),
  ),
);

/**
 * A mobile stays a mobile in its country's layout, in the range no subscriber
 * holds: a UK 07 number becomes 07700 900xxx, a Spanish 6 or 7 number (other
 * than 70) becomes 75 to 79, and a North American NXX-NXX-XXXX number becomes
 * NXX-555-01XX. Each keeps its country code and every separator. The old rule, which
 * kept a first digit only for Spanish numbers, turns +44 7700 into a landline.
 */
export function p20MobileShape(): void {
  check(
    fc.property(mobileCase, seedArb, (mc, seed) => {
      const res = blind([`Call me on ${mc.phone} today.`], { seed, now: NOW });
      const m = /^Call me on (.*) today\.$/.exec(res.texts[0] as string);
      if (!m) throw new Error('the surrounding text changed');
      const fake = m[1] as string;
      if (fake === mc.phone) throw new Error(`${mc.country} phone was not replaced`);
      if (fake.replace(/\d/g, '9') !== mc.phone.replace(/\d/g, '9')) throw new Error(`${mc.country} phone changed layout`);
      if (mc.national(fake).length !== mc.national(mc.phone).length) throw new Error(`${mc.country} country code changed`);
      if (!mc.mobile.test(mc.national(fake))) throw new Error(`${mc.country} mobile got a fake outside the mobile ranges`);
      const back = unblind(res.texts[0] as string, res.mapping);
      if (back.text !== `Call me on ${mc.phone} today.`) throw new Error('the text did not round trip');
    }),
  );
}
