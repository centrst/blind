export type Kind =
  | 'person'
  | 'org'
  | 'email'
  | 'domain'
  | 'phone'
  | 'place'
  | 'id'
  | 'url'
  | 'iban'
  | 'amount'
  | 'date';

export type KnownKind = 'person' | 'org' | 'email' | 'domain' | 'phone' | 'place' | 'id';

export interface KnownValue {
  kind: KnownKind;
  value: string;
}

export type DateOrder = 'dmy' | 'mdy';

/**
 * What a value blind finds becomes. `fake` (the default) keeps its kind and
 * shape, scales amounts and shifts dates. `placeholder` writes
 * `[REDACTED_PERSON_1]` and the like. `random` writes an unrelated random value
 * of the same kind, with nothing kept but the kind.
 */
export type ReplaceWith = 'fake' | 'placeholder' | 'random';

/** A detected region of a text. Offsets are UTF-16 code units, end exclusive. */
export interface Span {
  start: number;
  end: number;
  kind: Kind;
  /** Higher wins when spans overlap. Defaults to 70. */
  priority?: number;
  /** Detector-private payload. Ignored for kinds the engine does not know. */
  meta?: unknown;
}

export interface DetectContext {
  dateOrder: DateOrder;
  /** True for hosts that must stay untouched (public platforms). */
  isAllowedHost(host: string): boolean;
  /** The caller's known values, so a detector can keep its spans clear of them. */
  known?: KnownValue[];
}

/**
 * A pluggable detector. Built-ins are deterministic patterns. A NER detector
 * (Presidio, a local model) can return `person`, `org` and `place` spans and
 * the engine does the rest. Detectors must not make network calls.
 */
export interface Detector {
  name: string;
  detect(text: string, ctx: DetectContext): Span[];
}

export interface Pair {
  kind: Kind;
  real: string;
  fake: string;
}

/** Opaque, JSON-serializable. Keep it local, never send it to the lab. */
export interface Mapping {
  version: 1;
  seed: string;
  /** How values were replaced. A mapping without it was made with `fake`. */
  replaceWith?: ReplaceWith;
  /** Amount scale. 1 with `placeholder` and `random`, which scale nothing. */
  factor: number;
  /** Date shift in days. 0 with `placeholder` and `random`, which shift nothing. */
  dayShift: number;
  dateOrder: DateOrder;
  refYear: number;
  pairs: Pair[];
  /**
   * `placeholder` only: placeholders that were already written in an input
   * text, upper case. Their numbers are never given to a value, in this turn
   * or a later one. Left out when there are none.
   */
  literals?: string[];
}

export interface LeakHit {
  kind: Kind | 'deny';
  textIndex: number;
  /** Offset in the blind text. The value itself is never reported. */
  offset: number;
}

/**
 * A `known` entry the matcher enforces only in part: a part on the stop list,
 * a one-letter part, or the whole value, counts only as written or in capitals, so a lower-case
 * copy can stay in the blind text without a hit, or a two-syllable Korean value counts only
 * where a word starts, so a copy inside a longer word can stay without a hit. Listed once
 * per entry, whether or not the text writes that copy. The value itself is never reported.
 */
export interface UnenforcedKnown {
  kind: KnownKind;
  /** Index of the entry in `options.known`. */
  index: number;
  /**
   * `stop-word`: the value is made only of stop words or particles (`Al`, `De La`) and
   * counts only as written or in capitals. `stop-word-part`: a full name writes a part on
   * the stop list capitalised (`Al` of `Al Brenner`), and that part found bare counts only
   * as written or in capitals, or for a two-letter part also in lower case where the
   * language of the text there does not write it as a word. `one-letter-part`: a full name
   * has a part of one capital letter (`O` of `O Li`, `J.` of `J. Orvane`), which gets a fake
   * inside the name and found bare counts only as written or in capitals, so `o` and `y`
   * stay ordinary words. `hangul-inside-word`: the value starts in Hangul and has two
   * syllables (`지원`), so it counts only where a word starts, with anything glued on after
   * it (`지원님`), never inside a longer word (`우리팀지원님`), where two syllables are often
   * an ordinary part of that word.
   */
  reason: 'stop-word' | 'stop-word-part' | 'one-letter-part' | 'hangul-inside-word';
}

export interface LeakReport {
  /** True when nothing survived. `unenforced` never makes it false. */
  ok: boolean;
  hits: LeakHit[];
  /** The `known` entries the check enforces only in part (as written or in capitals, or a two-syllable Korean value only at a word start): see `UnenforcedKnown`. Empty when every entry is enforced everywhere in any case. */
  unenforced: UnenforcedKnown[];
}

export interface BlindOptions {
  known?: KnownValue[];
  /** Plain strings or `*@domain`. Case-insensitive. Checked after rewriting. */
  deny?: string[];
  /** Same seed and input give the same output. Omitted means a random seed. */
  seed?: string;
  /** Only used to pick a year for dates written without one. */
  now?: Date;
  /** Order for `07/04/2026` style dates. Default `dmy`. */
  dateOrder?: DateOrder;
  /** Extra public domains to leave untouched. */
  allowDomains?: string[];
  /** Extra detectors, for example NER. Run alongside the built-ins. */
  detectors?: Detector[];
  /**
   * What each value found becomes: `fake` (default), `placeholder` or `random`.
   * With a `mapping` the mode comes from it, and a different value here throws.
   */
  replaceWith?: ReplaceWith;
  /**
   * The mapping of an earlier call, for the next turn of a conversation. Every
   * value seen before keeps its fake, amounts keep the same factor and dates
   * the same shift, and values from earlier turns are looked for in the new
   * text even when nothing else would find them. The seed, date order and
   * `replaceWith` come from this mapping. The result holds a new mapping with
   * every pair so far.
   */
  mapping?: Mapping;
  /**
   * The longest text accepted, in UTF-16 code units (`text.length`). Default
   * 1,048,576. A longer text throws an `input-too-large` error that names the
   * text's index and length, never its content. `Infinity` turns the check off.
   */
  maxTextLength?: number;
}

/** Related placeholders, with no original values. Each token still restores its own spelling. */
export interface PersonIdentity {
  names: string[];
  emails: string[];
}

export interface BlindResult {
  texts: string[];
  /**
   * A legend for this call's placeholder texts. Each group links name forms
   * and explicitly associated addresses. Send it beside the texts when the
   * reader needs these relationships. Empty in fake and random modes.
   * This is conservative inference from known/detected names, not verified identity.
   */
  identities: PersonIdentity[];
  mapping: Mapping;
  leaks: LeakReport;
  /** How many spans of each kind this call replaced, every occurrence counted. Earlier turns are not included. */
  replaced: Partial<Record<Kind, number>>;
  /**
   * Pairs of the new mapping that share a fake with an earlier pair, as `unblind` reports them, and in
   * `placeholder` mode pairs whose placeholder is also written as a literal in an input text. Empty when every value round trips.
   */
  collisions: Collision[];
}

/** A mapping pair whose fake an earlier pair with another real value holds. The value itself is never reported. */
export interface Collision {
  kind: Kind;
  /** Index of the pair in `mapping.pairs`. */
  index: number;
}

export interface UnblindOptions {
  /**
   * The longest answer accepted, in UTF-16 code units (`text.length`). Default
   * 1,048,576, as for `blind`. For a stream it counts every chunk pushed. A
   * longer answer throws an `input-too-large` error that names its length and
   * the limit, never its content. `Infinity` turns the check off.
   */
  maxTextLength?: number;
}

export interface UnblindResult {
  text: string;
  invented: string[];
  /** Pairs that cannot come back as written because an earlier pair holds their fake. Empty when every value round trips. */
  collisions: Collision[];
}
