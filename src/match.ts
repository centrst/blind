/**
 * Pattern matching over values: a value as a list of atoms, and a matcher
 * for many alternatives that never throws, however long a value is.
 */

import { GLUED_PREFIX_SRC, gluedPrefixBefore, UNSPACED_SRC } from './script.js';

export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

// ------------------------------------------------------- value-derived patterns

/**
 * A value is turned into a pattern as a list of atoms: small regex sources
 * matched one after another, each for one character or one separator run. The
 * engine refuses a long run of atoms (a few thousand, depending on the
 * pattern) and its error quotes the whole pattern, value and all. So a pattern
 * is cut into pieces of at most PIECE atoms whenever a value is that long.
 */
const PIECE = 256;

/** One atom per character, escaped. */
export function literalAtoms(s: string): string[] {
  return [...s].map(esc);
}

/** One atom per character, with every run of whitespace matching any run of whitespace. */
export function spacedAtoms(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s/.test(part)) out.push(String.raw`\s+`);
    else out.push(...literalAtoms(part));
  }
  return out;
}

/** `chars` with any run of `sep` allowed between two of them: a phone, IBAN or id in another layout. */
export function flexAtoms(chars: string[], sep: string): string[] {
  return chars.flatMap((c, i) => (i === 0 ? [esc(c)] : [sep, esc(c)]));
}

/**
 * A matcher for `before(?:a1|a2|...)after`, where each alternative is a list
 * of atoms. It returns every match's start and end, as `matchAll` finds them.
 * A quantified atom must never match the first character of the atom after it,
 * so an alternative matches the same way however it is cut. When an
 * alternative is too long for one pattern, or the engine refuses the pattern,
 * each alternative is matched piece by piece with sticky patterns, in order, at
 * every place one may start. Never throws for any value or text.
 */
export function alternativesMatcher(alts: string[][], before: string, after: string, flags: string): (text: string) => Array<[number, number]> {
  const usable = alts.filter((a) => a.length > 0);
  if (usable.length === 0) return () => [];
  let pieces = usable.every((a) => a.length <= PIECE) ? null : piecesMatcher(usable, before, after, flags);
  if (pieces) return pieces;
  let whole: RegExp | null = null;
  try {
    whole = new RegExp(`${before}(?:${usable.map((a) => a.join('')).join('|')})${after}`, `${flags}g`);
  } catch {
    // Too large for the engine as one pattern.
  }
  return (text) => {
    if (whole) {
      try {
        return [...text.matchAll(whole)].map((m) => [m.index, m.index + m[0].length]);
      } catch {
        // The engine compiles on first use and may refuse the pattern only then.
        whole = null;
      }
    }
    pieces ??= piecesMatcher(usable, before, after, flags);
    return pieces(text);
  };
}

/** `alternativesMatcher` for one text. */
export function matchAlternatives(text: string, alts: string[][], before: string, after: string, flags: string): Array<[number, number]> {
  return alternativesMatcher(alts, before, after, flags)(text);
}

function piecesMatcher(alts: string[][], before: string, after: string, flags: string): (text: string) => Array<[number, number]> {
  const tail = new RegExp(after || '(?:)', `${flags}y`);
  const compiled = alts.map((atoms) => {
    const parts: string[] = [];
    for (let i = 0; i < atoms.length; i += PIECE) parts.push(atoms.slice(i, i + PIECE).join(''));
    const head = `${before}${parts[0] as string}`;
    return {
      find: new RegExp(head, `${flags}g`),
      seq: [new RegExp(head, `${flags}y`), ...parts.slice(1).map((p) => new RegExp(p, `${flags}y`)), tail],
    };
  });
  return (text) => {
    // A match can only start where the first piece of some alternative matches.
    const starts = new Set<number>();
    for (const c of compiled) {
      c.find.lastIndex = 0;
      for (let m = c.find.exec(text); m; m = c.find.exec(text)) {
        starts.add(m.index);
        c.find.lastIndex = m.index + ((text.codePointAt(m.index) as number) > 0xffff ? 2 : 1);
      }
    }
    const endAt = (seq: RegExp[], start: number): number => {
      let at = start;
      for (const re of seq) {
        re.lastIndex = at;
        if (!re.test(text)) return -1;
        at = re.lastIndex;
      }
      return at;
    };
    const out: Array<[number, number]> = [];
    let from = 0;
    for (const s of [...starts].sort((a, b) => a - b)) {
      if (s < from) continue;
      for (const c of compiled) {
        const e = endAt(c.seq, s);
        if (e > s) {
          out.push([s, e]);
          from = e;
          break;
        }
      }
    }
    return out;
  };
}

/**
 * Where a fake may start or end: not between two letters and not between two
 * digits. So "Ana" is never found inside "Banana" and "791 123 456" never
 * inside a longer number, while a letter beside a digit is fine: blind writes
 * "hugo420" for "bresciani420" and "(107)171-7650x493" for a phone with an
 * extension. An edge that is neither a letter nor a digit refuses nothing, and
 * neither does a letter of a script without word spaces or a Hangul letter:
 * blind replaces a Chinese name glued to the text around it, and a Korean name
 * with a particle glued on (`김민수는`), so its fake is glued there too. A fake
 * may also start right after a Hebrew or Arabic prefix glued on at a word start
 * (`לדוד` becomes `ל` and the fake), since blind keeps the prefix there.
 */
const GLUED_SRC = String.raw`(?:${UNSPACED_SRC}|\p{scx=Hangul})`;
const END = String.raw`(?!(?<=\p{L})(?<!${GLUED_SRC})(?!${GLUED_SRC})\p{L})(?!(?<=\p{N})\p{N})`;
const START = String.raw`(?!(?<=\p{L})(?<!${GLUED_SRC})(?<!${GLUED_PREFIX_SRC})(?!${GLUED_SRC})\p{L})(?!(?<=\p{N})\p{N})`;
const LETTER = new RegExp(String.raw`^(?!${GLUED_SRC})\p{L}$`, 'u');
const DIGIT = /^\p{N}$/u;

/**
 * The pattern unblind finds any of `fakes` by, longest first, in any letter
 * case with the `giu` flags. It checks where a fake ends. Where it starts
 * depends only on the place in the text, so `fakeStartsAt` checks that on each
 * match, which keeps the scan as fast as one without the check.
 */
export function fakesPattern(fakes: readonly string[]): string {
  return `(?:${[...fakes].sort((a, b) => b.length - a.length).map(esc).join('|')})${END}`;
}

/**
 * Where any of `fakes` is written in a text, start and end: the places
 * `findFakes` finds with `fakesPattern`, for fakes of any length.
 */
export function fakeFinder(fakes: readonly string[]): (text: string) => Array<[number, number]> {
  return literalFinder(fakes, START, END);
}

/** True when a fake may start at `at` in `text`. */
export function fakeStartsAt(text: string, at: number): boolean {
  if (at === 0 || gluedPrefixBefore(text, at)) return true;
  const prev = String.fromCodePoint(text.codePointAt(at - 1 - (/[\udc00-\udfff]/.test(text[at - 1] as string) && at > 1 ? 1 : 0)) as number);
  const next = String.fromCodePoint(text.codePointAt(at) as number);
  return !((LETTER.test(prev) && LETTER.test(next)) || (DIGIT.test(prev) && DIGIT.test(next)));
}

/** Every place in `text` where `re`, made from `fakesPattern`, finds a fake that may start there. */
export function* findFakes(text: string, re: RegExp): Generator<RegExpExecArray> {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (fakeStartsAt(text, m.index)) yield m;
    else re.lastIndex = m.index + 1;
  }
}

/** A list of fakes as code points, in order, with lookups to the shorter lists that may still match after one more code point. */
interface FinderNode {
  alts: number[][];
  depth: number;
  next: Map<number, FinderNode> | null;
}

/** Fewer fakes than this are compared one by one instead of looked up a code point further. */
const LEAF = 12;

/**
 * What `alternativesMatcher(fakes longest first, before, after, 'iu')` finds,
 * without trying every fake at every place. A pattern over thousands of fakes
 * costs the text length times the fakes. Here the fakes that can still match
 * are narrowed a code point at a time, asking the engine once per code point of
 * the text which code points of the fakes it matches in any letter case. The
 * few left are compared in the same order the pattern tries them, each checked
 * with the same `after`, at the places the global pattern tries, where `before`
 * holds. So the matches are the same.
 */
export function literalFinder(fakes: readonly string[], before: string, after: string): (text: string) => Array<[number, number]> {
  const alts = [...fakes]
    .sort((a, b) => b.length - a.length)
    .map((f) => [...f].map((c) => c.codePointAt(0) as number))
    .filter((a) => a.length > 0);
  if (alts.length === 0) return () => [];
  const beforeRe = before ? new RegExp(before, 'iuy') : null;
  const afterRe = after ? new RegExp(after, 'iuy') : null;
  /** Each code point the fakes are written with, as a pattern matching what it matches with the `iu` flags. */
  const used = new Map<number, RegExp>();
  for (const a of alts) for (const cp of a) if (!used.has(cp)) used.set(cp, new RegExp(`^${esc(String.fromCodePoint(cp))}$`, 'iu'));
  /** The code points of the fakes that a code point of the text matches. */
  const equal = new Map<number, Set<number>>();
  const equalTo = (cp: number): Set<number> => {
    let set = equal.get(cp);
    if (!set) {
      const ch = String.fromCodePoint(cp);
      set = new Set([...used].filter(([, re]) => re.test(ch)).map(([c]) => c));
      equal.set(cp, set);
    }
    return set;
  };
  const node = (list: number[][], depth: number): FinderNode => ({
    alts: list,
    depth,
    // A short list, or one whose every fake is written out by now, is compared as it is.
    next: list.length > LEAF && list.some((a) => a.length > depth) ? new Map() : null,
  });
  const root = node(alts, 0);
  /** The fakes of `n` that may match when the code point at its depth is `cp`, or the text ends there (`cp` -1). */
  const child = (n: FinderNode, cp: number): FinderNode => {
    let c = n.next?.get(cp);
    if (c) return c;
    const ok = cp >= 0 ? equalTo(cp) : new Set<number>();
    const d = n.depth;
    c = node(
      n.alts.filter((a) => a.length <= d || ok.has(a[d] as number)),
      d + 1,
    );
    n.next?.set(cp, c);
    return c;
  };
  const holds = (re: RegExp | null, text: string, at: number): boolean => {
    if (!re) return true;
    re.lastIndex = at;
    return re.test(text);
  };
  /** Where the fake `a` ends when it is written at `p`, its first `from` code points already compared, or -1. */
  const endOf = (text: string, a: number[], p: number, from: number): number => {
    let at = p;
    for (let i = 0; i < a.length; i++) {
      if (at >= text.length) return -1;
      const cp = text.codePointAt(at) as number;
      if (i >= from && !equalTo(cp).has(a[i] as number)) return -1;
      at += cp > 0xffff ? 2 : 1;
    }
    return at;
  };
  return (text) => {
    const out: Array<[number, number]> = [];
    let p = 0;
    next: while (p < text.length) {
      const width = (text.codePointAt(p) as number) > 0xffff ? 2 : 1;
      let n = root;
      let at = p;
      while (n.next && n.alts.length > 0) {
        const cp = at < text.length ? (text.codePointAt(at) as number) : -1;
        n = child(n, cp);
        if (cp >= 0) at += cp > 0xffff ? 2 : 1;
      }
      // `before` depends only on the place, so it is asked once, and only where a fake is written.
      let starts: boolean | undefined;
      for (const a of n.alts) {
        const e = endOf(text, a, p, Math.min(n.depth, a.length));
        if (e <= p) continue;
        starts ??= holds(beforeRe, text, p);
        if (!starts) break;
        if (holds(afterRe, text, e)) {
          out.push([p, e]);
          p = e;
          continue next;
        }
      }
      p += width;
    }
    return out;
  };
}
