import { describe, it } from 'vitest';
import { LONG, numRuns, p10Conversation, p11Streaming, seedOf } from '../support/properties.js';

describe(`properties: conversations and streaming (${numRuns()} cases, seed ${seedOf()})`, () => {
  it('C21/P10: a conversation keeps every fake, the factor and the shift across turns, finds earlier values bare, and round trips', () => p10Conversation(), LONG);
  it('C22/P11: streamed unblind, in any chunking, joins to exactly the one-shot result and reports the same invented values', () => p11Streaming(), LONG);
});
