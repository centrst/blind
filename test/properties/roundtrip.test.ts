import fc from 'fast-check';
import { describe, it } from 'vitest';
import { blind, BlindError, unblind, type KnownKind, type KnownValue } from '../../src/index.js';
import { check, LONG, numRuns, p1RoundTrip, p3KnownAndDeny, p9TypedIds, p16AmountsApart, p17Spellings, quotes, seedOf } from '../support/properties.js';

describe(`properties: round trip, known and deny (${numRuns()} cases, seed ${seedOf()})`, () => {
  it('C1/P1: unblind(blind(x)) returns x for every text in a multi-text call', () => p1RoundTrip(), LONG);
  it('C3/P3: known and deny entries are absent in any letter case, or the leak check reports them', () => p3KnownAndDeny(), LONG);
  it('C20/P9: typed ids get fakes that pass the same check, keep their prefix and layout, and round trip', () => p9TypedIds(), LONG);
  it('C1/P16: amounts that differ get different fakes, so amounts one unit apart round trip, and every fake stays near the factor', () => p16AmountsApart(), LONG);
  it('C1/P17: a value in another letter case, without its accents or with look-alike letters, a name glued to full-width digits, a phone with an extension and one date and one amount in several spellings round trip in every mode', () => p17Spellings(), LONG);
  it('C42: over any Unicode text, known values and deny entries, with no detector, a detector that throws the text after a blind: prefix, or one that throws a BlindError carrying the text, no thrown message holds an 8-character slice of the input', () => c42ErrorsQuoteNothing());
});

function c42ErrorsQuoteNothing(): void {
  const text = fc.string({ unit: 'binary', maxLength: 200 });
  const kinds: readonly string[] = ['person', 'org', 'email', 'domain', 'phone', 'place', 'id'] satisfies KnownKind[];
  // Mostly the library's kinds, and any string beside them, which must be refused before detection runs.
  const kind = fc.oneof({ arbitrary: fc.constantFrom(...kinds), weight: 3 }, { arbitrary: fc.string({ unit: 'binary', maxLength: 20 }), weight: 1 });
  const known = fc.array(fc.record({ kind, value: fc.string({ unit: 'binary', maxLength: 40 }) }), { maxLength: 3 });
  const deny = fc.array(fc.string({ unit: 'binary', maxLength: 40 }), { maxLength: 3 });
  const forgers = [
    { name: 'forger', detect: (t: string): never => { throw new Error(`blind: ${t}`); } },
    { name: 'own-forger', detect: (t: string): never => { throw new BlindError('internal', t); } },
  ];
  check(
    fc.property(fc.array(text, { minLength: 1, maxLength: 3 }), known, deny, fc.constantFrom(-1, 0, 1), (texts, k, d, forge) => {
      const inputs = [...texts, ...k.map((x) => x.value), ...d];
      const foreign = k.some((x) => !kinds.includes(x.kind));
      let r;
      try {
        r = blind(texts, { seed: 'c42', known: k as KnownValue[], deny: d, detectors: forge >= 0 ? [forgers[forge]!] : undefined });
      } catch (e) {
        if (foreign && !(e instanceof BlindError && e.kind === 'invalid-known')) return false;
        return !quotes(String((e as Error)?.message), inputs);
      }
      if (foreign) return false;
      try {
        r.texts.forEach((t) => unblind(t, r.mapping));
      } catch (e) {
        return !quotes(String((e as Error)?.message), inputs);
      }
      return true;
    }),
    { numRuns: Math.min(numRuns(), 300) },
  );
}
