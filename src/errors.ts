import type { LeakHit, LeakReport, UnenforcedKnown } from './types.js';

/** What a `BlindError` is about. */
export type BlindErrorKind =
  | 'detector-not-prepared'
  | 'input-too-large'
  | 'internal'
  | 'invalid-known'
  | 'invalid-mapping'
  | 'invalid-option'
  | 'leak'
  | 'no-free-fake'
  | 'stream-closed';

// Every kind, so a kind read off a caller's error is checked against the list, never quoted.
const ERROR_KINDS: Record<BlindErrorKind, true> = {
  'detector-not-prepared': true, 'input-too-large': true, internal: true, 'invalid-known': true,
  'invalid-mapping': true, 'invalid-option': true, leak: true, 'no-free-fake': true, 'stream-closed': true,
};

/** Whether `kind` is one of blind's own error kinds. */
export const isBlindErrorKind = (kind: unknown): kind is BlindErrorKind => typeof kind === 'string' && Object.hasOwn(ERROR_KINDS, kind);

/**
 * An error blind throws itself. Its message names a field, a kind or an index,
 * never a value. `guard` lets these through by class, not by message, so an
 * error from elsewhere that happens to start with `blind: ` is still wrapped.
 */
export class BlindError extends Error {
  constructor(readonly kind: BlindErrorKind, message: string) {
    super(message);
    this.name = 'BlindError';
  }
}

/**
 * Runs `fn`. An error that is not one of blind's own (a `BlindError`) becomes
 * one that names `stage` and nothing else: an engine or detector error can
 * quote the text it was working on, so its message, stack and cause are all
 * dropped. blind's own errors are told apart by class, never by message.
 */
export function guard<T>(who: 'blind' | 'unblind', stage: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BlindError) throw e;
    throw new BlindError('internal', `${who}: internal error while ${stage}`);
  }
}

// ---------------------------------------------------------------- text limit

/** The default `maxTextLength`: 1 MiB of UTF-16 code units. */
export const MAX_TEXT_LENGTH = 1_048_576;

/** Throws when `limit`, a caller's `maxTextLength`, is not a positive number. */
export function checkLimit(who: 'blind' | 'unblind', limit: number): void {
  if (typeof limit !== 'number' || Number.isNaN(limit) || limit <= 0) throw new BlindError('invalid-option', `${who}: maxTextLength must be a positive number`);
}

/** A text longer than `maxTextLength`. It carries the text's index and length, never its content. */
export class InputTooLargeError extends BlindError {
  declare readonly kind: 'input-too-large';
  constructor(readonly textIndex: number, readonly length: number, readonly limit: number, who: 'blind' | 'unblind' = 'blind') {
    super('input-too-large', `${who}: input-too-large (text ${textIndex} is ${length} UTF-16 units, the limit is ${limit})`);
    this.name = 'InputTooLargeError';
  }
}

// ---------------------------------------------------------------------- leaks

/** The kinds a hit can carry. A report built by hand may hold any string, which never reaches a message. */
const HIT_KINDS: Record<LeakHit['kind'], true> = {
  person: true, org: true, email: true, domain: true, phone: true, place: true, id: true, url: true, iban: true, amount: true, date: true, deny: true,
};

const kindOf = (k: unknown): string => (typeof k === 'string' && Object.hasOwn(HIT_KINDS, k) ? k : 'other');

/** A leak report as `blind` returns it, or one built by hand before `unenforced` existed. */
export type LeakReportInput = Omit<LeakReport, 'unenforced'> & { unenforced?: UnenforcedKnown[] };

export class LeakError extends BlindError {
  constructor(readonly report: LeakReportInput) {
    const kinds = [...new Set(report.hits.map((h) => kindOf(h.kind)))].join(', ');
    const texts = [...new Set(report.hits.map((h) => (Number.isInteger(h.textIndex) ? h.textIndex : '?')))].join(', ');
    // A report built by hand may lack the list or hold anything in it: only integer indices and the library's kinds reach the message.
    const list = Array.isArray(report.unenforced) ? report.unenforced : [];
    const name = (u: UnenforcedKnown | undefined): string => `${Number.isInteger(u?.index) ? u?.index : '?'} (${kindOf(u?.kind)})`;
    const hangul = list.filter((u) => u?.reason === 'hangul-inside-word').map(name);
    const parts = list.filter((u) => u?.reason !== 'hangul-inside-word').map(name);
    const oneLetter = list.some((u) => u?.reason === 'one-letter-part');
    const note = (parts.length ? `; known entries with a ${oneLetter ? 'stop-word or one-letter' : 'stop-word'} part enforced only as written or in capitals: ${parts.join(', ')}` : '')
      + (hangul.length ? `; two-syllable Korean known entries enforced only where a word starts: ${hangul.join(', ')}` : '');
    super('leak', `blind: ${report.hits.length} leak(s) in text ${texts} (kinds: ${kinds})${note}`);
    this.name = 'LeakError';
  }
}
