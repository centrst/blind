/**
 * Scripts and word edges. Which letters are written without word spaces,
 * how Korean glues particles onto a name, the one-letter words Hebrew and
 * Arabic glue to the front of the next word, and the lookarounds that ask
 * for a word edge.
 */

const W = String.raw`\p{L}\p{N}_`;
export const BEFORE = String.raw`(?<![${W}])`;
export const AFTER = String.raw`(?![${W}])`;

/**
 * Letters of scripts written without spaces between words (Chinese, Japanese,
 * Thai, Lao, Khmer, Myanmar, Tibetan). Next to one of them there is no word
 * edge to look for, so a value is matched there as a plain substring.
 */
export const UNSPACED_SRC = String.raw`[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Tibetan}]`;
const UNSPACED = new RegExp(UNSPACED_SRC, 'u');

/** Whether `ch` is a letter of a script written without word spaces. */
export function unspaced(ch: string | undefined): boolean {
  return ch !== undefined && UNSPACED.test(ch);
}

const HANGUL = /^\p{scx=Hangul}$/u;

/**
 * Which sides of `value` need a word edge: none beside a letter of a script
 * without word spaces. Korean puts spaces between words but glues particles
 * and other words onto a name (`김민수는`, `김민수회사`), so a value ending in
 * Hangul needs no edge after it, and one starting in Hangul needs an edge
 * before it only when it has fewer than three Hangul syllables: a short one
 * would be found inside unrelated words.
 */
export function wordEdges(value: string): { before: boolean; after: boolean } {
  const chars = [...value];
  const first = chars[0] ?? '';
  const last = chars[chars.length - 1] ?? '';
  const syllables = chars.filter((c) => HANGUL.test(c)).length;
  return {
    before: !unspaced(first) && !(HANGUL.test(first) && syllables >= 3),
    after: !unspaced(last) && !HANGUL.test(last),
  };
}

/**
 * Whether `value` starts in Hangul and `wordEdges` asks for a word edge before it:
 * a Korean value of two syllables, found only where a word starts, so a copy
 * inside a longer word (`우리팀지원님`) is neither replaced nor reported.
 */
export function hangulAtWordStartOnly(value: string): boolean {
  return HANGUL.test([...value][0] ?? '') && wordEdges(value).before;
}

/**
 * The one-letter words Hebrew and Arabic write glued to the front of the next
 * word, alone or chained: Hebrew ו (and), ה (the), ב (in), ל (to), מ (from), ש (that)
 * and כ (as), up to three of them (`ולל`); Arabic و (and) or ف (so), then ب (in),
 * ل (to) or ك (as), the article ال, or لل (to the): `وال`, `فال`, `ولل`.
 */
const GLUED_PREFIX: Record<'Hebrew' | 'Arabic', string> = {
  Hebrew: '[והבלמשכ]{1,3}',
  Arabic: '(?:[وف]?(?:[بك]?ال|لل|[بلك])|[وف])',
};
/** A word start and a chain of glued prefixes of either script, for a lookbehind. */
export const GLUED_PREFIX_SRC = `${BEFORE}(?:${GLUED_PREFIX.Hebrew}|${GLUED_PREFIX.Arabic})`;
const PREFIX_SCRIPT = { Hebrew: /^\p{scx=Hebrew}$/u, Arabic: /^\p{scx=Arabic}$/u };
const PREFIX_END = {
  Hebrew: new RegExp(`(?<=${BEFORE}${GLUED_PREFIX.Hebrew})`, 'uy'),
  Arabic: new RegExp(`(?<=${BEFORE}${GLUED_PREFIX.Arabic})`, 'uy'),
};

/** The script of `ch` when it is Hebrew or Arabic, whose prefixes `GLUED_PREFIX` lists. */
function prefixScript(ch: string | undefined): 'Hebrew' | 'Arabic' | undefined {
  if (ch === undefined) return undefined;
  return PREFIX_SCRIPT.Hebrew.test(ch) ? 'Hebrew' : PREFIX_SCRIPT.Arabic.test(ch) ? 'Arabic' : undefined;
}

/**
 * Whether a word starts right before `at` in `text` with nothing but a chain of
 * the glued prefixes (`GLUED_PREFIX`) of the script `value` starts in, so a
 * value at `at` is the rest of the word: `דוד` in `לדוד`, `محمد` in `ومحمد`. Without
 * `value`, a chain of either script counts, as where a fake starts.
 */
export function gluedPrefixBefore(text: string, at: number, value?: string): boolean {
  const scripts = value === undefined ? (['Hebrew', 'Arabic'] as const) : [prefixScript([...value][0])].filter((s) => s !== undefined);
  return scripts.some((s) => {
    const re = PREFIX_END[s];
    re.lastIndex = at;
    return re.test(text);
  });
}

/**
 * `atoms` with a word edge required on each side that `wordEdges` asks for. A
 * value in Hebrew or Arabic script may also start after a chain of the glued
 * prefixes at a word start (see `GLUED_PREFIX`), which stays out of the match:
 * where the word starts, the whole word is tried first, so a value that
 * starts with one of those letters (`לאה`) is found whole there.
 */
export function edged(value: string, atoms: string[]): string[] {
  const { before, after } = wordEdges(value);
  const script = prefixScript([...value][0]);
  const start = script ? `(?:${BEFORE}|(?<=${BEFORE}${GLUED_PREFIX[script]}))` : BEFORE;
  return [...(before ? [start] : []), ...atoms, ...(after ? [AFTER] : [])];
}
