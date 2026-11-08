import { describe, it } from 'vitest';
import { LONG, numRuns, p13OtherModesRoundTrip, p14OtherModesConversation, seedOf } from '../support/properties.js';

describe(`properties: placeholder and random round trips and conversations (${numRuns()} cases, seed ${seedOf()})`, () => {
  it('C27/P13: placeholder and random output round trip, one-shot and streamed in any chunking, with the same invented values', () => p13OtherModesRoundTrip(), LONG);
  it('C29/P14: a placeholder or random conversation keeps its mode, every pair and one fake per value across turns, and round trips', () => p14OtherModesConversation(), LONG);
});
