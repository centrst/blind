import { describe, it } from 'vitest';
import { LONG, numRuns, p2NoSurvivors, p4Relations, p5Dates, p7Shape, p8LeakCheckClean, seedOf } from '../support/properties.js';

describe(`properties: nothing survives, amounts and dates (${numRuns()} cases, seed ${seedOf()})`, () => {
  it('C2/P2: no inserted value survives in the blind text', () => p2NoSurvivors(), LONG);
  it('C4/P4: amount relations (surcharge, percentage, sum, chain) hold to the cent after scaling', () => p4Relations(), LONG);
  it('C5/P5: every date moves by the same nonzero whole number of weeks', () => p5Dates(), LONG);
  it('C2/P7: surrogates keep the shape of the original', () => p7Shape(), LONG);
  it('C2/P8: the leak check is clean on every generated case', () => p8LeakCheckClean(), LONG);
});
