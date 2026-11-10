import { detectAmounts, formatNumber, parseNumber, type AmountOcc } from './amounts.js';
import { detectDates, renderDate, shiftOcc, type DateOcc } from './dates.js';
import { emailDetector, resolveSpans } from './detect.js';
import { foldLookalikes } from './fold.js';
import { PLACEHOLDER_RE } from './replace.js';
import { fakeFinder, FLEX_MIN, flexFinder, flexKey, flexRestore, literalFinder } from './match.js';
import { PairLog } from './pairlog.js';
import { asciiLower, Surrogates } from './surrogates.js';
import type { Collision, Mapping, ReplaceWith, Span, UnblindOptions, UnblindResult } from './types.js';
import { BlindError, checkLimit, guard, InputTooLargeError, MAX_TEXT_LENGTH } from './errors.js';
import { checkMapping, collisions } from './mapping.js';

const NAME_LIKE = /\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)+/gu;
/** A stream tries to let text out once it holds this many holdbacks, so each push reads little of the tail again. */
const CUT_AFTER = 4;
const centsKey = (minor: number, decimals: number): number => Math.round((minor / 10 ** decimals) * 100);

/** Lookups built once per mapping, shared by one-shot, reusable and streaming unblind. */
interface Prepared {
  mapping: Pick<Mapping, 'factor' | 'dayShift' | 'dateOrder' | 'refYear'>;
  fakeWords: ReadonlySet<string>;
  mode: ReplaceWith;
  /** Amounts, dates or both left as written by blind: one the mapping does not know is the answer's own and stays as written. */
  keptAmounts: boolean;
  keptDates: boolean;
  /** The text pairs, read by the same rule blind claimed its fakes by. */
  log: PairLog;
  /** Where a fake of the mapping is written in a text. */
  findPairs: (text: string) => Array<[number, number]>;
  /** Where a phone, IBAN or id fake is written in another layout, with its key in `flexReal`. */
  findFlex: (text: string) => Array<[number, number, string]>;
  /** The real value behind a phone, IBAN or id fake, by the fake's letters and digits. */
  flexReal: Map<string, string>;
  amountExact: Map<string, string>;
  amountByValue: Map<number, string>;
  dateExact: Map<string, string>;
  /** Dates by their fake in lower case, for a fake the model wrote in another case. */
  dateAnyCase: Map<string, string>;
  /** Pairs whose fake an earlier pair with another real value already holds. */
  collisions: Collision[];
  /** Longest stretch a stream holds back, so no value is cut in two. */
  holdback: number;
}

/**
 * A span unblind might rewrite: a fake of the mapping, something the model
 * invented (an address or a placeholder the mapping does not know), or an
 * amount or date to map back. `kind` and `priority` are what `resolveSpans`
 * reads; `what` is what `rewrite` switches on.
 */
type Candidate = Span & {
  /** Where the value and anything it reads around it begin and end. */
  outerStart: number;
  outerEnd: number;
} & ({ what: 'pair' } | { what: 'flex'; real: string } | { what: 'invented' } | { what: 'amount'; occ: AmountOcc } | { what: 'date'; occ: DateOcc });

/** Checks `mapping` and builds the lookups every restore of it reads. Throws `invalid-mapping` with the field when it is not valid. */
function prepare(mapping: Mapping): Prepared {
  // A damaged or hand-edited mapping is refused by name: a factor of 0 would write `Infinity` into the answer.
  checkMapping(mapping);
  // Own the pairs so a caller editing the source mapping cannot change a prepared restore.
  const pairs = mapping.pairs.map(({ kind, real, fake }) => ({ kind, real, fake }));
  const { factor, dayShift, dateOrder, refYear } = mapping;
  const mode = mapping.replaceWith ?? 'fake';
  // Placeholders stand for amounts and dates too, and are matched like any other fake.
  const placeholders = mode === 'placeholder';
  const textPairs = placeholders ? pairs : pairs.filter((p) => p.kind !== 'amount' && p.kind !== 'date');
  // Placeholders come back exactly as written, never in the case habit of a name.
  const log = new PairLog(textPairs, !placeholders);

  const amountExact = new Map<string, string>();
  const amountByValue = new Map<number, string>();
  for (const p of pairs) {
    if (p.kind !== 'amount' || placeholders) continue;
    if (!amountExact.has(p.fake)) amountExact.set(p.fake, p.real);
    const parsed = parseNumber(foldLookalikes(p.fake));
    if (parsed && !amountByValue.has(centsKey(parsed.minor, parsed.decimals))) {
      amountByValue.set(centsKey(parsed.minor, parsed.decimals), p.real);
    }
  }
  const dateExact = new Map<string, string>();
  const dateAnyCase = new Map<string, string>();
  for (const p of pairs) {
    if (p.kind !== 'date' || placeholders) continue;
    if (!dateExact.has(p.fake)) dateExact.set(p.fake, p.real);
    if (!dateAnyCase.has(p.fake.toLowerCase())) dateAnyCase.set(p.fake.toLowerCase(), p.real);
  }

  const fakeWords = new Set(pairs.filter((p) => p.kind === 'person').map((p) => asciiLower(p.fake)));
  const keys = log.keys();
  // A placeholder carries its own brackets, so it is found even when the model glues a letter to it.
  const findPairs = placeholders ? literalFinder(keys, '', '') : fakeFinder(keys);
  // A model often writes a number its own way (`+447700900692`, a card with dashes). A phone, IBAN or id fake
  // is also found by its letters and digits in any layout, the first pair with them winning as everywhere else.
  // An IP address is left out: its dots carry the value (`192.0.2.123` is not `192.0.21.23`). So is a fake whose
  // letters and digits two different values share, which only the layout as written tells apart.
  const flexReal = new Map<string, string>();
  const shared = new Set<string>();
  for (const p of placeholders ? [] : pairs) {
    if (p.kind !== 'phone' && p.kind !== 'iban' && p.kind !== 'id') continue;
    if (p.kind === 'id' && (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(p.fake) || p.fake.includes(':'))) continue;
    const key = flexKey(p.fake);
    if (key.length < FLEX_MIN) continue;
    const held = flexReal.get(key);
    if (held === undefined) flexReal.set(key, p.real);
    else if (flexKey(held) !== flexKey(p.real)) shared.add(key);
  }
  for (const key of shared) flexReal.delete(key);
  const findFlex = flexFinder([...flexReal.keys()]);
  const longest = pairs.reduce((n, p) => Math.max(n, p.fake.length), 0);
  // In another layout a fake takes up to two separators after each letter or digit.
  const longestFlex = 3 * [...flexReal.keys()].reduce((n, k) => Math.max(n, k.length), 0);
  const keep = new Set(mapping.keep ?? []);
  return { mapping: { factor, dayShift, dateOrder, refYear }, mode, keptAmounts: keep.has('amount'), keptDates: keep.has('date'), log, findPairs, findFlex, flexReal, fakeWords, amountExact, amountByValue, dateExact, dateAnyCase, collisions: collisions(mapping), holdback: Math.max(longest, longestFlex, 80) + 8 };
}

/** Every span unblind might rewrite in `text`, before overlaps are resolved. */
function candidates(text: string, prep: Prepared): Candidate[] {
  const out: Candidate[] = [];
  const at = (start: number, end: number, outerStart = start, outerEnd = end): Pick<Candidate, 'start' | 'end' | 'outerStart' | 'outerEnd'> => ({ start, end, outerStart, outerEnd });
  for (const [start, end] of prep.findPairs(text)) {
    out.push({ ...at(start, end), what: 'pair', kind: 'person', priority: 100 });
  }
  for (const [start, end, key] of prep.findFlex(text)) {
    // Written as the mapping has it, a fake is a pair above.
    if (prep.log.knows(text.slice(start, end))) continue;
    out.push({ ...at(start, end), what: 'flex', real: prep.flexReal.get(key) as string, kind: 'id', priority: 98 });
  }
  const ctx = { dateOrder: prep.mapping.dateOrder, isAllowedHost: () => false };
  const pairSpans = out.filter((c) => c.what === 'pair');
  if (prep.mode === 'placeholder') {
    // A placeholder the mapping does not know was made up by the model.
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      if (prep.log.knows(m[0])) continue;
      out.push({ ...at(m.index, m.index + m[0].length), what: 'invented', kind: 'person', priority: 99 });
    }
  }
  for (const s of emailDetector.detect(text, ctx)) {
    if (s.kind !== 'email') continue;
    if (prep.log.knows(text.slice(s.start, s.end))) continue;
    // An address inside a fake URL belongs to that URL.
    if (pairSpans.some((p) => s.start < p.end && p.start < s.end)) continue;
    out.push({ ...at(s.start, s.end), what: 'invented', kind: s.kind, priority: 101 });
  }
  // Amounts are read in the fold of the text, so a fake written with full-width digits is found.
  for (const a of detectAmounts(foldLookalikes(text))) {
    out.push({ ...at(a.start, a.end, Math.min(a.start, a.fullStart), Math.max(a.end, a.fullEnd)), what: 'amount', kind: 'amount', priority: 80, occ: a });
  }
  for (const d of detectDates(text, prep.mapping.dateOrder)) {
    out.push({ ...at(d.start, d.end), what: 'date', kind: 'date', priority: 78, occ: d.occ });
  }
  return out;
}

/**
 * Rewrites `text` up to `end` from `found`, the candidates of `text` that end
 * by then. Invented values are pushed onto `invented` in order.
 */
function rewrite(text: string, prep: Prepared, invented: string[], found = candidates(text, prep), end = text.length): string {
  const { mapping } = prep;
  let out = '';
  let at = 0;
  // Only `fake` scaled the amounts and shifted the dates. With placeholders or random values a new amount or date has no real one behind it.
  const scaled = prep.mode === 'fake';
  for (const s of resolveSpans(found)) {
    const lit = text.slice(s.start, s.end);
    let rep: string | null = null;
    switch (s.what) {
      case 'pair':
        rep = prep.log.restore(lit) ?? null;
        break;
      case 'flex':
        rep = flexRestore(lit, s.real);
        break;
      case 'invented':
        invented.push(lit);
        break;
      case 'amount': {
        const a = s.occ;
        const exact = prep.amountExact.get(lit) ?? prep.amountByValue.get(centsKey(a.minor, a.decimals));
        if (exact !== undefined) rep = exact;
        else if (!prep.keptAmounts) {
          if (scaled) rep = formatNumber(Math.max(0, Math.round(a.minor / mapping.factor)), a.decimals, a.dec, a.thou);
          invented.push(text.slice(a.fullStart, a.fullEnd));
        }
        break;
      }
      case 'date': {
        const exact = prep.dateExact.get(lit) ?? prep.dateAnyCase.get(lit.toLowerCase());
        if (exact !== undefined) rep = exact;
        else if (!prep.keptDates) {
          if (scaled) rep = renderDate(shiftOcc(s.occ, -mapping.dayShift, mapping.refYear));
          invented.push(lit);
        }
        break;
      }
    }
    if (rep === null) continue;
    out += text.slice(at, s.start) + rep;
    at = s.end;
  }
  return out + text.slice(at, end);
}

/** The `maxTextLength` of `opts`, checked. */
function limitOf(opts: UnblindOptions | undefined): number {
  const limit = opts?.maxTextLength ?? MAX_TEXT_LENGTH;
  checkLimit('unblind', limit);
  return limit;
}

/** Refuses an answer longer than `limit` before any work is done. */
function checkSize(length: number, limit: number): void {
  if (length > limit) throw new InputTooLargeError(0, length, limit, 'unblind');
}

/** Refuses an answer or chunk that is not a string, by name, before any work is done. */
function checkText(text: unknown): asserts text is string {
  if (typeof text !== 'string') throw new BlindError('invalid-option', 'unblind: the text must be a string');
}

const FIRST_NAMES = Surrogates.firstNameSet();
/** Names the model made up: a first name from our lists with no surrogate behind it. */
function inventedNames(text: string, fakeWords: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NAME_LIKE)) {
    const words = m[0].split(/\s+/).map(asciiLower);
    if (FIRST_NAMES.has(words[0] as string) && !words.every((w) => fakeWords.has(w))) out.push(m[0]);
  }
  return out;
}

/**
 * Put real values back into text that came from a blind copy. With `fake`
 * output, amounts are divided by the factor and dates shifted back. With
 * `placeholder` and `random` output an amount or date that is not a known fake
 * stays as written, and so does one of a kind the mapping keeps (`keep`), which
 * is not listed either: nothing was scaled or shifted. `invented` lists amounts, dates, emails, names and unknown
 * placeholders in the text that no surrogate stands behind. `collisions`
 * lists mapping pairs that share a fake with an earlier pair, by kind and
 * index, since those come back as the earlier value. An answer longer than
 * `maxTextLength` (1,048,576 UTF-16 code units by default) throws an
 * `input-too-large` error before any work is done.
 */
export function unblind(text: string, mapping: Mapping, opts?: UnblindOptions): UnblindResult {
  checkText(text);
  checkSize(text.length, limitOf(opts));
  const prep = guard('unblind', 'reading the mapping', () => prepare(mapping));
  return restore(text, prep);
}

function restore(text: string, prep: Prepared): UnblindResult {
  return guard('unblind', 'rewriting the text', () => {
    const invented: string[] = [];
    const out = rewrite(text, prep, invented);
    return { text: out, invented: [...new Set([...invented, ...inventedNames(text, prep.fakeWords)])], collisions: prep.collisions.map((c) => ({ ...c })) };
  });
}

export interface PreparedUnblinder {
  /** Restore one independent text. Limits and invented values apply to this text alone. */
  unblind(text: string): UnblindResult;
}

/**
 * Snapshot a mapping and build its lookups once for many independent texts.
 * Each call has fresh result arrays and no stream state. To use an extended
 * conversation mapping, prepare it again. The text limit applies per call.
 */
export function prepareUnblinder(mapping: Mapping, opts?: UnblindOptions): PreparedUnblinder {
  const limit = limitOf(opts);
  const prep = guard('unblind', 'reading the mapping', () => prepare(mapping));
  return {
    unblind(text) {
      checkText(text);
      checkSize(text.length, limit);
      return restore(text, prep);
    },
  };
}

export interface Unblinder {
  /** Feed the next chunk. Returns the text that is now safe to show, possibly empty. */
  push(chunk: string): string;
  /** No more chunks. Returns the rest of the text and everything the whole answer invented. */
  end(): UnblindResult;
}

/**
 * Unblind a streamed answer chunk by chunk. A value can arrive split across
 * chunks, so the tail of the stream is held back until it can no longer be
 * part of one. The pieces joined are exactly what `unblind` returns for the
 * whole answer, and `end()` reports the same `invented` list.
 *
 * A push looks for values once the stream holds a few holdbacks of text, in
 * the held-back tail and what came after it, and the piece it lets out is
 * rewritten from what that look found. So the work grows with the answer, not
 * with the answer times the pushes, and text comes out a few holdbacks at a
 * time.
 * The whole answer is kept until `end()`, because the names it invented are
 * read over the whole answer so they match one-shot `unblind` exactly. Memory
 * grows with the answer, not with the holdback. `maxTextLength` counts every
 * chunk pushed, and the push that passes it throws `input-too-large`.
 */
export function createUnblinder(mapping: Mapping, opts?: UnblindOptions): Unblinder {
  const limit = limitOf(opts);
  const prep = guard('unblind', 'reading the mapping', () => prepare(mapping));
  let pending = '';
  const all: string[] = [];
  let total = 0;
  let done = false;
  const ignored: string[] = [];
  return {
    push: (chunk) => guard('unblind', 'rewriting a chunk', () => {
      if (done) throw new BlindError('stream-closed', 'unblind: push after end');
      checkText(chunk);
      checkSize(total + chunk.length, limit);
      total += chunk.length;
      pending += chunk;
      all.push(chunk);
      // A cut reads the held-back tail again, so it waits until the stream holds a few tails' worth.
      if (pending.length < CUT_AFTER * prep.holdback) return '';
      const last = pending.length - prep.holdback;
      const spans = candidates(pending, prep);
      // The last place before the held-back tail where a piece may end: a space no value or its surroundings cross.
      let c = last;
      for (; c > 0; c--) {
        if (!/\s/.test(pending[c] as string)) continue;
        if (!spans.some((s) => s.outerStart < c && c < s.outerEnd)) break;
      }
      if (c === 0) return '';
      const piece = rewrite(pending, prep, ignored, spans.filter((s) => s.outerEnd <= c), c);
      pending = pending.slice(c);
      return piece;
    }),
    end: () => guard('unblind', 'rewriting the last chunk', () => {
      if (done) throw new BlindError('stream-closed', 'unblind: end called twice');
      done = true;
      const text = rewrite(pending, prep, ignored);
      pending = '';
      return { text, invented: [...new Set([...ignored, ...inventedNames(all.join(''), prep.fakeWords)])], collisions: prep.collisions.map((c) => ({ ...c })) };
    }),
  };
}
