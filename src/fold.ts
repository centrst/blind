/**
 * Length-preserving folds. Detection runs on the folded text and the output is
 * assembled from the original, so every offset stays valid. Folding turns
 * full-width forms and common Cyrillic or Greek look-alikes into the Latin
 * letter they imitate, so a pattern written in plain ASCII still finds them.
 */

const LOOKALIKES: Record<string, string> = {
  // Cyrillic
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041a': 'K', '\u041c': 'M', '\u041d': 'H', '\u041e': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T', '\u0425': 'X',
  '\u0430': 'a', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p', '\u0441': 'c', '\u0445': 'x', '\u0443': 'y', '\u0456': 'i', '\u0406': 'I', '\u0458': 'j', '\u0455': 's',
  // Greek
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H', '\u0399': 'I', '\u039a': 'K', '\u039c': 'M', '\u039d': 'N', '\u039f': 'O', '\u03a1': 'P',
  '\u03a4': 'T', '\u03a5': 'Y', '\u03a7': 'X', '\u03bf': 'o', '\u03bd': 'v',
};

/** Zero-width and bidi format characters that carry no text. */
export const INVISIBLE = /[\u200b-\u200f\u2060\ufeff\u202a-\u202e]/g;

const NU = '\u03bd';
const NON_ASCII = /[^\0-\x7f]/;
const GREEK_LETTER = /^(?=\p{L})\p{scx=Greek}$/u;

/**
 * Whether `ch` is a Greek letter with no Latin look-alike: next to one, a
 * lower-case nu is Greek writing, not a `v` in disguise, and stays as it is,
 * so it matches its own capital the way `skeleton` compares them.
 */
const plainGreek = (ch: string | undefined): boolean => ch !== undefined && GREEK_LETTER.test(ch) && LOOKALIKES[ch] === undefined;

/**
 * Same length as the input, always. A lower-case Greek nu is folded to `v`
 * only when no Greek letter without a look-alike stands right beside it, so
 * `\u03bdisa` reads as `visa` and the nu of a Greek word is kept.
 */
export function foldLookalikes(text: string): string {
  // No ASCII character is folded.
  if (!NON_ASCII.test(text)) return text;
  const chars = [...text];
  let out = '';
  chars.forEach((ch, i) => {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xff01 && cp <= 0xff5e) out += String.fromCharCode(cp - 0xfee0);
    else if (ch === NU && (plainGreek(chars[i - 1]) || plainGreek(chars[i + 1]))) out += ch;
    else out += LOOKALIKES[ch] ?? ch;
  });
  return out;
}

/**
 * Lower-case Cyrillic and Greek letters, mapped the way `skeleton`
 * compares them: each to the lower case of what its capital folds to, so a
 * Cyrillic or Greek word and the same word in capitals have one skeleton
 * (`\u043d` of `\u0418\u0432\u0430\u043d` is compared as the `h` its capital
 * `\u041d` folds to). A capital's fold wins where the two disagree (nu), and a
 * final sigma is compared as sigma.
 */
const LOWER_KEY: Record<string, string> = (() => {
  const key: Record<string, string> = { '\u03c2': '\u03c3' };
  const entries = Object.entries(LOOKALIKES);
  for (const [from, to] of entries) if (from !== from.toLowerCase()) key[from.toLowerCase()] = to.toLowerCase();
  for (const [from, to] of entries) key[from.toLowerCase()] ??= to.toLowerCase();
  return key;
})();

const INVISIBLE_CH = new RegExp(`^${INVISIBLE.source}$`);

export const stripInvisible = (s: string): string => s.replace(INVISIBLE, '');

/**
 * For `text = stripInvisible(foldLookalikes(orig))`, the offset in `orig` of
 * each unit of `text`. Folding keeps the length, so only the invisibles move.
 */
export function visibleOffsets(orig: string): number[] {
  const from: number[] = [];
  for (let i = 0; i < orig.length; i++) if (!INVISIBLE_CH.test(orig[i] as string)) from.push(i);
  return from;
}

export interface Skeleton {
  text: string;
  /** For each unit of `text`, the offset of the unit it came from. */
  from: number[];
}

const MARK = /^\p{M}$/u;

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const isSyllable = (cp: number): boolean => cp >= SYLLABLE_FIRST && cp <= SYLLABLE_LAST;
const isLead = (cp: number): boolean => cp >= 0x1100 && cp <= 0x1112;
const isVowel = (cp: number): boolean => cp >= 0x1161 && cp <= 0x1175;
const isTail = (cp: number): boolean => cp >= 0x11a8 && cp <= 0x11c2;

/**
 * Lower-cased text with accents, combining marks and invisible characters
 * taken out, plus a map back to the original offsets. A Cyrillic or Greek
 * letter is lower-cased to the key in `LOWER_KEY`, so a word and its capitals
 * agree after `foldLookalikes`. Known values are matched
 * against this, so "Gestoria", "GESTORÍA" and "Gesto\u200bría" are one name.
 * A Hangul syllable is kept whole, and one written as separate jamo is put
 * back together, so Korean is compared syllable by syllable. Input should
 * already be folded with `foldLookalikes`.
 */
export function skeleton(text: string): Skeleton {
  let out = '';
  const from: number[] = [];
  let i = 0;
  // The Hangul syllable being put together from jamo: its code point and where it started.
  let open: { cp: number; at: number } | null = null;
  const close = (): void => {
    if (!open) return;
    out += String.fromCharCode(open.cp);
    from.push(open.at);
    open = null;
  };
  for (const ch of text) {
    const at = i;
    i += ch.length;
    const cp = ch.codePointAt(0) as number;
    // ASCII is never invisible, a mark, Hangul or in `LOWER_KEY`: it only closes a syllable and is lower-cased.
    if (cp < 0x80) {
      close();
      out += cp >= 0x41 && cp <= 0x5a ? String.fromCharCode(cp + 32) : ch;
      from.push(at);
      continue;
    }
    if (INVISIBLE_CH.test(ch)) continue;
    if (open && isVowel(cp) && open.cp < SYLLABLE_FIRST) {
      open.cp = SYLLABLE_FIRST + ((open.cp - 0x1100) * 21 + (cp - 0x1161)) * 28;
      continue;
    }
    if (open && isTail(cp) && isSyllable(open.cp) && (open.cp - SYLLABLE_FIRST) % 28 === 0) {
      open.cp += cp - 0x11a7;
      close();
      continue;
    }
    // A lead jamo with no vowel after it stays as it is.
    close();
    if (isLead(cp) || (isSyllable(cp) && (cp - SYLLABLE_FIRST) % 28 === 0)) {
      open = { cp, at };
      continue;
    }
    if (isSyllable(cp)) {
      out += ch;
      from.push(at);
      continue;
    }
    const lower = (ch.normalize('NFD')[0] as string).toLowerCase();
    if (MARK.test(lower)) continue;
    const base = LOWER_KEY[lower] ?? lower;
    for (const unit of base) {
      out += unit;
      for (let k = 0; k < unit.length; k++) from.push(at);
    }
  }
  close();
  return { text: out, from };
}
