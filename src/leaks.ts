import { detectAmounts } from './amounts.js';
import { dateKey, detectDates } from './dates.js';
import { oneLetterPart, shortNamePart, stopWordValue, twoLetterStop, writtenAs } from './detect.js';
import { foldLookalikes, skeleton } from './fold.js';
import { TextLanguage } from './language.js';
import { literalIndex } from './literal-index.js';
import { alternativesMatcher, flexAtoms, literalAtoms } from './match.js';
import { gluedPrefixBefore, unspaced, wordEdges } from './script.js';
import type { DateOrder, Kind, LeakHit, LeakReport, UnenforcedKnown } from './types.js';
import { guard, LeakError, type LeakReportInput } from './errors.js';

export interface Original {
  kind: Kind;
  value: string;
  /** A value the caller gave in `known`: checked at any length the matcher accepts, a value made of stop words as written or in capitals. */
  known?: boolean;
  /** A two-letter part of a known full name ("Li" of "Li Na"): a copy in lower case counts too, unless the language of the text there writes it as a word. */
  lowerCase?: boolean;
}

export interface LeakInput {
  outputs: string[];
  /** Per output text, the ranges the engine wrote. Amounts and dates are checked outside them. */
  replaced: Array<Array<[number, number]>>;
  originals: Original[];
  deny: string[];
  amountKeys: Set<string>;
  dateKeys: Set<string>;
  dateOrder: DateOrder;
  /** The `known` entries enforced only in part, from `checkKnown`. They go into the report as given and never make it fail. */
  unenforced?: UnenforcedKnown[];
}

const norm = (s: string): string => skeleton(foldLookalikes(s)).text;
const WORD = /[\p{L}\p{N}_]/u;

/** Every occurrence of a plain deny entry, including overlapping copies. */
function* occurrences(hay: string, needle: string): Generator<number> {
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) return;
    from = i + 1;
    yield i;
  }
}

/** The same word edges and glued prefixes detection uses for known values. */
function hasEdges(hay: string, needle: string, at: number, wholeWord: boolean): boolean {
  if (!wholeWord) return true;
  const edges = wordEdges(needle);
  const before = hay[at - 1];
  const after = hay[at + needle.length];
  if (edges.before && before !== undefined && WORD.test(before) && !gluedPrefixBefore(hay, at, needle)) return false;
  return !(edges.after && after !== undefined && WORD.test(after));
}

const ALNUM = /[A-Za-z0-9]/;

/**
 * A phone, IBAN or id written with other spacing or punctuation. A colon only counts as a
 * separator when the value has one (IPv6): otherwise a time such as 10:00:00 reads as the
 * six digits 100000 and the check reports a leak that is not there. Null when the value
 * has fewer than six letters and digits, which is too short to look for, or fewer than two
 * for a value the caller gave in `known`, which the caller asked to have checked.
 */
function flexValue(value: string, known: boolean): { chars: string; colon: boolean } | null {
  const chars = value.replace(/[^A-Za-z0-9]/g, '');
  return chars.length < (known ? 2 : 6) ? null : { chars, colon: value.includes(':') };
}

const flexSep = (colon: boolean): string => (colon ? String.raw`[\s.\-():]*` : String.raw`[\s.\-()]*`);

function overlaps(s: number, e: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([a, b]) => s < b && a < e);
}

/** Never throws with a value in the message: see `guard`. */
export function checkLeaks(input: LeakInput): LeakReport {
  return guard('blind', 'checking for leaks', () => scan(input, prepare(input.originals, input.deny)));
}

/** An original searched as text: its accent-free form and the rule it is matched under. */
interface WordValue {
  rule: 'word';
  kind: Kind;
  n: string;
  /** A word character may not touch it (see `occurrences`). */
  wholeWord: boolean;
  /** A two-letter name part, which only counts written capitalised. */
  capitalised: boolean;
  /** A known value made of stop words ("Al"): counts only as written or in capitals, as the matcher finds it. */
  exact?: string;
  /** Also counts written all in lower case where that is not a stop word in the text's language: see `Original.lowerCase`. */
  lowerCase?: boolean;
}

/**
 * What the leak check needs from the originals and the deny list, worked out
 * once per call and reused for every output: folding each value again for
 * each output made the check cost outputs times originals.
 */
interface Prepared {
  /** In the order given, so hits come out in that order. */
  values: Array<FlexValue | WordValue>;
  /** A plain entry, accent-free and matched anywhere, or a `*@domain` entry's matcher for every address at the domain or under it. */
  deny: Array<string | Matcher>;
}

type Matcher = (text: string) => Array<[number, number]>;

/** A phone, IBAN or id: its letters and digits, matched with any separators between them. */
interface FlexValue {
  rule: 'flex';
  kind: Kind;
  chars: string;
  colon: boolean;
  match: Matcher;
}

function prepare(all: Original[], deny: string[]): Prepared {
  const out: Prepared = { values: [], deny: [] };
  const seen = new Map<string, WordValue | null>();
  // Values that end up under the same rule are one value, so each surviving copy is one hit:
  // a known value and the same value found in the text, or an id given in two layouts.
  const rules = new Map<string, WordValue | FlexValue>();
  for (const o of all) {
    // A one-letter part of a known full name ("O" of "O Li") counts as written or in capitals, like a stop word.
    const exact = o.known === true && (stopWordValue(o.value) || (o.kind === 'person' && oneLetterPart(o.value))) ? o.value.trim() : undefined;
    // A capitalised two-letter name part ("Mo") and the same letters found in lower case ("mo") are checked under different rules.
    const namePart = o.kind === 'person' && shortNamePart(o.value.trim());
    const folded = norm(o.value);
    const k = `${o.kind}|${o.known ? 'known|' : ''}${namePart ? 'part|' : ''}${exact ?? folded}`;
    if (seen.has(k)) {
      // The same part found in the text and given in `known` is one value, under the wider rule.
      const had = seen.get(k);
      if (had && o.lowerCase) had.lowerCase = true;
      continue;
    }
    seen.set(k, null);
    if (o.kind === 'amount' || o.kind === 'date') continue;
    if (o.kind === 'phone' || o.kind === 'iban' || o.kind === 'id') {
      const f = flexValue(o.value, o.known === true);
      if (f) {
        const rule = `${o.kind}|flex|${f.colon ? ':' : ''}|${f.chars.toLowerCase()}`;
        if (rules.has(rule)) continue;
        const match = alternativesMatcher([flexAtoms([...f.chars], flexSep(f.colon))], '(?<![A-Za-z0-9])', '(?![A-Za-z0-9])', 'i');
        const v: FlexValue = { rule: 'flex', kind: o.kind, ...f, match };
        rules.set(rule, v);
        out.values.push(v);
        continue;
      }
      // A known id with fewer than two ASCII letters and digits ("日本", "Ä-") is searched as text below.
      if (o.known !== true) continue;
    }
    const n = folded.trim();
    const short = [...n].length < 3;
    // A short value is checked when it is in a script without word spaces, or when it
    // is a two-letter name part ("Li" of "Li Na"), which only counts written capitalised.
    // A known value of two characters or more is checked as given, in any case.
    const known = o.known === true && ([...n].length >= 2 || exact !== undefined);
    if (short && !known && !namePart && !(n.length > 0 && [...n].every(unspaced))) continue;
    const w: WordValue = { rule: 'word', kind: o.kind, n, wholeWord: o.kind === 'person' || n.length < 5, capitalised: namePart && short && !known, exact };
    const rule = `${w.kind}|${w.wholeWord ? 'word' : ''}|${w.capitalised ? 'cap' : ''}|${w.exact ?? ''}|${n}`;
    const same = rules.get(rule);
    if (same?.rule === 'word') {
      if (o.lowerCase) same.lowerCase = true;
      seen.set(k, same);
      continue;
    }
    if (o.lowerCase) w.lowerCase = true;
    seen.set(k, w);
    rules.set(rule, w);
    out.values.push(w);
  }
  for (const entry of deny) {
    const e = entry.trim();
    if (e.length < 2) continue;
    if (e.startsWith('*@')) {
      // A domain is at most 253 characters, so a real one is always matched as one pattern.
      // Past 256 characters the pattern is cut, and an address that repeats the
      // domain's first piece among its own labels may then be missed.
      const address = String.raw`[A-Za-z0-9._%+\-]+@(?:[A-Za-z0-9\-]+\.)*`;
      out.deny.push(alternativesMatcher([literalAtoms(e.slice(2))], address, '(?![A-Za-z0-9\\-])', 'i'));
    } else {
      out.deny.push(norm(e));
    }
  }
  return out;
}

function scan(input: LeakInput, prep: Prepared): LeakReport {
  const hits: LeakHit[] = [];
  const findWords = literalIndex(prep.values.map((w) => w.rule === 'word' ? w.n : ''));
  const flexible = prep.values.flatMap((w, index) => w.rule === 'flex' ? [{ index, match: w.match }] : []);
  // The language of each output with the engine's own text blanked, as detection read the input.
  let lang: TextLanguage | undefined;
  const language = (): TextLanguage => (lang ??= new TextLanguage(input.outputs, input.replaced.map((rs) => rs.map(([start, end]) => ({ start, end })))));

  input.outputs.forEach((out, textIndex) => {
    // Values are searched in a lower-cased, accent-free copy. Offsets are mapped back to `out`.
    const sk = skeleton(foldLookalikes(out));
    const hay = sk.text;
    const push = (kind: LeakHit['kind'], offset: number): void => {
      hits.push({ kind, textIndex, offset });
    };
    const at = (i: number): number => sk.from[i] ?? i;

    const matches = findWords(hay);
    for (const { index, match } of flexible) {
      const offsets = match(out).map(([offset]) => offset);
      if (offsets.length) matches.set(index, offsets);
    }
    // Keep the report's original rule order, then occurrence order within each rule.
    for (const [index, offsets] of [...matches].sort(([a], [b]) => a - b)) {
      const w = prep.values[index]!;
      if (w.rule === 'flex') {
        for (const offset of offsets) push(w.kind, offset);
        continue;
      }
      for (const i of offsets) {
        if (!hasEdges(hay, w.n, i, w.wholeWord)) continue;
        const slice = w.lowerCase || w.exact !== undefined ? out.slice(at(i), at(i + w.n.length - 1) + 1) : '';
        if (w.lowerCase && !/\p{Lu}/u.test(slice)) {
          if (twoLetterStop(w.n, language().at(textIndex, at(i)))) continue;
        } else {
          if (w.capitalised && !/\p{Lu}/u.test(out[at(i)] ?? '')) continue;
          if (w.exact !== undefined && !writtenAs(slice, w.exact)) continue;
        }
        push(w.kind, at(i));
      }
    }

    const ranges = input.replaced[textIndex] ?? [];
    for (const a of detectAmounts(out)) {
      const key = `${a.decimals}:${a.minor}`;
      if (input.amountKeys.has(key) && !overlaps(a.start, a.end, ranges)) push('amount', a.start);
    }
    for (const d of detectDates(out, input.dateOrder)) {
      if (input.dateKeys.has(dateKey(d.occ)) && !overlaps(d.start, d.end, ranges)) push('date', d.start);
    }

    for (const e of prep.deny) {
      if (typeof e === 'string') for (const i of occurrences(hay, e)) push('deny', at(i));
      else for (const [offset] of e(out)) push('deny', offset);
    }
  });

  return { ok: hits.length === 0, hits, unenforced: input.unenforced ?? [] };
}

/** The alphanumeric runs of `text` that a flex value may span, as `[start, end]` per run, split where a non-separator stands. */
function flexSegments(text: string, colon: boolean): Array<Array<[number, number]>> {
  const sep = new RegExp(`^${flexSep(colon).slice(0, -1)}$`);
  const segments: Array<Array<[number, number]>> = [];
  let runs: Array<[number, number]> = [];
  for (let i = 0; i < text.length;) {
    const ch = text[i] as string;
    if (ALNUM.test(ch)) {
      let j = i + 1;
      while (j < text.length && ALNUM.test(text[j] as string)) j++;
      runs.push([i, j]);
      i = j;
    } else {
      if (!sep.test(ch)) {
        if (runs.length) segments.push(runs);
        runs = [];
      }
      i++;
    }
  }
  if (runs.length) segments.push(runs);
  return segments;
}

/**
 * A test for short texts, built once: does `checkLeaks` on this one text, with
 * nothing marked as written by blind, find anything? The scaling plan asks it
 * of every fake amount and date it draws, hundreds of short strings against
 * thousands of originals, so instead of searching each original in each fake
 * it looks each piece of the fake up among the originals. Its cost is the
 * fake's length squared, never the number of originals.
 */
export function shortTextLeaks(input: Omit<LeakInput, 'outputs' | 'replaced'>): (text: string) => boolean {
  const prep = prepare(input.originals, input.deny);
  // Accent-free value -> how it may match: anywhere, as a whole word, as a capitalised whole word.
  const byText = new Map<string, { loose: boolean; word: boolean; capitalised: boolean }>();
  const entry = (n: string): { loose: boolean; word: boolean; capitalised: boolean } => {
    let e = byText.get(n);
    if (!e) byText.set(n, (e = { loose: false, word: false, capitalised: false }));
    return e;
  };
  const flex = [new Set<string>(), new Set<string>()];
  const domains: Matcher[] = [];
  for (const w of prep.values) {
    if (w.rule === 'flex') {
      flex[w.colon ? 1 : 0]!.add(w.chars.toLowerCase());
      continue;
    }
    const e = entry(w.n);
    if (!w.wholeWord) e.loose = true;
    // A value made of stop words counts here when capitalised, a superset of as written or in capitals.
    else if (w.capitalised || w.exact !== undefined) e.capitalised = true;
    else e.word = true;
  }
  for (const d of prep.deny) {
    if (typeof d === 'string') entry(d).loose = true;
    else domains.push(d);
  }
  const lengths = [...new Set([...byText.keys()].map((n) => n.length))].sort((a, b) => a - b);

  const flexHit = (text: string): boolean => {
    for (const colon of [false, true]) {
      const keys = flex[colon ? 1 : 0]!;
      if (keys.size === 0) continue;
      for (const runs of flexSegments(text, colon)) {
        for (let a = 0; a < runs.length; a++) {
          let chars = '';
          for (let b = a; b < runs.length; b++) {
            const [s, e] = runs[b]!;
            chars += text.slice(s, e).toLowerCase();
            if (keys.has(chars)) return true;
          }
        }
      }
    }
    return false;
  };

  return (text) => {
    if (flexHit(text)) return true;
    const sk = skeleton(foldLookalikes(text));
    const hay = sk.text;
    for (let i = 0; i <= hay.length; i++) {
      for (const len of lengths) {
        if (i + len > hay.length) break;
        const n = hay.slice(i, i + len);
        const e = byText.get(n);
        if (!e) continue;
        if (e.loose) return true;
        const edges = wordEdges(n);
        const before = hay[i - 1];
        const after = hay[i + len];
        if (edges.before && before !== undefined && WORD.test(before) && !gluedPrefixBefore(hay, i, n)) continue;
        if (edges.after && after !== undefined && WORD.test(after)) continue;
        if (e.word) return true;
        if (/\p{Lu}/u.test(text[sk.from[i] ?? i] ?? '')) return true;
      }
    }
    for (const a of detectAmounts(text)) if (input.amountKeys.has(`${a.decimals}:${a.minor}`)) return true;
    for (const d of detectDates(text, input.dateOrder)) if (input.dateKeys.has(dateKey(d.occ))) return true;
    return domains.some((match) => match(text).length > 0);
  };
}


/** Throws when the leak check found anything. `unenforced` alone never throws. The message never contains a value. */
export function assertNoLeaks(result: { leaks: LeakReportInput }): void {
  if (!result.leaks.ok) throw new LeakError(result.leaks);
}

export function denyDomains(deny: string[]): Set<string> {
  return new Set(deny.filter((d) => d.startsWith('*@')).map((d) => d.slice(2).trim().toLowerCase()));
}
