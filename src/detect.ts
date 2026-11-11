import { detectAmounts, MAX_AMOUNT_DIGITS } from './amounts.js';
import { detectDates } from './dates.js';
import { foldLookalikes, skeleton } from './fold.js';
import { detectIds } from './ids.js';
import { alternativesMatcher, esc, flexAtoms, literalAtoms, matchAlternatives, spacedAtoms } from './match.js';
import { AFTER, BEFORE, edged, hangulAtWordStartOnly, unspaced } from './script.js';
import { literalPresence } from './literal-index.js';
import { TextLanguage } from './language.js';
import { AT_SRC, COMMON_LABELS, COUNTRY_CODES, FUNCTION_WORDS, IBAN_LENGTHS, ORG_SUFFIX, PARTICLES, ROLE_WORDS, type Lang } from './names.js';
import type { DetectContext, Detector, KnownKind, KnownValue, Span, UnenforcedKnown } from './types.js';
import { BlindError, isBlindErrorKind, type BlindErrorKind } from './errors.js';

export const PRIORITY = {
  url: 100,
  email: 95,
  iban: 90,
  typedId: 88,
  phone: 85,
  amount: 80,
  date: 78,
  known: 70,
  displayName: 65,
  honorific: 63,
  cue: 62,
  labelledId: 61,
  id: 60,
  mention: 40,
} as const;


const EMAIL_SRC = String.raw`[A-Za-z0-9._%+\-]+${AT_SRC}(?:[A-Za-z0-9\-]+\.)+[A-Za-z]{2,}`;
const EMAIL_RE = new RegExp(String.raw`(?<![A-Za-z0-9._%+\-])${EMAIL_SRC}`, 'g');
const THROUGH_AT = new RegExp(String.raw`^.*?${AT_SRC}`, 'i');

/** The host after an email's literal or escaped at sign. */
export const emailHost = (value: string): string => value.replace(THROUGH_AT, '');
export const urlHost = (value: string): string | undefined => /^(?:https?:\/\/)?([^/?#:]+)/i.exec(value)?.[1];

const NAME_WORD = String.raw`\p{Lu}[\p{L}'’.\-]*`;
const NAME_PART = String.raw`(?:(?:de|del|la|las|los|van|von|da|di|y)[ \t]+)*${NAME_WORD}`;
// `(?<=[:;,\s])` and not `(?<=[:;,]\s*)`: the same places, without rereading a long
// run of whitespace at every position of it.
const DISPLAY_RE = new RegExp(
  String.raw`(?<=^|[:;,\s])(?<name>${NAME_WORD}(?:[ \t]+${NAME_PART}){0,4})[ \t]*<[ \t]*(?<email>${EMAIL_SRC})[ \t]*>`,
  'gmud',
);
const QUOTED_DISPLAY_RE = new RegExp(
  String.raw`"(?<name>[^"\n<>@]{2,60})"[ \t]*<[ \t]*(?<email>${EMAIL_SRC})[ \t]*>`,
  'gud',
);

const NOT_NAME = new Set([
  'hola', 'hello', 'hi', 'hey', 'dear', 'estimado', 'estimada', 'gracias', 'thanks', 'thank', 'from', 'to',
  'cc', 'bcc', 'de', 'para', 're', 'fwd', 'saludos', 'regards', 'cordially', 'atte',
]);

/** Words that make a sender name a company or team rather than a person. */
const ORG_WORD = new RegExp(
  String.raw`(?<![\p{L}])(?:` +
    [
      String.raw`S\.?L\.?U?\.?|S\.?A\.?|S\.?L\.?P\.?|Inc\.?|LLC|Ltd\.?|GmbH|Corp\.?|B\.?V\.?|PLC|AG`,
      'Asesor[ií]a|Asesores|Gestor[ií]a|Consultor[ií]a|Consultores|Consulting|Advisory|Abogados|Bufete|Notar[ií]a',
      'Cl[ií]nica|Clinic|Hospital|Farmacia|Pharmacy|Dental|Veterinaria',
      'Labs?|Partners|Holdings?|Group|Grupo|Studio|Estudio|Solutions|Soluciones|Services|Servicios|Works',
      'Log[ií]stica|Logistics|Supply|Ingenier[ií]a|Engineering|Reformas|Construcciones|Inmobiliaria|Seguros|Insurance',
      'Gesti[oó]n|Management|Agencia|Agency|Academia|Academy|Escuela|School|Hotel|Restaurante|Restaurant|Tienda|Shop|Store',
      'Banco|Bank|Ayuntamiento|Equipo|Team|Soporte|Support|Atenci[oó]n|Newsletter|Noticias|News|Notifications?|Billing|Facturaci[oó]n',
    ].join('|') +
    String.raw`)(?![\p{L}])`,
  'u',
);

export const emailDetector: Detector = {
  name: 'email',
  detect(text, ctx) {
    const out: Span[] = [];
    for (const m of text.matchAll(EMAIL_RE)) {
      out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'email', priority: PRIORITY.email });
    }
    for (const re of [DISPLAY_RE, QUOTED_DISPLAY_RE]) {
      for (const m of text.matchAll(re)) {
        const email = m.groups!.email as string;
        const host = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
        if (ctx.isAllowedHost(host)) continue;
        const name = m.groups!.name as string;
        if (/\d/.test(name)) continue;
        const [ns, e] = m.indices!.groups!.name as [number, number];
        let s = ns;
        // "Hola Ana Ruiz <...>" at the start of a line: the greeting is not part of the name.
        let rel = 0;
        for (const w of name.match(/\S+/g) ?? []) {
          if (!NOT_NAME.has(w.toLowerCase().replace(/[.,:]$/, ''))) break;
          rel = name.indexOf(w, rel) + w.length;
          while (/\s/.test(name[rel] ?? '')) rel++;
          s = ns + rel;
        }
        if (e - s < 2) continue;
        // "Clínica Foxglove <info@...>" is a sender name, but not a person.
        const kind = ORG_WORD.test(text.slice(s, e)) ? 'org' : 'person';
        out.push({ start: s, end: e, kind, priority: PRIORITY.displayName });
      }
    }
    return out;
  },
};

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"'\])}]+/gi;
const URL_TRAILING = /[.,;:!?)\]]+$/;
const BARE_HOST_RE = /(?<![\p{L}\p{N}\p{M}_.@%+\-])([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)(?![\p{L}\p{N}\p{M}_-]|\.[\p{L}\p{N}_-])(?::\d+)?(?:[/?#][^\s<>"'\])}]*)?/gu;

export const urlDetector: Detector = {
  name: 'url',
  detect(text) {
    const out: Span[] = [];
    for (const m of text.matchAll(URL_RE)) {
      const trimmed = m[0].replace(URL_TRAILING, '');
      if (trimmed.length < 8) continue;
      out.push({ start: m.index!, end: m.index! + trimmed.length, kind: 'url', priority: PRIORITY.url });
    }
    return out;
  },
};

/** The hosts of the emails, URLs and domains found anywhere in the call that are not public. */
function hostsOf(texts: string[], found: Span[][], ctx: DetectContext): Set<string> {
  const hosts = new Set<string>();
  found.forEach((spans, ti) => {
    for (const s of spans) {
      if (s.kind !== 'email' && s.kind !== 'url' && s.kind !== 'domain') continue;
      const value = texts[ti]!.slice(s.start, s.end);
      const host = s.kind === 'email' ? emailHost(value) : s.kind === 'url' ? urlHost(value) : value;
      if (host && !ctx.isAllowedHost(host)) hosts.add(host.toLowerCase());
    }
  });
  return hosts;
}

/** Bare URLs under hosts already identified as private anywhere in the call. */
function privateHosts(texts: string[], found: Span[][], ctx: DetectContext): Span[][] {
  const hosts = hostsOf(texts, found, ctx);
  if (hosts.size === 0) return found;
  return found.map((spans, ti) => {
    const text = texts[ti]!;
    const held = coverage(spans.filter((s) => s.kind === 'email' || s.kind === 'url'), text.length);
    const more: Span[] = [];
    for (const m of text.matchAll(BARE_HOST_RE)) {
      const host = m[1]!.toLowerCase();
      const end = m.index + m[0].replace(URL_TRAILING, '').length;
      // A host inside an address belongs to that address. An address inside this
      // URL's path or query belongs to the URL, just as with an explicit scheme.
      if (held[m.index] || ctx.isAllowedHost(host)) continue;
      // Compare complete labels, so neither a longer label nor a longer suffix matches.
      for (let suffix = host; suffix.includes('.'); suffix = suffix.slice(suffix.indexOf('.') + 1)) {
        if (!hosts.has(suffix)) continue;
        more.push({ start: m.index, end, kind: 'url', priority: PRIORITY.url });
        break;
      }
    }
    return resolveSpans([...spans, ...more]);
  });
}

const IBAN_RE = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/gu;

export const ibanDetector: Detector = {
  name: 'iban',
  detect(text) {
    const out: Span[] = [];
    for (const m of text.matchAll(IBAN_RE)) {
      const want = IBAN_LENGTHS[m[0].slice(0, 2)];
      if (!want) continue;
      let count = 0;
      let end = -1;
      for (let i = 0; i < m[0].length; i++) {
        if (m[0][i] !== ' ') count++;
        if (count === want) {
          end = i + 1;
          break;
        }
      }
      if (end < 0) continue;
      const next = m[0][end];
      if (next !== undefined && next !== ' ') continue;
      out.push({ start: m.index!, end: m.index! + end, kind: 'iban', priority: PRIORITY.iban });
    }
    return out;
  },
};

const PHONE_RES: RegExp[] = [
  /(?<![\p{L}\p{N}])(?:\+|00)\d{1,3}(?:[ .\-]?\(?\d{1,4}\)?){2,6}(?!\d)/gu,
  /(?<![\p{L}\p{N}+])(?<![\d][.,])[6-9]\d{2}[ .\-]?\d{3}[ .\-]?\d{3}(?!\d)/gu,
  /(?<![\p{L}\p{N}+])(?<![\d][.,])[6-9]\d{2}[ .\-]?\d{2}[ .\-]?\d{2}[ .\-]?\d{2}(?!\d)/gu,
  /(?<![\p{L}\p{N}])(?:\+1[ .\-]?)?(?:\(\d{3}\)[ \t]?|\d{3}[ .\-])\d{3}[ .\-]\d{4}(?!\d)/gu,
  // A UK mobile written nationally: 07700 900123, 07700 900 123, 07700900123.
  /(?<![\p{L}\p{N}+])(?<![\d][.,])07\d{3}[ .\-]?\d{3}[ .\-]?\d{3}(?!\d)/gu,
];

export const phoneDetector: Detector = {
  name: 'phone',
  detect(text) {
    const out: Span[] = [];
    for (const re of PHONE_RES) {
      for (const m of text.matchAll(re)) {
        const digits = m[0].replace(/\D/g, '').length;
        if (digits < 8 || digits > 15) continue;
        out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'phone', priority: PRIORITY.phone });
      }
    }
    if (out.length === 0) return out;
    // Digits an amount holds are that amount: `650.000.000 €` and `850 000 000 EUR` are not phone numbers.
    const amounts = coverage(detectAmounts(text), text.length);
    return out.filter((s) => !covered(amounts, s.start, s.end));
  },
};

const ID_DIGITS_RE = /(?<![\p{L}\p{N}_])\d{6,}(?![\p{L}\p{N}_])/gu;
const ID_ALNUM_RE = /(?<![\p{L}\p{N}_])[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*(?![\p{L}\p{N}_])/gu;

/** A git object name: lower-case hex of an abbreviated or full SHA-1 or SHA-256, with a letter that has digits on both sides. */
const GIT_SHA_RE = /^(?=[0-9a-f]*[0-9][a-f]+[0-9])(?:[0-9a-f]{7,40}|[0-9a-f]{64})$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** A hex colour after its `#`, with a hex letter, so `#123456` stays an order number. */
const HEX_COLOUR_RE = /^(?=[0-9]*[a-f])(?:[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const SKU_BEFORE_RE = /(?<![\p{L}\p{N}])SKU[ 	]*[:#]?[ 	]*$/iu;
const SKU_PREFIX_RE = /^SKU[-/]/iu;
const WORD_SEG = /^[a-z]+$/u;
/** A version piece (`4o`, `70b`, `v3`, `rc1`, `x86`) or a word with a short number (`parser1234`, `v2024`). */
const SMALL_SEG = /^(?:[a-z]*\d{1,3}[a-z]*|[a-z]+\d{1,4})$/u;
const validDay = (y: string, mo: string, d: string): boolean => {
  const month = Number(mo), day = Number(d);
  return Number(y) >= 1900 && Number(y) <= 2199 && month >= 1 && month <= 12 && day >= 1 && day <= 31;
};
/** A time after a date in an identifier: `T0315`, `T031500Z`. */
const TIME_TAIL = /^(\d{2})(?:T\d{4}(?:\d{2})?Z?)?$/u;

/**
 * Whether a lower-case name made of pieces joined by `-` or `/` is technical:
 * a word of three letters or more, and every other piece a word, a version
 * piece or part of a date (`gpt-4o-2024-08-06`, `claude-3-5-sonnet-20241022`,
 * `release-2026-01-15`, `src/v2024/parser1234`). A piece of four digits or
 * more that is not a date keeps it an id (`ord-2026-88412`).
 */
function technicalName(token: string): boolean {
  if (/[A-SU-Y]/u.test(token)) return false;
  const segs = token.split(/[-/]/u);
  if (segs.length < 2 || !segs.some((g) => g.length >= 3 && WORD_SEG.test(g))) return false;
  for (let k = 0; k < segs.length; k++) {
    const g = segs[k] as string;
    if (WORD_SEG.test(g) || SMALL_SEG.test(g)) continue;
    const ymd = /^(\d{4})(\d{2})(\d{2})$/u.exec(g);
    if (ymd && validDay(ymd[1]!, ymd[2]!, ymd[3]!)) continue;
    const day = TIME_TAIL.exec(segs[k + 2] ?? '');
    if (/^\d{4}$/u.test(g) && day && validDay(g, segs[k + 1] ?? '', day[1]!)) {
      k += 2;
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Whether the letters and digits at `start` to `end` are technical text rather
 * than a private id: a git SHA, a UUID, a hex colour, a lower-case model,
 * release or file name, or a value marked as a SKU. A label such as `DNI` or
 * `account no.` still makes it an id through the context detector, and typed
 * ids (cards, DNI, NIE, CIF, VAT) are found by their own rules.
 */
function technical(text: string, start: number, end: number): boolean {
  const t = text.slice(start, end);
  const shaped =
    GIT_SHA_RE.test(t) || UUID_RE.test(t) || technicalName(t) || (text[start - 1] === '#' && HEX_COLOUR_RE.test(t)) ||
    SKU_PREFIX_RE.test(t) || SKU_BEFORE_RE.test(text.slice(Math.max(0, start - 8), start));
  // A typed id inside keeps the whole an id: `SKU-12345678Z` holds a DNI, which its own pattern does not read after a hyphen.
  return shaped && detectIds(t.replace(/[-/]/gu, ' ')).length === 0;
}

/** Whether each span, asked in order of start, lies inside one of `ranges`, which are in order and do not overlap. */
function insideOf(ranges: Array<[number, number]>): (s: number, e: number) => boolean {
  let k = 0;
  return (s, e) => {
    while (k < ranges.length && (ranges[k] as [number, number])[1] <= s) k++;
    const r = ranges[k];
    return r !== undefined && r[0] <= s && e <= r[1];
  };
}

export const idDetector: Detector = {
  name: 'id',
  detect(text) {
    const out: Span[] = [];
    // A run of digits inside technical text is part of it: the date of `claude-3-5-sonnet-20241022`.
    const tech: Array<[number, number]> = [];
    for (const m of text.matchAll(ID_ALNUM_RE)) if (/\d/.test(m[0]) && technical(text, m.index, m.index + m[0].length)) tech.push([m.index, m.index + m[0].length]);
    const digitsInTech = insideOf(tech);
    for (const m of text.matchAll(ID_DIGITS_RE)) {
      if (digitsInTech(m.index, m.index + m[0].length)) continue;
      out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'id', priority: PRIORITY.id });
    }
    const alnumInTech = insideOf(tech);
    for (const m of text.matchAll(ID_ALNUM_RE)) {
      const t = m[0];
      if (alnumInTech(m.index, m.index + t.length)) continue;
      const digits = (t.match(/\d/g) ?? []).length;
      const letters = (t.match(/[A-Za-z]/g) ?? []).length;
      if (t.length < 6 || letters < 1 || digits < 4) continue;
      if (/^[A-Za-z]\d-\d{4}$/.test(t)) continue; // Q4-2026
      out.push({ start: m.index!, end: m.index! + t.length, kind: 'id', priority: PRIORITY.id });
    }
    return out;
  },
};

/** Cards, SSNs, DNI, NIE, CIF, EU VAT numbers and IP addresses, each checked against its own rules. */
export const typedIdDetector: Detector = {
  name: 'typed-id',
  detect(text) {
    return detectIds(text).map((m) => ({
      start: m.start, end: m.end, kind: 'id' as const, priority: PRIORITY.typedId, meta: { scheme: m.scheme },
    }));
  },
};

// Context words. A title before a capitalised name marks a person, and a label
// such as "DNI" or "policy number" marks the value after it as an id even when
// its shape alone is too weak to count.
const HONORIFIC = String.raw`(?:Sr|Sra|Srta|Dña|Dra|Dr|Mr|Mrs|Ms|Mx|Prof|Profa|Lic|Ing)\.?|D\.|Dª|Don|Doña|Miss|Mister|Señor|Señora|Señorita|Doctor|Doctora`;
// A name after a title: no "y" between words, and a second title starts a new name.
const TITLED_WORD = String.raw`(?!(?:${HONORIFIC})(?!\p{L}))${NAME_WORD}`;
const TITLED_PART = String.raw`(?:(?:de|del|la|las|los|van|von|da|di)[ \t]+)*${TITLED_WORD}`;
/** Titles a given name follows (`Don Luis`). After any other title one word is a surname (`Mr Holloway`, `Sra. Ruiz`). */
const GIVEN_NAME_TITLE = /^(?:Dña|D\.|Dª|Don|Doña)(?!\p{L})/iu;
const TITLE_BEFORE = new RegExp(String.raw`(?<![\p{L}\p{N}])(?<title>${HONORIFIC})[ \t]+$`, 'u');

/**
 * Whether the word at `start` stands right after a title that takes a surname
 * (`Mr Holloway`, `Sra. Ruiz`), whichever detector found the word: a known
 * value and a name found again bare count too.
 */
export function afterSurnameTitle(text: string, start: number): boolean {
  const title = TITLE_BEFORE.exec(text.slice(Math.max(0, start - 16), start))?.groups?.title;
  return title !== undefined && !GIVEN_NAME_TITLE.test(title);
}
const HONORIFIC_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${HONORIFIC})[ \t]+(?<name>${TITLED_WORD}(?:[ \t]+${TITLED_PART}){0,2})`,
  'gud',
);
const ID_LABEL = [
  String.raw`DNI`, String.raw`NIE`, String.raw`NIF`, String.raw`CIF`, String.raw`NSS`, String.raw`SSN`,
  String.raw`(?:social security|seguridad social)(?:[ \t]+(?:number|n[º°o]\.?|número))?`,
  String.raw`passport(?:[ \t]+(?:no\.?|number|#))?`, String.raw`pasaporte`,
  String.raw`(?:driver'?s?[ \t]+)?licen[cs]e(?:[ \t]+(?:no\.?|number|#))`, String.raw`carn[eé]t?[ \t]+de[ \t]+conducir`,
  String.raw`(?:tax|taxpayer|patient|member|customer|client|employee|policy|account)[ \t]+(?:id|no\.?|number|#)`,
  String.raw`n[º°o]\.?[ \t]+de[ \t]+(?:cliente|socio|póliza|poliza|cuenta|afiliación|afiliacion|expediente|historia)`,
  String.raw`(?:número|numero)[ \t]+de[ \t]+(?:cliente|socio|póliza|poliza|cuenta|afiliación|afiliacion|expediente|historia)`,
  String.raw`póliza|poliza|NHC|historia[ \t]+clínica|expediente`,
].join('|');
const LABELLED_ID_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${ID_LABEL})[ \t]*(?:n[º°o]\.?|#)?[ \t]*[:.#]?[ \t]*(?<value>[A-Za-z0-9](?:[A-Za-z0-9]|[ \-./](?=[A-Za-z0-9])){2,23})`,
  'giud',
);

export const contextDetector: Detector = {
  name: 'context',
  detect(text) {
    const out: Span[] = [];
    for (const m of text.matchAll(HONORIFIC_RE)) {
      const [s, e] = m.indices!.groups!.name as [number, number];
      // "Sr. García:" or "Dr. Mena." ends the name at punctuation the pattern may have taken.
      // So does a full stop after a word of three letters or more: "Dr. Okafor. Holloway agreed" is one name and a new sentence, "Dr. J. Orvane" one name.
      const name = text.slice(s, e).replace(/(?<=\p{L}{3})\.\s.*$/su, '').replace(/[.'’\-]+$/, '');
      if (name.split(/\s+/).every((w) => PARTICLES.has(w.toLowerCase()))) continue;
      out.push({ start: s, end: s + name.length, kind: 'person', priority: PRIORITY.honorific });
    }
    const re = new RegExp(LABELLED_ID_RE.source, LABELLED_ID_RE.flags);
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const [s, e] = m.indices!.groups!.value as [number, number];
      const value = text.slice(s, e);
      // A value has digits: "DNI 12345678" yes, "DNI del titular" no. Words after a short number stay out.
      const tail = /^(\S*\d\S*(?:[ ](?=\S*\d)\S+)*)/.exec(value)?.[1] ?? '';
      if ((tail.match(/\d/g) ?? []).length < 3) {
        // "Historia clínica NHC: 4512": the value may start with the next label.
        re.lastIndex = s;
        continue;
      }
      out.push({ start: s, end: s + tail.length, kind: 'id', priority: PRIORITY.labelledId });
    }
    return out;
  },
};

export const amountDetector: Detector = {
  name: 'amount',
  detect(text) {
    return detectAmounts(text).filter((o) => o.minor < 10 ** MAX_AMOUNT_DIGITS).map((o) => ({
      start: o.start, end: o.end, kind: 'amount' as const, priority: PRIORITY.amount, meta: o,
    }));
  },
};

export const dateDetector: Detector = {
  name: 'date',
  detect(text, ctx) {
    return detectDates(text, ctx.dateOrder).map((d) => ({
      start: d.start, end: d.end, kind: 'date' as const, priority: PRIORITY.date, meta: d.occ,
    }));
  },
};

// ------------------------------------------------------------------ mail cues
// Where ordinary mail puts a name: after a greeting, on the line after a
// closing, after a label such as "Patient:", and before a legal suffix.

/** `phrase` matched in either case, letter by letter: these patterns cannot take the `i` flag, under which `\p{Lu}` matches lower case too. */
const anyCase = (phrase: string): string =>
  phrase
    .split(' ')
    .map((w) => [...w].map((c) => (c.toLowerCase() === c.toUpperCase() ? esc(c) : `[${c.toUpperCase()}${c.toLowerCase()}]`)).join(''))
    .join('[ \\t]+');
const phrases = (list: string): string => list.trim().split(/\s*\n\s*/).map(anyCase).join('|');

/** A capitalised word of a name, or an initial (`J.`). */
const CUE_WORD = String.raw`(?:\p{Lu}[\p{Ll}\p{Lu}\p{M}'’\-]*\p{L}|\p{Lu}\.)`;
const CUE_PARTICLE = String.raw`(?:(?:de|del|la|las|los|van|von|da|di|der|den)[ \t]+)`;
const cueRun = (most: number): string => String.raw`${CUE_WORD}(?:[ \t]+${CUE_PARTICLE}*${CUE_WORD}){0,${most - 1}}`;
const CUE_RUN_RE = new RegExp(cueRun(4), 'gu');
const TITLE_FIRST = new RegExp(String.raw`^(?:${HONORIFIC})(?![\p{L}])`, 'u');
/** Quote markers and indentation before the text of a line. */
const LINE_LEAD = /^[ \t]*(?:>[ \t]*)*/;

const GREETING_RE = new RegExp(
  String.raw`^(?:${phrases(`
    Dear
    Hi
    Hello
    Hey
    Hiya
    Good morning
    Good afternoon
    Good evening
    Hola
    Buenos días
    Buenos dias
    Buenas tardes
    Buenas noches
    Buenas
  `)}|[Ee]stimad[oa](?:\/[oa])?|[Qq]uerid[oa](?:\/[oa])?)(?:[ \t]*,)?[ \t]+(?<name>${cueRun(3)}(?:(?:[ \t]*,[ \t]*|[ \t]+(?:and|y|&)[ \t]+)${cueRun(3)}){0,3})(?=[ \t]*(?:[,:;!.]|$))`,
  'du',
);

const CLOSING = phrases(`
  Regards
  Kind regards
  Best regards
  Warm regards
  Warmest regards
  With regards
  Many thanks
  Best wishes
  All the best
  Best
  Thanks
  Thanks again
  Thank you
  Cheers
  Sincerely
  Yours sincerely
  Yours faithfully
  Yours truly
  Respectfully
  Take care
  Saludos
  Saludos cordiales
  Un saludo
  Un cordial saludo
  Cordiales saludos
  Atentamente
  Cordialmente
  Gracias
  Muchas gracias
  Un abrazo
  Abrazos
`);
// Lines are trimmed at the end, and no two space runs sit side by side: `[ \t]*[,.]?[ \t]*` rereads a long run from each of its positions.
const CLOSING_LINE_RE = new RegExp(String.raw`^(?:${CLOSING})(?:[ \t]*[,.!])?$`, 'u');
/** A closing and the name on one line: `Un saludo, Wenceslao Tamames, Ayuntamiento`. */
const CLOSING_NAME_RE = new RegExp(String.raw`^(?:${CLOSING})[ \t]*,[ \t]*(?<name>${cueRun(4)})(?=[ \t]*(?:[,.]|$))`, 'du');
/** A job title after a sign-off name and a comma: `CEO`, `Head of Sales`, `Directora Financiera`, `Responsable de Administración`. */
const SIGN_TITLE = String.raw`\p{Lu}[\p{L}\p{M}&/.'’\-]*(?:[ \t]+[\p{L}][\p{L}\p{M}&/.'’\-]*){0,5}`;
/** A line that is only a name, as a sign-off writes it, maybe with a job title after a comma (`Odette Ashworth, CEO`). */
const NAME_LINE_RE = new RegExp(String.raw`^(?<name>${cueRun(4)})(?:[ \t]*[.,]|[ \t]*,[ \t]*${SIGN_TITLE})?$`, 'du');

const PERSON_LABEL_RE = new RegExp(
  String.raw`^(?:${phrases(`
    Name
    Full name
    Patient
    Customer
    Client
    Contact
    Contact person
    Attn
    Attention
    Nombre
    Nombre completo
    Paciente
    Cliente
    Contacto
    Persona de contacto
  `)})[ \t]*[:.][ \t]*(?<name>${cueRun(4)})(?=[ \t]*(?:[,;|(]|$))`,
  'du',
);
const ORG_LABEL_RE = new RegExp(String.raw`^(?:${phrases(`
  Company
  Company name
  Organisation
  Organization
  Employer
  Empresa
  Razón social
  Razon social
`)})[ \t]*:[ \t]*`, 'u');

/** A legal suffix as a company writes it, in its own case. */
const LEGAL = String.raw`(?:Ltd\.?|LTD\.?|LLC|LLP|Inc\.?|INC\.?|GmbH|GMBH|PLC|Plc|Corp\.?|CORP\.?|Co\.|S\.L\.U\.?|S\.L\.?|S\.A\.U\.?|S\.A\.?|SLU|SL|SAU|SA|B\.V\.?|BV)`;
/** A word of a company name: capitalised, all capitals, or written with digits or an ampersand (`H&M`). */
const ORG_TOKEN = String.raw`\p{Lu}[\p{L}\p{M}\p{N}'’&\-]*`;
const ORG_JOIN = String.raw`(?:&|and|y|e|de|del|la|las|los|of|the|for|el)`;
const orgRun = (most: number): string => String.raw`${ORG_TOKEN}(?:[ \t]+(?:${ORG_JOIN}[ \t]+){0,2}${ORG_TOKEN}){0,${most - 1}}`;
/** The gap before a legal suffix: spaces, a comma, or both (`Acme, Inc.`), read one way only. */
const LEGAL_GAP = String.raw`(?:[ \t]+(?:,[ \t]*)?|,[ \t]*)`;
/** A capitalised run that ends in a legal suffix, anywhere in the text. */
const LEGAL_RUN_RE = new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}_&'’\-])(?<run>${orgRun(6)})${LEGAL_GAP}${LEGAL}(?![\p{L}\p{N}\p{M}_])`, 'gdu');
/** A line that is only a company name: capitalised words, joining words, maybe a legal suffix. */
const ORG_LINE_RE = new RegExp(String.raw`^(?<run>${orgRun(6)}(?:${LEGAL_GAP}${LEGAL})?)$`, 'du');
const LEGAL_END_RE = new RegExp(String.raw`(?:^|[ \t,])${LEGAL}$`, 'u');

/**
 * Words that are not a name where a name is expected: role and group words
 * (`Hi team`, `Dear Customer`, a sign-off of `Accounts`), function words,
 * greetings and sentence openers. Folded, lower case. Built on first use: the
 * stop lists it reads are defined further down.
 */
let notNameWords: Set<string> | undefined;
const foldWord = (w: string): string => skeleton(foldLookalikes(w)).text.replace(/[.'’]+$/u, '');
function notName(word: string): boolean {
  notNameWords ??= new Set([
    ...ROLE_WORDS, ...FUNCTION_WORDS.en, ...FUNCTION_WORDS.es, ...NAME_STOP, ...PARTICLES,
    ...`
      all everyone everybody team teams there folks guys sir sirs madam madame mam customer customers client clients
      colleague colleagues friend friends member members user users partner partners valued subscriber subscribers
      reader readers patient patients parent parents resident residents neighbour neighbours neighbor neighbors
      student students applicant applicants candidate hiring manager managers department committee board staff world
      both you again people ladies gentlemen gents mum mom dad
      todos todas equipo cliente clientes amigo amigos amiga amigas companero companeros companera companeras socio
      socios senores senoras usuario usuarios vecino vecinos familia
      sent enviado iphone android mobile movil
      accounts reception recepcion front desk administracion comercial operations director directora purchasing
      compras ventas service services care departamento atencion
      unknown none pending same yes tbd
      regarding attached attaching invoice invoices quote quotes contact call email pay paid send
      payment payments supplier company account order ref reference total amount due also
      sobre segun adjunto adjuntamos factura facturas presupuesto proveedor empresa pago llama contacta importe
      via per
    `.trim().split(/\s+/),
  ].map(foldWord));
  return notNameWords.has(foldWord(word));
}

/** The words of a run, with their offsets in the run. */
const runWords = (run: string): Array<{ word: string; at: number }> => [...run.matchAll(/\S+/gu)].map((m) => ({ word: m[0], at: m.index }));
const JOIN_WORD = new RegExp(String.raw`^${ORG_JOIN}$`, 'u');
const LEGAL_WORD = new RegExp(String.raw`^${LEGAL}$`, 'u');
const isJoin = (w: string): boolean => JOIN_WORD.test(w) || PARTICLES.has(w);
const isLegal = (w: string): boolean => LEGAL_WORD.test(w);

/** Whether `run`, a capitalised run where a name is expected, reads as a person: no role, group or common word in it. */
function personRun(run: string): boolean {
  return runWords(run).every(({ word }) => CUE_PARTICLE_WORD.test(word) || !notName(word));
}
const CUE_PARTICLE_WORD = /^(?:de|del|la|las|los|van|von|da|di|der|den)$/u;

/**
 * Whether `run` reads as a company: a company word or a legal suffix, and at
 * least one word that is neither, so `Support Team` and `Dental Clinic` are not one.
 */
function orgRunOk(run: string): boolean {
  if (!ORG_WORD.test(run) && !LEGAL_END_RE.test(run)) return false;
  return runWords(run).some(({ word }) => !isJoin(word) && !isLegal(word) && !ORG_WORD.test(word) && !notName(word));
}

const lineSpans = (text: string): Array<{ start: number; content: string; at: number }> => {
  const out: Array<{ start: number; content: string; at: number }> = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const lead = LINE_LEAD.exec(line)?.[0].length ?? 0;
    // `trimEnd` and not a pattern: `/[ \t]+$/` rereads a long run of spaces from each of its positions.
    out.push({ start, content: line.slice(lead).trimEnd(), at: start + lead });
    start += raw.length + 1;
  }
  return out;
};

/**
 * Names where ordinary mail puts them. At the start of a line, a greeting
 * before one to three capitalised words (`Dear Margaret,`, `Hola Belén:`) and
 * a label before a name (`Patient: Priya Raman`) or a company
 * (`Company: Finchley Dental Ltd`). The line after a closing (`Kind regards,`),
 * or the line after that when the first is blank, holding only one to four
 * capitalised words, maybe with a job title after a comma (`Odette Ashworth, CEO`), is a person, or a company when
 * they carry a company word, and the first of the next three lines holding
 * only a company name is a company, unless a blank line comes first. Anywhere in the text, a capitalised run
 * before a legal suffix (`Moorcroft Joinery Ltd.`) is a company, without the
 * common words that open its sentence (`Regarding`). Group, role and common
 * words keep a greeting, sign-off or label from counting (`Hi team`,
 * `Dear Customer`, `Regards,` then `Accounts`).
 */
export const cueDetector: Detector = {
  name: 'cues',
  detect(text) {
    const out: Span[] = [];
    const add = (start: number, run: string, kind: 'person' | 'org'): void => {
      if (run.length < 2) return;
      out.push({ start, end: start + run.length, kind, priority: PRIORITY.cue });
    };
    /** A capitalised run where a name is expected: a person, a company, or nothing. */
    const named = (start: number, run: string): void => {
      if (ORG_WORD.test(run) || LEGAL_END_RE.test(run)) {
        if (orgRunOk(run)) add(start, run, 'org');
      } else if (personRun(run)) add(start, run, 'person');
    };
    const lines = lineSpans(text);
    lines.forEach((line, i) => {
      const c = line.content;
      if (c === '') return;
      for (const re of [GREETING_RE, PERSON_LABEL_RE, CLOSING_NAME_RE]) {
        const m = re.exec(c);
        if (!m) continue;
        const [s] = m.indices!.groups!.name as [number, number];
        // A greeting may name several people: `Hi Ana, Luis and Marta,`.
        for (const r of (m.groups!.name as string).matchAll(CUE_RUN_RE)) {
          // A title opens a name the context detector already reads (`Dear Dr. Tate`).
          if (TITLE_FIRST.test(r[0])) continue;
          named(line.at + s + r.index, r[0]);
        }
      }
      const org = ORG_LABEL_RE.exec(c);
      if (org) {
        const rest = c.slice(org[0].length);
        const m = ORG_LINE_RE.exec(rest.replace(/[.,;]$/, (p) => (LEGAL_END_RE.test(rest) ? p : '')));
        if (m && runWords(m.groups!.run as string).some(({ word }) => !isJoin(word) && !isLegal(word) && !notName(word))) {
          add(line.at + org[0].length, m.groups!.run as string, 'org');
        }
      }
      if (!CLOSING_LINE_RE.test(c)) return;
      // The name sits on the next line, or after one blank line (`Kind regards,`, a blank line, `Priya Raman`).
      const n = lines[i + 1]?.content === '' ? i + 2 : i + 1;
      const next = lines[n];
      const who = next && NAME_LINE_RE.exec(next.content);
      if (!next || !who) return;
      named(next.at, who.groups!.name as string);
      for (const after of lines.slice(n + 1, n + 4)) {
        if (after.content === '') break;
        const m = ORG_LINE_RE.exec(after.content);
        if (m && orgRunOk(m.groups!.run as string)) {
          add(after.at, m.groups!.run as string, 'org');
          break;
        }
      }
    });
    // The words the text writes in lower case, addresses aside, so `finchley` in a host does not make `Finchley` an ordinary word.
    let lower: Set<string> | undefined;
    for (const m of text.matchAll(LEGAL_RUN_RE)) {
      const [s] = m.indices!.groups!.run as [number, number];
      const words = runWords(m.groups!.run as string).map((w) => ({ ...w, at: w.at + s }));
      // "Microsoft Corp and Google LLC": a suffix inside the run ends one company and starts the next.
      let from = 0;
      words.forEach((w, k) => {
        if (k === words.length - 1 || !isLegal(w.word)) return;
        legalRun(words.slice(from, k + 1), w.at + w.word.length);
        from = k + 1;
      });
      legalRun(words.slice(from), m.index + m[0].length);
    }
    /** One company before a legal suffix: `words` the run before `end`, the suffix included or not. */
    function legalRun(words: Array<{ word: string; at: number }>, end: number): void {
      // "Priya Raman of Finchley Dental Ltd": a joining word with two words or more after it starts the company.
      for (let k = words.length - 3; k > 0; k--) {
        if (/^(?:of|de|del|for)$/u.test((words[k] as { word: string }).word)) {
          words = words.slice(k + 1);
          break;
        }
      }
      // The words that open the sentence, not the name: "Regarding", "Thanks", "Our", or a word that starts
      // the sentence and that the text also writes in lower case.
      while (words.length > 1) {
        const w = words[0] as { word: string; at: number };
        if (!isJoin(w.word) && !notName(w.word) && !(opensSentence(text, w.at) && (lower ??= lowerWords(text)).has(w.word.toLowerCase()))) break;
        words = words.slice(1);
      }
      while (words.length && isJoin((words[0] as { word: string }).word)) words = words.slice(1);
      if (words.length === 0) return;
      const start = (words[0] as { at: number }).at;
      const run = text.slice(start, end);
      if (!runWords(run).some(({ word }) => !isJoin(word) && !isLegal(word) && !notName(word))) return;
      add(start, run, 'org');
    }
    return out;
  },
};

/** The words `text` writes all in lower case, outside its emails and URLs. */
function lowerWords(text: string): Set<string> {
  const prose = text.replace(EMAIL_RE, ' ').replace(URL_RE, ' ');
  return new Set((prose.match(/[\p{L}\p{M}\p{N}_]+/gu) ?? []).filter((w) => w === w.toLowerCase()));
}

/** Whether the word at `at` starts the text, a line or a sentence: only spaces, quote markers or opening marks before it. */
function opensSentence(text: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /[ \t>"“«(¿¡*•\-]/u.test(text[i] as string)) i--;
  return i < 0 || /[\n.!?:]/u.test(text[i] as string);
}

export const builtinDetectors: Detector[] = [
  urlDetector, emailDetector, ibanDetector, typedIdDetector, phoneDetector, amountDetector, dateDetector,
  contextDetector, idDetector, cueDetector,
];

// ---------------------------------------------------------------- known values



export function personTokens(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean);
}

export function personForms(value: string): string[] {
  const toks = personTokens(value).slice(0, 6);
  // The value as given is always a form: a known "Al" or "De" is a name, whatever the stop lists say.
  const forms = new Set<string>(toks.length ? [toks.join(' ')] : []);
  for (let i = 0; i < toks.length; i++) {
    for (let j = i; j < toks.length; j++) {
      const parts = toks.slice(i, j + 1);
      if (parts.every((p) => PARTICLES.has(p.toLowerCase()))) continue;
      if (PARTICLES.has((parts[0] as string).toLowerCase())) continue;
      if (PARTICLES.has((parts[parts.length - 1] as string).toLowerCase())) continue;
      const form = parts.join(' ');
      // A part alone needs three letters, or two in a script without word spaces.
      if (parts.length === 1 && form.length < 3 && !(form.length === 2 && unspaced(form[0]))) continue;
      // A stop word alone ("Hola" of "Hola Smith") is found as written or in capitals: see `knownParts`.
      if (parts.length === 1 && toks.length > 1 && NAME_STOP.has(form.toLowerCase())) continue;
      forms.add(form);
    }
  }
  return [...forms];
}

/** Whether every word of `value` is a particle or stop word ("Al", "De La"): such a known value matches only as written or in capitals. */
export function stopWordValue(value: string): boolean {
  const toks = personTokens(value);
  return toks.length > 0 && toks.every((t) => PARTICLES.has(t.toLowerCase()) || NAME_STOP.has(t.toLowerCase()));
}

const asWritten = (s: string): string =>
  foldLookalikes(s).normalize('NFD').replace(/[\p{M}\u200b-\u200d\u2060\ufeff]/gu, '').replace(/\s+/gu, ' ').trim();

/** Whether `slice` writes the stop-word value `value` as given or in capitals ("Al" or "AL", never "al"), ignoring marks and hidden characters. */
export function writtenAs(slice: string, value: string): boolean {
  const s = asWritten(slice);
  // Capitals are taken before the fold: a Cyrillic `\u0432` stays as it is and its capital folds to `B`.
  return s === asWritten(value) || s === asWritten(value.toUpperCase());
}

const flexDigits = (digits: string): string[] => flexAtoms([...digits], String.raw`[\s.\-()]*`);

function knownForms(k: KnownValue): { forms: string[]; digits?: boolean } {
  const v = k.value.trim();
  switch (k.kind) {
    case 'person':
      return { forms: personForms(v) };
    case 'org': {
      const core = v.replace(ORG_SUFFIX, '').trim();
      return { forms: core.length >= 3 && core !== v ? [v, core] : [v] };
    }
    default:
      return { forms: [v] };
  }
}

const HANGUL_ANY = /\p{scx=Hangul}/u;

/** Kinds with a fake for a value of one letter of a script without word spaces. */
const ONE_LETTER_KINDS: ReadonlySet<string> = new Set<KnownKind>(['person', 'org', 'place', 'domain']);

const KNOWN_KINDS: ReadonlySet<string> = new Set<KnownKind>(['person', 'org', 'email', 'domain', 'phone', 'place', 'id']);

/**
 * Throws when a known entry is one the matcher cannot find and the leak check
 * cannot enforce, or one no fake can stand for: a kind outside `KnownKind`, a
 * value that is not a string, an empty or whitespace-only value, a single
 * character, a phone with fewer than two digits, an id with no ASCII letter
 * or digit (`日本`), or an email without an `@` that has text on both sides.
 * One letter of a script without word spaces (`华`) is a `person`, `org`,
 * `place` or `domain` like any other and is matched as a substring; as an
 * `email` or `id` it is refused,
 * since neither has a fake for one letter. The error names the entry's index
 * and, when it is one of the library's kinds, its kind, never its value or a
 * kind the caller made up.
 *
 * Returns the entries the matcher enforces only in part (see `UnenforcedKnown`):
 * a value made only of stop words, a full name with a one-letter Latin part
 * (`O` of `O Li`), and a full name with a part on the stop list that it writes
 * capitalised, and a value starting in Hangul with fewer than three syllables
 * (`지원`), found only where a word starts. A part the name writes in lower case
 * (`de` of `Ana de la Cruz`) is not looked for bare at all and is not listed.
 */
export function checkKnown(known: KnownValue[]): UnenforcedKnown[] {
  const unenforced: UnenforcedKnown[] = [];
  known.forEach((k, i) => {
    const raw: unknown = (k as { kind?: unknown } | null)?.kind;
    if (typeof raw !== 'string' || !KNOWN_KINDS.has(raw)) {
      throw new BlindError('invalid-known', `blind: known entry ${i} has a kind blind does not know; use one of ${[...KNOWN_KINDS].join(', ')}`);
    }
    const kind = raw;
    if (typeof k.value !== 'string') {
      throw new BlindError('invalid-known', `blind: known entry ${i} (${kind}) has a value that is not a string`);
    }
    // What the matcher sees: no accents, marks or zero-width characters.
    const v = skeleton(foldLookalikes(k.value)).text.trim();
    if (v === '') throw new BlindError('invalid-known', `blind: known entry ${i} (${kind}) is empty or only spaces; give the value to find`);
    const chars = [...v];
    const short = chars.length === 1 && !unspaced(chars[0] as string);
    const noDigits = kind === 'phone' && v.replace(/\D/g, '').length < 2;
    if (short || noDigits) {
      throw new BlindError('invalid-known', `blind: known entry ${i} (${kind}) is too short to find or check; give at least two characters`);
    }
    if (chars.length === 1 && !ONE_LETTER_KINDS.has(kind)) {
      throw new BlindError('invalid-known', `blind: known entry ${i} (${kind}) is one character, which has no ${kind} fake; give at least two characters`);
    }
    // The id fake rewrites the ASCII letters and digits of the value as written; the email fake rewrites both sides of its @.
    if (kind === 'id' && !/[A-Za-z0-9]/.test(k.value)) {
      throw new BlindError('invalid-known', `blind: known entry ${i} (id) has no ASCII letter or digit, which an id fake needs; give it as another kind`);
    }
    if (kind === 'email' && !/[^@\s]@[^@\s]/.test(k.value)) {
      throw new BlindError('invalid-known', `blind: known entry ${i} (email) has no @ with text on both sides, which an email fake needs; give the whole address`);
    }
    const toks = personTokens(k.value);
    if (stopWordValue(k.value)) unenforced.push({ kind: k.kind, index: i, reason: 'stop-word' });
    else if (kind === 'person' && toks.length > 1 && toks.some(oneLetterPart)) unenforced.push({ kind: k.kind, index: i, reason: 'one-letter-part' });
    else if (kind === 'person' && toks.length > 1 && toks.some((t) => knownPart(t) && stopWordValue(t))) unenforced.push({ kind: k.kind, index: i, reason: 'stop-word-part' });
    // Only a value with a Hangul letter can have a form whose skeleton starts in Hangul.
    else if (HANGUL_ANY.test(k.value) && knownForms(k).forms.some((f) => hangulAtWordStartOnly(skeleton(foldLookalikes(f)).text.trim()))) unenforced.push({ kind: k.kind, index: i, reason: 'hangul-inside-word' });
  });
  return unenforced;
}

/** Marks, hidden characters, and the vowel and final jamo of a Hangul syllable written as separate jamo. */
const TRAILING_MARK = /[\p{M}\u200b-\u200d\u2060\ufeff\u1161-\u1175\u11a8-\u11c2]/u;

/** `end`, a span end in `text` mapped back from a skeleton, moved past the marks the skeleton dropped. */
function pastMarks(text: string, end: number): number {
  while (end < text.length && TRAILING_MARK.test(text[end] as string)) end++;
  return end;
}

/**
 * Matches the owner's known values: case-insensitive, whole word, except a
 * value made only of stop words or particles ("Al", "De"), which matches as
 * written or in capitals, so "Al" is found in "Al" and "AL" and the Spanish
 * word in "fue al banco" stays. Names, orgs
 * and places are matched on a skeleton of the text (no accents, no combining
 * marks, no zero-width characters), so spelling variants find the same name.
 * Next to a letter of a script without word spaces (Chinese, Japanese) a
 * value is matched as a plain substring, a Korean value as `wordEdges`
 * says, and a Hebrew or Arabic value also behind a glued prefix (see `edged`),
 * which stays outside the span. Throws on a value it cannot match:
 * see `checkKnown`.
 */
export function knownDetector(known: KnownValue[]): Detector {
  return knownMatcher(known, true);
}

/**
 * `knownDetector` that compiles and runs every entry's pattern on every text,
 * as it did before the prefilter. Kept so a test can show the two find the
 * same spans; blind never uses it.
 */
export function everyKnownDetector(known: KnownValue[]): Detector {
  return knownMatcher(known, false);
}

/**
 * Where a known entry's prefilter keys are looked for: the skeleton of the text
 * (names, orgs, places, matched there with the `u` flag), the text with ASCII
 * letters in lower case (`asciiKeyText`, for values matched with `iu`), or the
 * digits of the text with phone separators taken out.
 */
type KeySpace = 'skel' | 'ascii' | 'digits';

interface KnownEntry {
  kind: KnownKind;
  skel: boolean;
  exact: string | undefined;
  /** The entry's matcher, compiled on first use. */
  find: () => (text: string) => Array<[number, number]>;
  space: KeySpace;
  /** Strings one of which every match contains, in `space`; null when the entry has none and is tried on every text. */
  keys: string[] | null;
}

const PHONE_SEP = /[\s.\-()]/g;

/**
 * `text` with each ASCII letter in lower case, the two other letters a pattern
 * with the `iu` flags matches to an ASCII letter (long s, Kelvin sign) as that
 * letter, and every other non-ASCII code unit as U+FFFF, which no key holds.
 * Same length as `text`. Where an ASCII run of a value matches with `iu`, its
 * lower case is written here.
 */
export function asciiKeyText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) out += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 32) : text[i];
    else out += c === 0x17f ? 's' : c === 0x212a ? 'k' : '\uffff';
  }
  return out;
}

/** The longest of `pieces`, or null when they are all empty. */
const longest = (pieces: string[]): string | null => pieces.reduce<string | null>((a, p) => (p && (!a || p.length > a.length) ? p : a), null);

/**
 * One `known` value ready to match: its pattern, compiled on first use, and the
 * keys that tell the prefilter whether a text can hold it. A phone's keys are its
 * digits, with and without a country code; a name, company or place's are the
 * longest run of each form without whitespace, on the skeleton; any other kind's
 * are the longest ASCII run of each form, in lower case. A form with no key leaves
 * the entry without keys, so it is tried on every text.
 */
function knownEntry(k: KnownValue): KnownEntry {
  const textual = k.kind === 'person' || k.kind === 'org' || k.kind === 'place';
  const lazy = (make: () => (text: string) => Array<[number, number]>): (() => (text: string) => Array<[number, number]>) => {
    let m: ((text: string) => Array<[number, number]>) | undefined;
    return () => (m ??= make());
  };
  if (k.kind === 'phone') {
    const digits = k.value.replace(/\D/g, '');
    const keys = [digits];
    for (let n = 3; n >= 1; n--) {
      if (COUNTRY_CODES.has(digits.slice(0, n)) && digits.length - n >= 7) {
        keys.push(digits.slice(n));
        break;
      }
    }
    const find = lazy(() => {
      const alts = keys.map(flexDigits);
      // `(?:(?:\+|00)[ ]?)?(?:a1|a2)`, written out in the order the engine tries it.
      const lead = String.raw`(?:\+|00)`;
      const withLead = (prefix: string): string[][] => alts.map((a) => [prefix, ...a]);
      return alternativesMatcher([...withLead(`${lead}[ ]`), ...withLead(lead), ...alts], String.raw`(?<![\d])`, String.raw`(?![\d])`, 'iu');
    });
    // Every match writes the digits of one alternative with only separators between them.
    return { kind: k.kind, skel: false, exact: undefined, find, space: 'digits', keys };
  }
  // The text is read folded (see `foldLookalikes`), so the value is folded the same way.
  const values = knownForms(k)
    .forms.slice()
    .sort((a, b) => b.length - a.length)
    .map((f) => (textual ? skeleton(foldLookalikes(f)).text : foldLookalikes(f)));
  const find = lazy(() => alternativesMatcher(values.map((v) => (v ? edged(v, spacedAtoms(v)) : [])), '', '', textual ? 'u' : 'iu'));
  const exact = stopWordValue(k.value) ? k.value : undefined;
  // `spacedAtoms` matches every character but whitespace as written, so each match holds every
  // run of the value without whitespace. With `iu`, only its runs of ASCII are compared, in lower case.
  const keys: string[] = [];
  for (const v of values.filter(Boolean)) {
    const runs = v.split(/\s+/);
    const key = textual ? longest(runs) : longest(runs.flatMap((r) => r.split(/[^\0-\x7f]+/)).map((r) => r.toLowerCase()));
    if (key === null) return { kind: k.kind, skel: textual, exact, find, space: textual ? 'skel' : 'ascii', keys: null };
    keys.push(key);
  }
  return { kind: k.kind, skel: textual, exact, find, space: textual ? 'skel' : 'ascii', keys };
}

/**
 * The detector over `known`. With `filtered`, an entry's pattern runs only on a
 * text that holds one of its keys; without it, every entry runs on every text.
 * Both push the spans in the order of `known`.
 */
function knownMatcher(known: KnownValue[], filtered: boolean): Detector {
  checkKnown(known);
  const entries = known.map(knownEntry);
  /** Per key space, each distinct key's entries and a finder over the distinct keys. */
  let index: Map<KeySpace, { owners: number[][]; find: (text: string) => Set<number> }> | undefined;
  const always = entries.flatMap((e, i) => (e.keys ? [] : [i]));
  const candidates = (text: string, sk: string | undefined): number[] => {
    if (!filtered) return entries.map((_, i) => i);
    if (!index) {
      index = new Map();
      for (const space of ['skel', 'ascii', 'digits'] as const) {
        // One key shared by many entries is searched once, so a text that repeats it costs no more.
        const byKey = new Map<string, number[]>();
        entries.forEach((e, i) => {
          if (e.space !== space || !e.keys) return;
          for (const key of e.keys) {
            const list = byKey.get(key);
            if (!list) byKey.set(key, [i]);
            else if (list[list.length - 1] !== i) list.push(i);
          }
        });
        if (byKey.size) index.set(space, { owners: [...byKey.values()], find: literalPresence([...byKey.keys()]) });
      }
    }
    const hit = new Set(always);
    for (const [space, { owners, find }] of index) {
      const t = space === 'skel' ? (sk as string) : space === 'ascii' ? asciiKeyText(text) : text.replace(PHONE_SEP, '');
      for (const key of find(t)) for (const i of owners[key] as number[]) hit.add(i);
    }
    // In the order of `known`, as the spans were pushed when every entry was tried.
    return [...hit].sort((a, b) => a - b);
  };
  return {
    name: 'known',
    detect(text) {
      const out: Span[] = [];
      const sk = entries.some((c) => c.skel) ? skeleton(text) : null;
      for (const i of candidates(text, sk?.text)) {
        const c = entries[i] as KnownEntry;
        if (c.skel && sk) {
          for (const [s, e] of c.find()(sk.text)) {
            const start = sk.from[s] as number;
            const end = pastMarks(text, (sk.from[e - 1] as number) + 1);
            if (c.exact !== undefined && !writtenAs(text.slice(start, end), c.exact)) continue;
            out.push({ start, end, kind: c.kind, priority: PRIORITY.known });
          }
        } else {
          for (const [start, end] of c.find()(text)) {
            if (c.exact !== undefined && !writtenAs(text.slice(start, end), c.exact)) continue;
            out.push({ start, end, kind: c.kind, priority: PRIORITY.known });
          }
        }
      }
      return out;
    },
  };
}

// ----------------------------------------------------------------- propagation

/**
 * The offsets `spans` cover, one byte each, so checking a span against all of
 * them costs the span's length instead of the number of spans. Without this a
 * long text took time that grew with the square of its length.
 */
function coverage(spans: ReadonlyArray<{ start: number; end: number }>, length: number): Uint8Array {
  const c = new Uint8Array(length);
  for (const s of spans) c.fill(1, Math.max(0, s.start), Math.min(length, s.end));
  return c;
}

/** Whether any offset in `[start, end)` is covered. */
function covered(c: Uint8Array, start: number, end: number): boolean {
  for (let i = Math.max(0, start), e = Math.min(c.length, end); i < e; i++) if (c[i]) return true;
  return false;
}

const NAME_STOP = new Set([
  'de', 'del', 'la', 'las', 'los', 'van', 'von', 'da', 'di', 'y', 'e', 'el', 'the', 'and',
  'hola', 'hello', 'dear', 'estimado', 'estimada', 'gracias', 'thanks', 'saludos', 'regards', 'cheers', 'from', 'subject', 'date',
  // Two-letter words and titles, never taken bare as a name part.
  'al', 'am', 'an', 'as', 'at', 'be', 'by', 'cc', 'do', 'dr', 'en', 'es', 'go', 'ha', 'he', 'hi', 'if', 'in', 'is', 'it', 'jr',
  'le', 'lo', 'me', 'mi', 'mr', 'ms', 'mx', 'my', 'ni', 'no', 'of', 'oh', 'ok', 'on', 'or', 'os', 'pm', 'ps', 're', 'se', 'si',
  'so', 'sr', 'st', 'su', 'te', 'to', 'tu', 'un', 'up', 'us', 'ya', 'yo', 'we',
]);
const NAME_TOKEN = /^\p{Lu}[\p{L}'’\-]{2,}$/u;
/** A two-letter name part, as in "Li Na". */
const SHORT_NAME_TOKEN = /^\p{Lu}\p{L}$/u;

/**
 * The two-letter entries of the stop lists, split by the language that writes
 * them as words. Name particles and abbreviations count in every language.
 */
const TWO_LETTER_STOP: Record<Lang | 'any', Set<string>> = {
  any: new Set(['da', 'de', 'di', 'do', 'cc', 'dr', 'jr', 'mr', 'ms', 'mx', 'ok', 'pm', 'ps', 're', 'sr', 'st']),
  en: new Set([
    'am', 'an', 'as', 'at', 'be', 'by', 'go', 'ha', 'he', 'hi', 'if', 'in', 'is', 'it', 'me', 'my', 'no', 'of', 'oh', 'on', 'or',
    'so', 'to', 'up', 'us', 'we',
  ]),
  es: new Set([
    'al', 'el', 'en', 'es', 'ha', 'la', 'le', 'lo', 'me', 'mi', 'ni', 'no', 'os', 'se', 'si', 'su', 'te', 'tu', 'un', 'ya', 'yo',
  ]),
};

/** Whether the lower-case two-letter `word` is a particle or stop word in `lang` ("al" in Spanish, "an" in English). */
export function twoLetterStop(word: string, lang: Lang): boolean {
  return TWO_LETTER_STOP.any.has(word) || TWO_LETTER_STOP[lang].has(word);
}

/** Whether `tok` is a two-letter part the leak check and bare mentions take as a name. */
export function shortNamePart(tok: string): boolean {
  return SHORT_NAME_TOKEN.test(tok) && !NAME_STOP.has(tok.toLowerCase()) && !PARTICLES.has(tok.toLowerCase());
}
const EDGE_PUNCT = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

/** Capitalised name tokens of three letters or more, without particles and greetings. */
export function nameTokens(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    for (const raw of name.split(/\s+/u)) {
      const tok = raw.replace(EDGE_PUNCT, '');
      if (NAME_TOKEN.test(tok) && !NAME_STOP.has(tok.toLowerCase())) out.add(tok);
    }
  }
  return [...out];
}

/**
 * The parts of the known people with a full name that are found again bare,
 * as written or in capitals: a two-letter part ("Li" and "Na" of "Li Na"), a
 * one-letter part ("O" of "O Li") and a stop word or particle the name writes capitalised ("Al" of "Al Brenner").
 * A part the name writes in lower case ("de" of "Ana de la Cruz") is not one.
 */
export function knownParts(known: KnownValue[]): string[] {
  const out = new Set<string>();
  for (const k of known) {
    if (k.kind !== 'person' || typeof k.value !== 'string') continue;
    const toks = personTokens(k.value).map((t) => t.replace(EDGE_PUNCT, ''));
    if (toks.length < 2) continue;
    for (const t of toks) if (knownPart(t)) out.add(t);
  }
  return [...out];
}

/** Whether `tok`, a word of a known full name, is one `knownParts` finds bare. */
export function knownPart(tok: string): boolean {
  if (!/^\p{Lu}/u.test(tok)) return false;
  return SHORT_NAME_TOKEN.test(tok) || stopWordValue(tok) || oneLetterPart(tok);
}

/**
 * Whether `tok`, a word of a known full name, is one capital letter of a script
 * with letter case (`O` of `O Li`, `J.` of `J. Orvane`). It gets a fake inside the
 * name and is found bare as written or in capitals, never in lower case, where
 * `o`, `y`, `a` and `e` are ordinary words. One letter without case (`华`) is not one.
 */
export function oneLetterPart(tok: string): boolean {
  return /^\p{Lu}$/u.test(tok.replace(EDGE_PUNCT, ''));
}

/**
 * Whether `tok`, a word of a known full name, is also found bare in lower case:
 * a two-letter part ("li" of "Li Na"), wherever the lower-case word is not a
 * particle or stop word in the language of the text there (see `twoLetterStop`).
 */
export function lowerCasePart(tok: string): boolean {
  return SHORT_NAME_TOKEN.test(tok);
}

/**
 * Bare mentions of names already found: "Pilar Gómez" in a header covers
 * "Pilar" in the greeting, and so do "Pilár" and "PILAR": tokens are matched
 * on the accent-free, lower-cased skeleton of the text. A token counts only
 * when `text` never writes it all in lower case outside an address or URL,
 * which would make it an ordinary word ("Rosa" the name against "rosa" the
 * colour). With `asWritten`, a token counts wherever it is written as given or
 * in capitals, whatever else the text writes in lower case, and with `lower`
 * also a copy written all in lower case where `lower` says yes to its accent-free
 * form and offset. Spans overlapping `taken` are skipped, so this never fights a
 * span another detector already holds.
 */
export function bareMentions(
  text: string,
  tokens: string[],
  taken: Span[],
  priority: number,
  asWritten = false,
  lower?: (form: string, start: number) => boolean,
): Span[] {
  if (tokens.length === 0) return [];
  const sk = skeleton(text);
  const forms = [...new Set(tokens.map((t) => skeleton(foldLookalikes(t)).text).filter(Boolean))].sort((a, b) => b.length - a.length);
  const addresses = coverage(taken.filter((s) => s.kind === 'email' || s.kind === 'url'), text.length);
  const found = matchAlternatives(sk.text, forms.map(literalAtoms), BEFORE, AFTER, 'u').map(([s, e]) => {
    const end = pastMarks(text, (sk.from[e - 1] as number) + 1);
    return { form: sk.text.slice(s, e), start: sk.from[s] as number, end };
  });
  // A form written all in lower case anywhere outside an address is an ordinary word,
  // unless the tokens are taken as written, where only that one copy is skipped.
  const words = new Set(
    asWritten ? [] : found.filter((f) => !addresses[f.start] && !/\p{Lu}/u.test(text.slice(f.start, f.end))).map((f) => f.form),
  );
  const held = coverage(taken, text.length);
  const out: Span[] = [];
  for (const f of found) {
    if (words.has(f.form) || covered(held, f.start, f.end)) continue;
    if (asWritten && !tokens.some((t) => writtenAs(text.slice(f.start, f.end), t))) {
      const slice = text.slice(f.start, f.end);
      if (!lower || /\p{Lu}/u.test(slice) || !lower(f.form, f.start)) continue;
    }
    out.push({ start: f.start, end: f.end, kind: 'person', priority });
  }
  return out;
}

// --------------------------------------------------------------------- resolve

/** Greedy by priority, then length, then position. No two accepted spans overlap. */
export function resolveSpans<S extends Span>(spans: S[]): S[] {
  const sorted = spans
    .slice()
    .sort((a, b) => (b.priority ?? 70) - (a.priority ?? 70) || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const held = new Uint8Array(sorted.reduce((n, s) => Math.max(n, s.end), 0));
  const accepted: S[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) continue;
    if (covered(held, s.start, s.end)) continue;
    held.fill(1, Math.max(0, s.start), s.end);
    accepted.push(s);
  }
  return accepted.sort((a, b) => a.start - b.start);
}

export function detectSpans(text: string, ctx: DetectContext, detectors: Detector[]): Span[] {
  return resolveSpans(detectors.flatMap((d) => d.detect(text, ctx)));
}

/**
 * A caller's detector behind a boundary. Nothing it throws reaches the caller
 * as thrown, a `BlindError` included: the error becomes one that names the
 * stage and, for a `BlindError`, its kind (`internal` when the kind is not one
 * of blind's). Its spans are copied field by field inside the same boundary.
 */
export function callerDetector(d: Detector): Detector {
  return {
    name: 'caller',
    detect(text, ctx) {
      try {
        return Array.from(d.detect(text, ctx), (s) => ({ start: s.start, end: s.end, kind: s.kind, priority: s.priority, meta: s.meta }));
      } catch (e) {
        let kind: BlindErrorKind | undefined;
        try {
          if (e instanceof BlindError) kind = isBlindErrorKind(e.kind) ? e.kind : 'internal';
        } catch {
          kind = 'internal';
        }
        throw kind ? new BlindError(kind, `blind: detector error while detecting values (${kind})`) : new BlindError('internal', 'blind: internal error while detecting values');
      }
    },
  };
}

/**
 * The spans `blind` replaces in each text of one call: every detector, overlaps
 * resolved, then bare hosts, the names private addresses give away (see
 * `addressNames`), and mentions of any person found anywhere in the call.
 */
export function findSpans(texts: string[], ctx: DetectContext, detectors: Detector[]): Span[][] {
  const detected = privateHosts(texts, texts.map((t) => {
    const raw = detectors.flatMap((d) => d.detect(t, ctx)).filter((s) => {
      if ((s.kind === 'amount' || s.kind === 'date') && !s.meta) return false;
      return s.start >= 0 && s.end <= t.length;
    });
    return resolveSpans(raw);
  }), ctx);
  const addressed = addressNames(texts, detected, ctx);
  const firstPass = detected.map((spans, ti) => (addressed.orgs[ti]?.length ? resolveSpans([...spans, ...(addressed.orgs[ti] as Span[])]) : spans));
  // "Pilar Gómez <pilar@...>" in one text covers a later "Hola Pilar" in any text of the call,
  // and so does "margaret.holloway@finchley-dental.example" a later "Margaret".
  const tokens = [
    ...nameTokens(firstPass.flatMap((spans, ti) => spans.filter((s) => s.kind === 'person').map((s) => (texts[ti] as string).slice(s.start, s.end)))),
    ...addressed.people,
  ];
  // So is a short or stop-word part of a known full name ("Li" of "Li Na", "O" of "O Li", "Al" of "Al Brenner"),
  // as written or in capitals, even where the text also writes it in lower case.
  const parts = knownParts(ctx.known ?? []);
  // A company found once is found again by its full name, written the same way.
  const orgs = [...new Set(firstPass.flatMap((spans, ti) => spans.filter((s) => s.kind === 'org').map((s) => (texts[ti] as string).slice(s.start, s.end).trim())))]
    .filter((o) => o.length >= 4 && /\p{Lu}/u.test(o));
  const found = firstPass.map((spans, ti) => {
    const text = texts[ti] as string;
    const named = bareMentions(text, tokens, spans, PRIORITY.mention);
    const people = [...named, ...bareMentions(text, parts, [...spans, ...named], PRIORITY.mention, true)];
    return resolveSpans([...spans, ...people, ...repeatedNames(text, orgs, [...spans, ...people], PRIORITY.mention)]);
  });
  // A two-letter part in lower case ("li" of "Li Na") is the name too, unless the
  // language of the text there writes it as a word ("al" in "Fue al banco").
  const lower = parts.filter(lowerCasePart);
  if (lower.length === 0) return found;
  const lang = new TextLanguage(texts, found);
  return found.map((spans, ti) => {
    const more = bareMentions(texts[ti] as string, lower, spans, PRIORITY.mention, true, (form, start) => !twoLetterStop(form, lang.at(ti, start)));
    return more.length ? resolveSpans([...spans, ...more]) : spans;
  });
}

const LOCAL_PART = new RegExp(String.raw`^(.*?)${AT_SRC}`, 'i');
const LEGAL_AFTER = new RegExp(String.raw`^${LEGAL_GAP}${LEGAL}(?![\p{L}\p{N}\p{M}_])`, 'u');

/**
 * What the private addresses of the call say about names. The words of a
 * private host (`finchley-dental`), written as capitalised words in a text
 * (`Finchley Dental`, `Finchley Dental Ltd`), are a company there. The words of
 * the local part of a private address (`margaret` and `holloway` of
 * `margaret.holloway@...`), three letters or more and not role or host words,
 * are name tokens, found again the way a name found once is.
 */
function addressNames(texts: string[], found: Span[][], ctx: DetectContext): { orgs: Span[][]; people: string[] } {
  const hostWords: string[][] = [];
  const labelWords = new Set<string>();
  for (const host of hostsOf(texts, found, ctx)) {
    for (const label of host.split('.').slice(0, -1)) {
      if (COMMON_LABELS.has(label)) continue;
      const parts = label.split('-');
      for (const p of parts) labelWords.add(p);
      // A company name in a host is a few words: `finchley-dental`, not a label of hundreds. A label is at most
      // 63 characters in DNS, which also keeps each pattern short enough to match all hosts in one pass.
      if (label.length <= 63 && parts.length >= 2 && parts.length <= 6 && parts.every((p) => /^\p{L}{2,}$/u.test(p))) hostWords.push(parts);
    }
  }
  const people = new Set<string>();
  found.forEach((spans, ti) => {
    for (const s of spans) {
      if (s.kind !== 'email') continue;
      const value = (texts[ti] as string).slice(s.start, s.end);
      // Only a whole address with a dotted host: a part of one a caller's detector marked (`ana%40zqh`) would
      // make its local part a name, and a later copy of that part would be replaced inside the address.
      const host = emailHost(value).toLowerCase();
      if (!host.includes('.') || ctx.isAllowedHost(host)) continue;
      for (const w of (LOCAL_PART.exec(value)?.[1] ?? '').toLowerCase().split(/[._+\-]+/)) {
        if (/^\p{L}{3,}$/u.test(w) && !labelWords.has(w) && !notName(w)) people.add(w);
      }
    }
  });
  // Each host's words with a space run or a hyphen between them, longest first, once each.
  const alts = [...new Map(hostWords.map((parts) => [parts.join('-'), parts])).values()]
    .sort((x, y) => y.join('-').length - x.join('-').length)
    .map((parts) => parts.flatMap((p, i) => [...(i ? [String.raw`(?:[ \t]+|-)`] : []), ...literalAtoms(p)]));
  const orgs = texts.map((text, ti) => {
    if (alts.length === 0) return [];
    const sk = skeleton(text);
    const held = coverage((found[ti] as Span[]).filter((s) => s.kind === 'email' || s.kind === 'url'), text.length);
    const out: Span[] = [];
    for (const [ms, me] of matchAlternatives(sk.text, alts, BEFORE, AFTER, 'u')) {
      const start = sk.from[ms] as number;
      let end = pastMarks(text, (sk.from[me - 1] as number) + 1);
      if (covered(held, start, end)) continue;
      if (!text.slice(start, end).split(/[ \t-]+/).every((w) => /^\p{Lu}/u.test(w))) continue;
      end += LEGAL_AFTER.exec(text.slice(end))?.[0].length ?? 0;
      out.push({ start, end, kind: 'org', priority: PRIORITY.cue });
    }
    return out;
  });
  return { orgs, people: [...people] };
}

/** Other places where one of `names` is written exactly, whole word, outside `taken`. */
export function repeatedNames(text: string, names: string[], taken: Span[], priority: number): Span[] {
  if (names.length === 0) return [];
  const held = coverage(taken, text.length);
  const out: Span[] = [];
  const alts = names.slice().sort((a, b) => b.length - a.length).map(literalAtoms);
  for (const [start, end] of matchAlternatives(text, alts, BEFORE, AFTER, 'u')) {
    if (!covered(held, start, end)) out.push({ start, end, kind: 'org', priority });
  }
  return out;
}
