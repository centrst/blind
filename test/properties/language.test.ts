import { describe, it } from 'vitest';
import { LONG, numRuns, p6DifferentSeeds, p6Determinism, p18LanguageFollows, p19Gender, p20MobileShape, seedOf } from '../support/properties.js';

describe(`properties: language and seeds (${numRuns()} cases, seed ${seedOf()})`, () => {
  it('C6/P6: same seed and input give the same output', () => p6Determinism(), LONG);
  it('C6/P6: different seeds change the surrogates', () => p6DifferentSeeds(), LONG);
  it('C31/P18: names, companies, places and hosts in English text get English fakes, in Spanish text Spanish ones, and each part of a two-language thread its own', () => p18LanguageFollows(), LONG);
  it('C31/P19: a woman\'s or man\'s English or Spanish first name gets a fake of the same gender and language, names not ending in "a" included', () => p19Gender(), LONG);
  it('C31/P20: a UK, Spanish or North American mobile stays a mobile of its country in the same layout, and round trips', () => p20MobileShape(), LONG);
});
