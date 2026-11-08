import { describe, it } from 'vitest';
import { LONG, numRuns, p12Placeholders, p15OtherModesLeakCheck, seedOf } from '../support/properties.js';

describe(`properties: placeholder and random modes (${numRuns()} cases, seed ${seedOf()})`, () => {
  it('C26/P12: placeholders are [REDACTED_<KIND>_<n>], numbered per kind in order of first appearance, one per value across every text of a call', () => p12Placeholders(), LONG);
  it('C30/P15: in placeholder and random mode no found or known value survives, the leak check is clean, and a deny entry left in is reported', () => p15OtherModesLeakCheck(), LONG);
});
