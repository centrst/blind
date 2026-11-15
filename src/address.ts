/**
 * Postal addresses: street lines, the locality and postal code after them,
 * a postal code after its label, and the labelled blocks receipts and
 * invoices write (`Shipping address`, `Ship to`, `Dirección de envío`).
 * English street lines (number, name, suffix, unit), Spanish ones (street
 * type, name, number, floor and door), US and Canadian localities, UK
 * postcodes and five-digit postal codes before a town. Not a geocoder: a
 * street without a number, a town alone in prose and other layouts are not
 * read. Every pattern is bounded, so a long run of spaces costs no more than
 * a short one.
 */
import { esc } from './match.js';

/** `word` in either letter case, letter by letter, so the patterns keep `\p{Lu}` meaning upper case. */
const ci = (word: string): string => [...word].map((c) => (c.toLowerCase() === c.toUpperCase() ? esc(c) : `[${c.toUpperCase()}${c.toLowerCase()}]`)).join('');
const anyOf = (words: readonly string[]): string => `(?:${[...words].sort((a, b) => b.length - a.length).map(ci).join('|')})`;

const SP = '[ \\t]{1,3}';
const OPT_SP = '[ \\t]{0,3}';
/** A capitalised word, or one in capitals. */
const WORD = String.raw`\p{Lu}[\p{L}\p{M}'’\-]*`;

export const EN_SUFFIXES = [
  'Street', 'St', 'Road', 'Rd', 'Avenue', 'Ave', 'Av', 'Boulevard', 'Blvd', 'Lane', 'Ln', 'Drive', 'Dr', 'Court', 'Ct', 'Way',
  'Place', 'Pl', 'Terrace', 'Ter', 'Parkway', 'Pkwy', 'Circle', 'Cir', 'Highway', 'Hwy', 'Square', 'Sq', 'Close', 'Crescent',
  'Cres', 'Grove', 'Gardens', 'Gdns', 'Row', 'Mews', 'Trail', 'Trl', 'Loop', 'Pike', 'Plaza', 'Walk', 'Alley', 'Path',
] as const;
const DIRECTIONS = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'North', 'South', 'East', 'West'] as const;
const UNIT_WORDS = ['Apt', 'Apartment', 'Unit', 'Suite', 'Ste', 'Flat', 'Floor', 'Fl', 'Room', 'Rm', 'Bldg', 'Building'] as const;
export const ES_TYPES = [
  'Calle', 'Avenida', 'Avda', 'Paseo', 'Plaza', 'Pza', 'Ronda', 'Camino', 'Carretera', 'Ctra', 'Travesía', 'Travesia', 'Glorieta',
  'Rambla', 'Carrer', 'Passeig', 'Plaça', 'Callejón', 'Callejon', 'Pasaje', 'Urbanización', 'Urbanizacion', 'Urb',
] as const;
const ES_PARTS = ['de', 'del', 'la', 'las', 'los', 'el', 'y', 'i'] as const;
/**
 * The particles in lower case only. A capitalised `De` is a name word, so no word
 * matches both and a run of them (`Calle De De De ...`) cannot backtrack.
 */
const PART = `(?:${ES_PARTS.join('|')})`;

/** US states and territories, and Canadian provinces and territories. */
export const REGION_CODES: ReadonlySet<string> = new Set(
  `AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX
   UT VT VA WA WV WI WY DC PR GU VI AS MP AB BC MB NB NL NS NT NU ON PE QC SK YT`.trim().split(/\s+/),
);
const REGION = `(?:${[...REGION_CODES].join('|')})`;

const COUNTRIES = [
  'United States of America', 'United States', 'USA', 'U.S.A.', 'US', 'U.S.', 'United Kingdom', 'UK', 'U.K.', 'Great Britain',
  'England', 'Scotland', 'Wales', 'Northern Ireland', 'Ireland', 'Canada', 'Australia', 'New Zealand', 'Spain', 'España', 'Espana',
  'Mexico', 'México', 'France', 'Germany', 'Deutschland', 'Italy', 'Italia', 'Portugal', 'Netherlands', 'Argentina', 'Chile',
  'Colombia', 'Peru', 'Perú', 'Uruguay', 'Venezuela', 'Ecuador', 'Bolivia', 'Paraguay',
] as const;
/** A line or comma piece that is only a country, which stays as written. */
const COUNTRY_RE = new RegExp(`^${anyOf(COUNTRIES)}$`, 'u');

const US_ZIP = String.raw`\d{5}(?:-\d{4})?`;
const CA_POST = String.raw`[A-Z]\d[A-Z][ \t]?\d[A-Z]\d`;
const UK_POST = String.raw`(?:[A-Z]{1,2}\d[A-Z\d]?[ \t]?\d[A-Z]{2})`;
const POSTAL = `(?:${CA_POST}|${UK_POST}|${US_ZIP})`;

/** A town: one to four capitalised words, Spanish particles between them. */
const TOWN = `${WORD}(?:${SP}(?:${PART}${SP})?${WORD}){0,3}`;

const UNIT = `(?:${anyOf(UNIT_WORDS)}\\.?${OPT_SP}#?${OPT_SP}|#${OPT_SP})[A-Za-z0-9][A-Za-z0-9\\-]{0,5}(?![\\p{L}\\p{N}])`;
/** `Hard Drive`, `Google Drive`: a drive that is not a street. */
const NOT_A_DRIVE = String.raw`(?<!(?:Hard|Google|Flash|Thumb|USB|Test|Disk|External|Shared|Team)[ \t]{1,3})`;
const EN_SUFFIX = `(?:${EN_SUFFIXES.filter((s) => s !== 'Drive').map(ci).sort((a, b) => b.length - a.length).join('|')}|${NOT_A_DRIVE}${ci('Drive')})`;
const DIRECTION = `(?:${[...DIRECTIONS].sort((a, b) => b.length - a.length).join('|')})\\.?`;
const STREET_WORD = String.raw`(?:${WORD}|\d{1,3}(?:st|nd|rd|th))`;

/**
 * An English street line: a house number, one to four words and a suffix, maybe
 * a direction and a unit (`4417 Larkspur Hollow Rd Apt 2B`, `Flat 3, 12 Quillon Road`).
 * The number is not part of an amount, a decimal or a version (`$47.88`, `2.3`).
 */
const EN_STREET = String.raw`(?<![\p{L}\p{N}.,$€£¥%/])(?:${UNIT},?${SP})?\d{1,6}[A-Za-z]?(?:[-/]\d{1,4}[A-Za-z]?)?${SP}(?:${DIRECTION}${SP})?(?:${STREET_WORD}${SP}){1,4}${EN_SUFFIX}\.?(?:${SP}${DIRECTION})?(?![\p{L}\p{N}])(?:,?${SP}${UNIT})?`;

const ES_FLOOR = String.raw`(?:\d{1,2}[º°ªo]|${ci('planta')}${SP}\d{1,2}|${ci('bajo')}|${ci('entlo')}\.?)(?:${OPT_SP}-?${OPT_SP}[A-Za-z](?![\p{L}\p{N}])|${SP}(?:${ci('izqda')}|${ci('izq')}|${ci('dcha')}|${ci('dch')})\.?)?`;
/**
 * A Spanish street line: a street type, its name, maybe `nº`, the number, and maybe a
 * floor and door (`Calle de los Tilos Altos 14, 3º B`, `C/ Mayor 3`, `calle del Olmo, 14`).
 */
const ES_STREET = String.raw`(?<![\p{L}\p{N}])(?:${anyOf(ES_TYPES)}\.?${SP}|C\/${OPT_SP})(?:${PART}${SP}|d['’])*${WORD}(?:${SP}(?:${PART}${SP})*${WORD}){0,4}(?:${OPT_SP},)?${OPT_SP}(?:${ci('nº')}\.?${OPT_SP}|${ci('no')}\.${OPT_SP})?\d{1,4}[A-Za-z]?(?![\p{L}\p{N}])(?:${OPT_SP},?${OPT_SP}${ES_FLOOR})?`;

/** A box number in place of a street. */
const BOX = String.raw`(?:P\.?[ \t]?O\.?${SP}${ci('Box')}|${ci('Apartado')}(?:${SP}${ci('de')}${SP}${ci('correos')})?)${SP}\d{1,6}(?![\p{L}\p{N}])`;

const STREET_RE = new RegExp(`${EN_STREET}|${ES_STREET}|(?<![\\p{L}\\p{N}])${BOX}`, 'gu');

/** What may follow a street on its line, one piece at a time, each from where the last ended. */
const LOCALITY_PIECES: RegExp[] = [
  // Brookhaven, OR 97399 / Ottawa, ON K1A 0B9
  new RegExp(`${TOWN},?${SP}${REGION}${SP}(?:${US_ZIP}|${CA_POST})(?![\\p{L}\\p{N}])`, 'uy'),
  // Ashcombe Vale ZZ1 4QX
  new RegExp(`${TOWN},?${SP}${UK_POST}(?![\\p{L}\\p{N}])`, 'uy'),
  // 52990 Torrebruna
  new RegExp(`\\d{5}${SP}${TOWN}`, 'uy'),
  // OR 97399, ZZ1 4QX, 97399 on their own
  new RegExp(`(?:${REGION}${SP})?${POSTAL}(?![\\p{L}\\p{N}])`, 'uy'),
];
/** A town alone, as a comma piece. */
const TOWN_PIECE = new RegExp(`${TOWN}(?=${OPT_SP}(?:[,;.!?)]|\r?$))`, 'muy');
const PIECE_GAP = /,[ \t]{0,3}|[ \t]{1,3}/y;

/** The end of the locality pieces after `at`, the end of a street, on the same line. A town alone needs a comma before it. */
function localityEnd(text: string, at: number): number {
  let end = at;
  for (let pieces = 0; pieces < 4; pieces++) {
    PIECE_GAP.lastIndex = end;
    const gap = PIECE_GAP.exec(text);
    if (!gap) break;
    const from = end + gap[0].length;
    let next = -1;
    for (const re of LOCALITY_PIECES) {
      re.lastIndex = from;
      const m = re.exec(text);
      if (m) {
        next = from + m[0].length;
        break;
      }
    }
    if (next < 0 && gap[0].startsWith(',')) {
      TOWN_PIECE.lastIndex = from;
      const m = TOWN_PIECE.exec(text);
      if (m && !COUNTRY_RE.test(m[0])) next = from + m[0].length;
    }
    if (next < 0) break;
    end = next;
  }
  return end;
}

const LOCALITY_LINE = new RegExp(`^(?:${LOCALITY_PIECES.map((r) => r.source).join('|')})$`, 'u');
const UNIT_LINE = new RegExp(`^(?:${UNIT}|${BOX})$`, 'u');
const TOWN_LINE = new RegExp(`^${TOWN}$`, 'u');
const NAME_THEN_COMMA = new RegExp(`^(${TOWN}),${OPT_SP}`, 'u');

/** The label of an address block, with the rest of its line after it. */
const LABEL_RE = new RegExp(
  String.raw`^(?:${anyOf(['shipping', 'billing', 'delivery', 'mailing', 'postal', 'home', 'business', 'return', 'pickup', 'service', 'invoice'])}${SP}${ci('address')}|` +
    `${anyOf(['ship', 'bill', 'deliver', 'sold', 'send', 'mail', 'invoice'])}${SP}${ci('to')}|${ci('address')}|` +
    `${ci('dirección')}(?:${SP}${ci('de')}${SP}${anyOf(['envío', 'envio', 'entrega', 'facturación', 'facturacion', 'correo'])})?|${ci('direccion')}|` +
    `${ci('domicilio')}(?:${SP}${anyOf(['fiscal', 'social'])})?|${anyOf(['enviar', 'entregar'])}${SP}${ci('a')})${OPT_SP}:?${OPT_SP}`,
  'u',
);
/** A line in a block that says who it goes to: `c/o Jordan Pemberton`, `Attn: Odalys Brenwick`, `A/A Odalys Brenwick`. */
const CARE_OF = new RegExp(`^(?:${ci('c/o')}|${ci('attn')}\\.?|${ci('attention')}|${ci('a/a')})${OPT_SP}:?${OPT_SP}`, 'u');
/** How many short lines above the street a block passes over, and how many words such a line has at most. */
const NOTES_ABOVE = 2;
/**
 * Whether the first or last word of `line` holds a digit. Each word is tested once:
 * a pattern anchored at the end (`\\d\\S*$`) restarts at every digit of a long run.
 */
function digitEdge(line: string): boolean {
  const words = line.split(/\s/u);
  return /\d/u.test(words[0] as string) || /\d/u.test(words[words.length - 1] as string);
}
const NOTE_WORDS = 6;
/** A line that starts another field (`Transaction ID:`, `Phone:`), which ends a block. */
const FIELD_LINE = /^[\p{L}][\p{L}\p{M} .'’#]{0,30}:/u;
const POSTAL_LABEL_RE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:${ci('post')}${OPT_SP}${ci('code')}|${ci('postal')}${SP}${ci('code')}|${ci('zip')}(?:${OPT_SP}${ci('code')})?|${ci('código')}${SP}${ci('postal')}|${ci('codigo')}${SP}${ci('postal')}|C\.P\.)${OPT_SP}[:.]?${OPT_SP}(?<v>${POSTAL})(?![\p{L}\p{N}])`,
  'gdu',
);

export interface AddressSpans {
  /** Street lines, localities and postal codes, end exclusive. */
  places: Array<[number, number]>;
  /** The line of a labelled block above its street: a person or company the caller's detector context decides. */
  recipients: Array<[number, number]>;
}

interface Line {
  start: number;
  content: string;
  at: number;
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let start = 0;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const lead = /^[ \t>]*/.exec(line)?.[0].length ?? 0;
    out.push({ start, content: line.slice(lead).trimEnd(), at: start + lead });
    start += raw.length + 1;
  }
  return out;
}

/**
 * A line's content without the punctuation that ends it. A backward scan, not
 * `/[.,;]+$/`, which rereads a long run of commas from each of its positions.
 */
const bare = (c: string): string => {
  let end = c.length;
  while (end > 0 && '.,;'.includes(c.charAt(end - 1))) end--;
  return c.slice(0, end);
};

/** Where in `content`, a whole line, a street with its locality runs to the end, else -1. */
function streetLine(content: string): number {
  STREET_RE.lastIndex = 0;
  const m = STREET_RE.exec(content);
  if (!m || m.index !== 0) return -1;
  const end = localityEnd(content, m[0].length);
  return bare(content).length <= end ? bare(content).length : -1;
}

/** The addresses in `text`. Places never overlap one another. */
export function detectAddresses(text: string): AddressSpans {
  const places: Array<[number, number]> = [];
  const recipients: Array<[number, number]> = [];
  const held = new Uint8Array(text.length);
  const add = (s: number, e: number): void => {
    // One character (a lone `3` under a label) is no address, and a later turn could not carry it: `known` refuses it.
    if (e - s < 2) return;
    for (let i = s; i < e; i++) if (held[i]) return;
    held.fill(1, s, e);
    places.push([s, e]);
  };
  const all = lines(text);

  // Labelled blocks: the label, then its lines up to a blank line or another field.
  all.forEach((line, i) => {
    const label = LABEL_RE.exec(line.content);
    if (!label) return;
    const block: Line[] = [];
    const rest = line.content.slice(label[0].length);
    // Text after the label needs a colon between them (`Ship to: ...`), or `Address Book` would be a block.
    if (rest !== '' && !label[0].includes(':')) return;
    if (rest !== '') block.push({ start: line.start, content: rest, at: line.at + label[0].length });
    // No line limit: the block ends at a blank line, another field or label, or below at the first line that is not
    // part of an address. Each line is read by the block of the label above it only, so the work stays linear.
    for (let j = i + 1; j < all.length; j++) {
      const next = all[j] as Line;
      if (next.content === '' || (FIELD_LINE.test(next.content) && !CARE_OF.test(next.content)) || LABEL_RE.test(next.content)) break;
      block.push(next);
    }
    let street = false;
    let notes = 0;
    for (const l of block) {
      const c = bare(l.content);
      if (COUNTRY_RE.test(c)) continue;
      // A care-of line names who the block goes to, and the block goes on below it.
      const care = CARE_OF.exec(c);
      if (care) {
        const name = c.slice(care[0].length);
        if (TOWN_LINE.test(name)) recipients.push([l.at + care[0].length, l.at + c.length]);
        continue;
      }
      const end = streetLine(l.content);
      if (end > 0 || LOCALITY_LINE.test(c) || UNIT_LINE.test(c) || (street && TOWN_LINE.test(c))) {
        add(l.at, l.at + (end > 0 ? end : c.length));
        street = true;
        continue;
      }
      // A label line with the address after it, maybe after the name and a comma
      // (`Ship to: Jordan Pemberton, 4417 ...`): the street and its locality, nothing after them.
      const named = street ? null : NAME_THEN_COMMA.exec(l.content);
      const from = named ? named[0].length : 0;
      STREET_RE.lastIndex = from;
      const inline = STREET_RE.exec(l.content);
      if (inline && inline.index === from) {
        if (named) recipients.push([l.at, l.at + (named[1] as string).length]);
        const end = localityEnd(l.content, from + inline[0].length);
        add(l.at + from, l.at + end);
        street = true;
        // An address that ends its line goes on below (`Ship to: ..., 4417 Larkspur Hollow Rd` then the locality);
        // text after it on the line (`... Cabo Redondo. Teléfono ...`) ends the block.
        if (end >= c.length) continue;
        break;
      }
      if (!street && !/\d/u.test(c) && TOWN_LINE.test(c)) {
        recipients.push([l.at, l.at + c.length]);
        continue;
      }
      // Any other line that starts or ends with a number is the address in a layout or case the patterns do not
      // read (`4417 larkspur hollow rd`, `brookhaven, OR 97399`), not a sentence with a number inside it.
      if (digitEdge(c)) {
        add(l.at, l.at + c.length);
        street = true;
        continue;
      }
      // A short note above the street (`delivery instructions`, `Leave at the door`) is passed over. A longer one, a
      // third, or any line this does not read below the street ends the block, so a sentence after the address
      // with a number in it (`Your order ships in 3 days`) is not taken as part of it.
      if (!street && notes < NOTES_ABOVE && c.split(/\s+/u).length <= NOTE_WORDS) {
        notes++;
        continue;
      }
      break;
    }
  });

  // Street lines anywhere, with the locality after them on their line and the lines below.
  STREET_RE.lastIndex = 0;
  // Matches come in text order, so the line after each one is found by moving forward, and where each
  // line's text ends is worked out once: a long line of streets costs its length, not its length squared.
  const ends = all.map((l) => l.at + bare(l.content).length);
  let k = 0;
  for (const m of text.matchAll(STREET_RE)) {
    const end = localityEnd(text, m.index + m[0].length);
    add(m.index, end);
    while (k < all.length && (all[k] as Line).start <= end) k++;
    // Only a street that ends its line has a locality on the lines below.
    if (k === 0 || k >= all.length || end < (ends[k - 1] as number)) continue;
    for (let j = k; j < Math.min(all.length, k + 3); j++) {
      const c = bare((all[j] as Line).content);
      if (COUNTRY_RE.test(c)) break;
      const town = TOWN_LINE.test(c) && LOCALITY_LINE.test(bare((all[j + 1] as Line | undefined)?.content ?? ''));
      if (!LOCALITY_LINE.test(c) && !UNIT_LINE.test(c) && !town) break;
      add((all[j] as Line).at, (all[j] as Line).at + c.length);
    }
  }

  // A postal code after its label: `Postcode: ZZ1 4QX`.
  for (const m of text.matchAll(POSTAL_LABEL_RE)) {
    const [s, e] = m.indices!.groups!.v as [number, number];
    add(s, e);
  }
  places.sort((a, b) => a[0] - b[0]);
  return { places, recipients };
}

const KEEP_WORDS: ReadonlySet<string> = new Set(
  [...EN_SUFFIXES, ...DIRECTIONS, ...UNIT_WORDS, ...ES_TYPES, ...ES_PARTS, 'box', 'po', 'p', 'o', 'c', 'apartado', 'correos', 'nº', 'no', 'planta', 'bajo', 'entlo', 'izq', 'izqda', 'dcha', 'dch']
    .map((w) => w.toLowerCase()),
);

/** One piece of an address value, for its fake: kept as written, a run of name words, or letters and digits drawn again. */
export type AddressPiece = { kind: 'keep' | 'name' | 'code'; text: string };

/**
 * `value` split for a fake of the same shape. Separators, street suffixes,
 * unit words, street types, particles and region codes are kept. A run of any
 * other words (`Larkspur Hollow`, `Brookhaven`, `larkspur hollow`) is one name.
 * A token with a digit, or a single capital letter (a door), is a code.
 */
export function addressPieces(value: string): AddressPiece[] {
  const out: AddressPiece[] = [];
  const push = (kind: AddressPiece['kind'], text: string): void => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && kind !== 'code') last.text += text;
    else out.push({ kind, text });
  };
  const tokens = value.match(/[\p{L}\p{M}\p{N}'’º°ª]+|[^\p{L}\p{M}\p{N}'’º°ª]+/gu) ?? [];
  tokens.forEach((t, i) => {
    if (!/[\p{L}\p{N}]/u.test(t)) {
      // A space between two name words stays inside the name.
      const prev = out[out.length - 1];
      const next = tokens[i + 1] ?? '';
      if (prev?.kind === 'name' && /^[ \t]+$/u.test(t) && pieceKind(next) === 'name') prev.text += t;
      else push('keep', t);
      return;
    }
    const kind = pieceKind(t);
    if (kind === 'code') out.push({ kind, text: t });
    else push(kind, t);
  });
  return out;
}

function pieceKind(t: string): AddressPiece['kind'] {
  if (/\d/u.test(t) || /^\p{Lu}$/u.test(t)) return /^\p{L}$/u.test(t) && KEEP_WORDS.has(t.toLowerCase()) ? 'keep' : 'code';
  if (KEEP_WORDS.has(t.toLowerCase()) || REGION_CODES.has(t)) return 'keep';
  return 'name';
}
