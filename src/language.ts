/**
 * Which language a fake is written in. A value's own words decide first: a
 * name, company word or surname from the lists, an accent, a company suffix,
 * a country domain, then spelling. A value that says nothing (Mena, Quintana,
 * Daniel) follows its paragraph, then the paragraphs next to it, then the
 * whole text, then the whole call, and English when nothing says anything.
 */
import { AT_SRC, FAKES, FUNCTION_WORDS, GIVEN, ORG_WORDS, ROLE_WORDS, SURNAMES, type Lang } from './names.js';

export type { Lang } from './names.js';

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const lexicon = (lang: Lang): Set<string> => {
  const f = FAKES[lang];
  const all = [...GIVEN[lang].female, ...GIVEN[lang].male, ...SURNAMES[lang], ...ORG_WORDS[lang], ...f.female, ...f.male, ...f.last, ...f.orgBases, ...f.orgNouns, ...f.places.flatMap((p) => p.split(' ')), ...f.domainNouns, ...f.domainNames];
  return new Set(all.map(fold));
};
const LEXICON: Record<Lang, Set<string>> = { en: lexicon('en'), es: lexicon('es') };
const FUNCTION: Record<Lang, Set<string>> = { en: new Set(FUNCTION_WORDS.en), es: new Set(FUNCTION_WORDS.es) };

/** Letters and endings English writes and Spanish rarely does. */
const EN_SPELLING = [/w/, /k/, /th/, /sh/, /ck/, /tch/, /oo/, /ee/, /gh/, /ph/, /(ss|tt|ff|pp|dd|bb|gg|nn)/, /[^aeiouy]y$/, /(ing|ton|son|ley|field|ford|wood|worth|ham|croft|ery|er)$/];
/** Letters and endings Spanish writes and English rarely does. */
const ES_SPELLING = [/z/, /rr/, /^ll/, /o$/, /(cion|dad|ero|era|illo|illa|ito|ita|ado|ada|eria|os)$/];

/** The language that has more votes, or none on a tie. */
export function winner(en: number, es: number): Lang | undefined {
  if (en === es) return undefined;
  return en > es ? 'en' : 'es';
}

/** Accents Spanish writes and English names do not. */
const ES_ACCENT = /[ñáíóúÑÁÍÓÚ]/;

/** A word's language from its letters alone: an accent, then letter groups and endings. */
export function spellingLanguage(word: string): Lang | undefined {
  if (ES_ACCENT.test(word)) return 'es';
  const w = fold(word);
  return winner(EN_SPELLING.filter((re) => re.test(w)).length, ES_SPELLING.filter((re) => re.test(w)).length);
}

/**
 * A word's language: the lists first, then an accent, so "Martín" is Spanish
 * where "Martin" is in both lists and says nothing, then its spelling.
 */
export function wordLanguage(word: string): Lang | undefined {
  const w = fold(word);
  const en = LEXICON.en.has(w);
  const es = LEXICON.es.has(w);
  if (en !== es) return en ? 'en' : 'es';
  if (ES_ACCENT.test(word)) return 'es';
  return en ? undefined : spellingLanguage(word);
}

/** The language a word has in the lists, without looking at its spelling. */
function listLanguage(word: string): Lang | undefined {
  const w = fold(word);
  return winner(LEXICON.en.has(w) ? 1 : 0, LEXICON.es.has(w) ? 1 : 0);
}

/** The language most of `words` have, each word one vote by `of`, `extra` votes on top. */
function vote(words: readonly string[], extra: { en: number; es: number } = { en: 0, es: 0 }, of: (w: string) => Lang | undefined = wordLanguage): Lang | undefined {
  let { en, es } = extra;
  for (const w of words) {
    const l = of(w);
    if (l === 'en') en++;
    else if (l === 'es') es++;
  }
  return winner(en, es);
}

const WORD = /\p{L}[\p{L}\p{M}'’]*/gu;
const lettersOf = (s: string): string[] => [...s.matchAll(WORD)].map((m) => m[0]);

/** Each word's own language, and for a word that says nothing, the language of the rest of the name. */
export function nameLanguages(words: readonly string[]): Array<Lang | undefined> {
  const own = words.map(wordLanguage);
  const rest = winner(own.filter((l) => l === 'en').length, own.filter((l) => l === 'es').length);
  return own.map((l) => l ?? rest);
}

const EN_SUFFIX = /\b(Inc|LLC|Ltd|Limited|Corp|PLC|LLP)\b\.?\s*$/i;
const ES_SUFFIX = /\bS\.?\s?(L|A|L\.?U|L\.?P|C)\.?\s*$/i;

/** A company's language: its legal suffix counts twice, then each word. */
export function orgLanguage(name: string): Lang | undefined {
  const extra = { en: EN_SUFFIX.test(name) ? 2 : 0, es: ES_SUFFIX.test(name) ? 2 : 0 };
  return vote(lettersOf(name.replace(EN_SUFFIX, '').replace(ES_SUFFIX, '')), extra);
}

/** A place's language, from its words. */
export function placeLanguage(name: string): Lang | undefined {
  return vote(lettersOf(name));
}

const EN_TLD = new Set(['uk', 'us', 'ie', 'au', 'nz', 'ca']);
const ES_TLD = new Set(['es', 'mx', 'ar', 'cl', 'pe', 'uy', 've', 'ec', 'bo', 'py', 'cat', 'gal', 'eus']);

/** A host's language: a country domain counts twice, then the words of its labels. */
export function hostLanguage(host: string): Lang | undefined {
  const labels = host.toLowerCase().split('.');
  const tld = labels[labels.length - 1] ?? '';
  const extra = { en: EN_TLD.has(tld) ? 2 : 0, es: ES_TLD.has(tld) ? 2 : 0 };
  const words = labels.slice(0, -1).flatMap((l) => l.split(/[^a-z]+/)).filter((w) => w.length > 2);
  return vote(words, extra);
}

/**
 * An address's language: its host, unless `publicHost` (a mail provider says
 * nothing about its user), and the names the lists know in its local part.
 * Spelling says nothing there, since a local part glues initials to names
 * ("bbustamante"), and neither do role words such as info or news.
 */
const AT_RE = new RegExp(AT_SRC, 'i');
const LEADING_AT = new RegExp(`^${AT_SRC}`, 'i');

export function addressLanguage(address: string, publicHost = false): Lang | undefined {
  const at = address.search(AT_RE);
  if (at < 0) return hostLanguage(address);
  const local = address.slice(0, at).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !ROLE_WORDS.has(w));
  const host = address.slice(at).replace(LEADING_AT, '');
  const h = publicHost ? undefined : hostLanguage(host);
  return vote(local, { en: h === 'en' ? 2 : 0, es: h === 'es' ? 2 : 0 }, listLanguage);
}

/** Header keys at the start of a line ("To:", "Para:") are not prose. */
const HEADER_KEY = /^[ \t]*[\p{L}-]{1,12}:/gmu;
/** A paragraph whose every line starts with a header key. */
const HEADER_BLOCK = /^(?:[ \t]*[\p{L}-]{1,12}:[^\n]*(?:\n|$))+$/u;

/** Votes of one paragraph: English and Spanish function words, and where the paragraph ends. */
interface Paragraph {
  end: number;
  en: number;
  es: number;
}

/**
 * The language of the text around each value of a call, from its function
 * words. Detected values are blanked first, so a name never votes. The
 * paragraph of a value decides when one language leads by two words or more.
 * If not, the paragraphs next to it join, one on each side at a time, so an
 * English reply above a quoted Spanish email does not decide for the email.
 */
export class TextLanguage {
  /** Per text: where each paragraph ends, running vote totals, and the answer per paragraph once known. */
  private texts: Array<{ ends: number[]; en: number[]; es: number[]; known: Array<Lang | undefined> }>;
  /** The language of the whole call, or English when no text says. */
  readonly call: Lang;

  constructor(texts: readonly string[], values: ReadonlyArray<ReadonlyArray<{ start: number; end: number }>> = []) {
    const paragraphs = texts.map((t, ti) => {
      // Blanked with a character that is neither a letter nor a space, so paragraphs keep their bounds.
      const blank = blanked(t.replace(HEADER_KEY, (m) => '\0'.repeat(m.length)), values[ti] ?? []);
      const out: Paragraph[] = [];
      let header = false;
      for (const m of blank.matchAll(PARAGRAPH)) {
        const p = { end: m.index + m[0].length, en: 0, es: 0 };
        for (const w of m[0].match(WORD) ?? []) {
          const f = fold(w);
          if (FUNCTION.en.has(f)) p.en++;
          else if (FUNCTION.es.has(f)) p.es++;
        }
        // A header block reads as the message below it, so the paragraph after it joins it.
        const last = out[out.length - 1];
        if (header && last) {
          last.end = p.end;
          last.en += p.en;
          last.es += p.es;
        } else out.push(p);
        header = HEADER_BLOCK.test(t.slice(m.index, m.index + m[0].length).trim());
      }
      return out;
    });
    this.texts = paragraphs.map((ps) => {
      const en = [0];
      const es = [0];
      for (const p of ps) {
        en.push((en[en.length - 1] as number) + p.en);
        es.push((es[es.length - 1] as number) + p.es);
      }
      return { ends: ps.map((p) => p.end), en, es, known: [] };
    });
    const all = paragraphs.flat();
    this.call = winner(sum(all, 'en'), sum(all, 'es')) ?? 'en';
  }

  /** The language around `start` in text `ti`: its paragraph and those next to it, else the whole text, else the call. */
  at(ti: number, start: number): Lang {
    const t = this.texts[ti];
    if (!t) return this.call;
    const n = t.ends.length;
    // The first paragraph that ends after `start`, else the last one.
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((t.ends[mid] as number) > start) hi = mid;
      else lo = mid + 1;
    }
    const at = lo === n ? n - 1 : lo;
    const known = t.known[at];
    if (known) return known;
    const votes = (from: number, to: number): { en: number; es: number } => ({ en: (t.en[to] as number) - (t.en[from] as number), es: (t.es[to] as number) - (t.es[from] as number) });
    let found: Lang | undefined;
    for (let reach = 0; reach < n; reach++) {
      const from = Math.max(0, at - reach);
      const to = Math.min(n, at + reach + 1);
      const { en, es } = votes(from, to);
      if (Math.abs(en - es) >= 2) {
        found = en > es ? 'en' : 'es';
        break;
      }
      // Wider reaches cover the same paragraphs.
      if (from === 0 && to === n) break;
    }
    const all = votes(0, n);
    const lang = found ?? winner(all.en, all.es) ?? this.call;
    if (at >= 0) t.known[at] = lang;
    return lang;
  }
}

/**
 * `text` with every code unit inside a span set to `\0`, built in one pass
 * over the spans sorted by start, so overlapping spans blank their union once.
 * Spans lie inside the text and keep its length.
 */
function blanked(text: string, spans: ReadonlyArray<{ start: number; end: number }>): string {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let at = 0;
  for (const { start, end } of sorted) {
    if (end <= at) continue;
    const from = Math.max(at, start);
    parts.push(text.slice(at, from), '\0'.repeat(end - from));
    at = end;
  }
  parts.push(text.slice(at));
  return parts.join('');
}

/** A paragraph and the blank lines after it. */
const PARAGRAPH = /[\s\S]*?(?:\n[ \t]*\n\s*|$)/g;

const sum = (ps: readonly Paragraph[], lang: Lang): number => ps.reduce((n, p) => n + p[lang], 0);
