/**
 * The paranoid sweep: text blind is about to leave as written that still looks
 * private. It reads each text outside the spans blind replaces and flags
 * capitalised words, long digit runs, handles, encoded payloads and spelled-out
 * addresses. It finds what no detector found, so it is wide on purpose and
 * flags ordinary words too. A reviewer clears those with `allow`.
 */
import { EN_MONTHS, ES_MONTHS } from './dates.js';
import { foldLookalikes, skeleton } from './fold.js';
import { DEFAULT_ALLOW_DOMAINS, FUNCTION_WORDS, PARTICLES } from './names.js';
import type { Span, Suspect, SuspectKind } from './types.js';

const words = (s: string): string[] => s.trim().split(/\s+/);

/**
 * Capitalised words that say nothing about a person, accent-free and in lower
 * case: function words, months, weekdays, mail headers and greetings. Anything
 * else capitalised is flagged, so this list only keeps the noise down.
 */
const COMMON = new Set([
  ...FUNCTION_WORDS.en,
  ...FUNCTION_WORDS.es,
  ...PARTICLES,
  ...EN_MONTHS,
  ...ES_MONTHS,
  // A public platform signs its mail with its name (`From: Booksy`).
  ...DEFAULT_ALLOW_DOMAINS.map((d) => d.split('.')[0] as string),
  ...words(`
    monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun
    lunes martes miercoles jueves viernes sabado domingo
    from to cc bcc subject date re fw fwd sent asunto de para fecha enviado
    mr mrs ms dr sr sra srta don dona
    dear hi hello hola regards best thanks thank cheers estimado estimada gracias saludos un abrazo
    id ref iva vat nif cif nie dni iban bic swift pdf faq url www sms ok usd eur gbp
  `),
]);

const fold = (s: string): string => skeleton(foldLookalikes(s)).text.toLowerCase();

/** A word that starts with a capital: title case, or all capitals of two letters or more. */
const CAP_WORD = String.raw`(?:\p{Lu}[\p{Ll}\p{M}'’]+(?:-\p{Lu}?[\p{Ll}\p{M}'’]+)*|\p{Lu}{2,})`;
const PARTICLE = String.raw`(?:de|del|la|las|los|van|von|da|di|y)`;
/** Capitalised words in a run, with particles between them (`Ana de la Cruz`). */
const NAME_RUN = new RegExp(
  String.raw`(?<![\p{L}\p{N}\p{M}_])${CAP_WORD}(?:[ \t]+(?:${PARTICLE}[ \t]+)*${CAP_WORD})*(?![\p{L}\p{N}\p{M}_])`,
  'gu',
);
/** What may come before a word that starts a sentence or a line, spaces aside, where a capital says nothing. */
const SENTENCE_END = new Set(['\n', '\r', '.', '!', '?', '¡', '¿', '•', '*', '>', '-', '–', '—', '"', '“', '«', '(']);
/** A line up to the first word of its subject, which is capitalised like a sentence: `Subject: Re: Invoice`. */
const SUBJECT_LINE = /^[ \t>]*(?:subject|asunto)[ \t]*:[ \t]*(?:(?:re|fwd?|rv)[ \t]*:[ \t]*)*$/i;
/** The longest line start read for a subject line, so each word costs a bounded look back. */
const SUBJECT_MAX = 80;
/** Stands for a character blind replaces, so no pattern runs into a span or across one. */
const HELD = '\u0000';

/**
 * Five digits or more, in groups split by one space, dot, dash or slash: `123 45 6789`, `ES91 210 0041`.
 * Every group after the first needs its separator, so a long run of digits splits only one way and the match stays linear.
 */
const DIGIT_RUN = /(?<![\p{L}\p{N}])[\p{L}]{0,4}\d+(?:[ .\-/]\d+)*(?![\p{N}])/gu;
/** A handle or hashtag, or the tail of an address the detector did not take whole. */
const HANDLE = /[@#][\p{L}\p{N}_][\p{L}\p{N}_.\-]*/gu;
/** A MIME encoded word, a quoted-printable escape or soft break, or a long run of base64. */
const ENCODED = /=\?[^?\s]+\?[QqBb]\?[^?\s]*\?=|=(?:[0-9A-F]{2}|\r?\n)|(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{16,}={0,2}(?![A-Za-z0-9+/=])/g;
/**
 * An address spelled out: `ana at gestoria dot example`, `ana [at] gestoria [dot] example`.
 * From the `at` on, so a local part blind replaced as a name does not hide the rest.
 * The look back before `at` is bounded, or every position of a long run of spaces would read the whole run.
 */
const AT_WORD = String.raw`(?:[\[(]\s*(?:at|arroba)\s*[\])]|\b(?:at|arroba)\b)`;
const DOT_WORD = String.raw`(?:[\[(]\s*(?:dot|punto)\s*[\])]|\b(?:dot|punto)\b)`;
const SPELLED_ADDRESS = new RegExp(String.raw`(?<=[\p{L}\p{N}._\-\u0000][ \t]{0,3})${AT_WORD}\s*[\p{L}\p{N}\-]+(?:\s*${DOT_WORD}\s*[\p{L}\p{N}\-]+)+`, 'giu');

/** A base64 run reads as one when it mixes cases and digits, or pads with `=`: a long plain word does neither. */
const base64Like = (s: string): boolean => /=$/.test(s) || (/[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s));

/**
 * What `blind` would leave as written in each text that still looks private.
 * `spans` are the spans blind replaces in each text, `allow` the values a
 * reviewer cleared. Offsets are in the input text, `end` exclusive.
 */
export function findSuspects(texts: readonly string[], spans: readonly Span[][], allow: readonly string[]): Suspect[] {
  const cleared = new Set(allow.map((a) => fold(a.trim())).filter(Boolean));
  const out: Suspect[] = [];
  texts.forEach((input, textIndex) => {
    // The patterns read the text with every span blind replaces masked out, so a
    // run of capitals beside a replaced name (`Cedric Maddox y Paloma`) is still read.
    const held = new Uint8Array(input.length);
    for (const s of spans[textIndex] ?? []) held.fill(1, Math.max(0, s.start), Math.min(input.length, s.end));
    // The text as the patterns before this one left it, built once per pattern, so the sweep stays linear.
    const masked = (): string => {
      let t = '';
      let from = 0;
      for (let i = 0; i <= input.length; i++) {
        if (i < input.length && !held[i]) continue;
        t += input.slice(from, i);
        if (i < input.length) t += HELD;
        from = i + 1;
      }
      return t;
    };
    const found: Suspect[] = [];
    const add = (kind: SuspectKind, start: number, end: number): void => {
      if (end <= start || held.subarray(start, end).includes(1)) return;
      if (!cleared.has(fold(input.slice(start, end)))) found.push({ kind, textIndex, start, end });
      // Taken, reported or cleared, so a later pattern does not read part of it again (`Lucía` of a cleared `@Lucía`).
      held.fill(1, start, end);
    };

    // The narrow patterns first, so a spelled-out address is one suspect, not a name and a handle.
    for (const m of masked().matchAll(SPELLED_ADDRESS)) add('address', m.index, m.index + m[0].length);
    for (const m of masked().matchAll(ENCODED)) {
      if (m[0].startsWith('=') || base64Like(m[0])) add('encoded', m.index, m.index + m[0].length);
    }
    for (const m of masked().matchAll(HANDLE)) add('handle', m.index, m.index + m[0].replace(/[.\-]+$/, '').length);
    for (const m of masked().matchAll(DIGIT_RUN)) {
      if (m[0].replace(/\D/g, '').length >= 5) add('number', m.index, m.index + m[0].length);
    }
    const text = masked();
    for (const m of text.matchAll(NAME_RUN)) nameSuspects(text, m[0], m.index, add);
    // One at a time: spreading a long list into `push` passes it as arguments, past the engine's limit.
    for (const f of found.sort((a, b) => a.start - b.start)) out.push(f);
  });
  return out;
}

/**
 * A run of capitalised words is flagged whole when two or more of its words are
 * not common ones. A single uncommon word is flagged unless it starts a
 * sentence or a line, where a capital says nothing about it.
 */
function nameSuspects(text: string, run: string, at: number, add: (kind: SuspectKind, start: number, end: number) => void): void {
  const parts = [...run.matchAll(/\S+/g)].map((m) => ({ word: m[0], start: at + m.index, end: at + m.index + m[0].length }));
  const capped = parts.filter((p) => /^\p{Lu}/u.test(p.word));
  const uncommon = capped.filter((p) => !COMMON.has(fold(p.word)));
  if (uncommon.length === 0) return;
  if (uncommon.length >= 2) {
    // From the first uncommon word to the last, so a greeting before a name stays out.
    add('name', (uncommon[0] as (typeof parts)[number]).start, (uncommon.at(-1) as (typeof parts)[number]).end);
    return;
  }
  const only = uncommon[0] as (typeof parts)[number];
  if (only.word.length < 2) return;
  if (startsSentence(text, only.start)) return;
  add('name', only.start, only.end);
}

/**
 * Whether the word at `at` starts the text, a line, a sentence or a subject line.
 * It reads back over the spaces before the word only, which belong to no other
 * word, so all the calls of a sweep read the text about once.
 */
function startsSentence(text: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && (text[i] === ' ' || text[i] === '\t')) i--;
  if (i < 0 || SENTENCE_END.has(text[i] as string)) return true;
  const from = Math.max(0, at - SUBJECT_MAX);
  const before = text.slice(from, at);
  const nl = before.lastIndexOf('\n');
  // A line that starts further back than the window is not a subject line.
  if (nl < 0 && from > 0) return false;
  return SUBJECT_LINE.test(before.slice(nl + 1));
}
