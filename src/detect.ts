import { detectAmounts } from './amounts.js';
import { detectDates } from './dates.js';
import { foldLookalikes, skeleton } from './fold.js';
import { detectIds } from './ids.js';
import { alternativesMatcher, flexAtoms, literalAtoms, matchAlternatives, spacedAtoms } from './match.js';
import { AFTER, BEFORE, edged, hangulAtWordStartOnly, unspaced } from './script.js';
import { TextLanguage } from './language.js';
import { AT_SRC, COUNTRY_CODES, IBAN_LENGTHS, ORG_SUFFIX, PARTICLES, type Lang } from './names.js';
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
  labelledId: 61,
  id: 60,
  mention: 40,
} as const;


const EMAIL_SRC = String.raw`[A-Za-z0-9._%+\-]+${AT_SRC}(?:[A-Za-z0-9\-]+\.)+[A-Za-z]{2,}`;
const EMAIL_RE = new RegExp(String.raw`(?<![A-Za-z0-9._%+\-])${EMAIL_SRC}`, 'g');

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

export const urlDetector: Detector = {
  name: 'url',
  detect(text) {
    const out: Span[] = [];
    for (const m of text.matchAll(URL_RE)) {
      const trimmed = m[0].replace(/[.,;:!?)\]]+$/, '');
      if (trimmed.length < 8) continue;
      out.push({ start: m.index!, end: m.index! + trimmed.length, kind: 'url', priority: PRIORITY.url });
    }
    return out;
  },
};

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
    return out;
  },
};

const ID_DIGITS_RE = /(?<![\p{L}\p{N}_])\d{6,}(?![\p{L}\p{N}_])/gu;
const ID_ALNUM_RE = /(?<![\p{L}\p{N}_])[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*(?![\p{L}\p{N}_])/gu;

export const idDetector: Detector = {
  name: 'id',
  detect(text) {
    const out: Span[] = [];
    for (const m of text.matchAll(ID_DIGITS_RE)) {
      out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'id', priority: PRIORITY.id });
    }
    for (const m of text.matchAll(ID_ALNUM_RE)) {
      const t = m[0];
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
      const name = text.slice(s, e).replace(/[.'’\-]+$/, '');
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
    return detectAmounts(text).map((o) => ({
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

export const builtinDetectors: Detector[] = [
  urlDetector, emailDetector, ibanDetector, typedIdDetector, phoneDetector, amountDetector, dateDetector,
  contextDetector, idDetector,
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
    else if (knownForms(k).forms.some((f) => hangulAtWordStartOnly(skeleton(foldLookalikes(f)).text.trim()))) unenforced.push({ kind: k.kind, index: i, reason: 'hangul-inside-word' });
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
  checkKnown(known);
  const textual = new Set(['person', 'org', 'place']);
  const compiled = known
    .map((k) => {
      const skel = textual.has(k.kind);
      if (k.kind === 'phone') {
        const digits = k.value.replace(/\D/g, '');
        const alts = [flexDigits(digits)];
        for (let n = 3; n >= 1; n--) {
          if (COUNTRY_CODES.has(digits.slice(0, n)) && digits.length - n >= 7) {
            alts.push(flexDigits(digits.slice(n)));
            break;
          }
        }
        // `(?:(?:\+|00)[ ]?)?(?:a1|a2)`, written out in the order the engine tries it.
        const lead = String.raw`(?:\+|00)`;
        const withLead = (prefix: string): string[][] => alts.map((a) => [prefix, ...a]);
        return { kind: k.kind, skel, exact: undefined, find: alternativesMatcher([...withLead(`${lead}[ ]`), ...withLead(lead), ...alts], String.raw`(?<![\d])`, String.raw`(?![\d])`, 'iu') };
      }
      const forms = knownForms(k)
        .forms.slice()
        .sort((a, b) => b.length - a.length)
        .map((f) => {
          // The text is read folded (see `foldLookalikes`), so the value is folded the same way.
          const v = skel ? skeleton(foldLookalikes(f)).text : foldLookalikes(f);
          return v ? edged(v, spacedAtoms(v)) : [];
        });
      const exact = stopWordValue(k.value) ? k.value : undefined;
      return { kind: k.kind, skel, exact, find: alternativesMatcher(forms, '', '', skel ? 'u' : 'iu') };
    });
  return {
    name: 'known',
    detect(text) {
      const out: Span[] = [];
      const sk = compiled.some((c) => c.skel) ? skeleton(text) : null;
      for (const c of compiled) {
        if (c.skel && sk) {
          for (const [s, e] of c.find(sk.text)) {
            const start = sk.from[s] as number;
            const end = pastMarks(text, (sk.from[e - 1] as number) + 1);
            if (c.exact !== undefined && !writtenAs(text.slice(start, end), c.exact)) continue;
            out.push({ start, end, kind: c.kind, priority: PRIORITY.known });
          }
        } else {
          for (const [start, end] of c.find(text)) {
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
 * resolved, then bare mentions of any person found anywhere in the call.
 */
export function findSpans(texts: string[], ctx: DetectContext, detectors: Detector[]): Span[][] {
  const firstPass = texts.map((t) => {
    const raw = detectors.flatMap((d) => d.detect(t, ctx)).filter((s) => {
      if ((s.kind === 'amount' || s.kind === 'date') && !s.meta) return false;
      return s.start >= 0 && s.end <= t.length;
    });
    return resolveSpans(raw);
  });
  // "Pilar Gómez <pilar@...>" in one text covers a later "Hola Pilar" in any text of the call.
  const tokens = nameTokens(firstPass.flatMap((spans, ti) => spans.filter((s) => s.kind === 'person').map((s) => (texts[ti] as string).slice(s.start, s.end))));
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
