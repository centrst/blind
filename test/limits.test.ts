import { describe, expect, it } from 'vitest';
import { InputTooLargeError, MAX_TEXT_LENGTH } from '../src/errors.js';
import { blind, createUnblinder, unblind } from '../src/index.js';

/** The error `fn` throws, or a failure when it throws nothing. */
function thrown(fn: () => unknown): InputTooLargeError {
  try {
    fn();
  } catch (e) {
    return e as InputTooLargeError;
  }
  throw new Error('expected a throw');
}

describe('input size limit', () => {
  const secret = 'Ana Quintela <ana.quintela@harbor-mill.example>';

  it('C32: a text past the default limit throws input-too-large with its index and length, never its content', () => {
    const big = `${secret}\n`.repeat(Math.ceil((MAX_TEXT_LENGTH + 1) / (secret.length + 1)));
    const e = thrown(() => blind(['Hola', big], { seed: 's' }));
    expect(e).toBeInstanceOf(InputTooLargeError);
    expect(e.kind).toBe('input-too-large');
    expect(e.textIndex).toBe(1);
    expect(e.length).toBe(big.length);
    expect(e.limit).toBe(1_048_576);
    expect(e.message).toContain('input-too-large');
    expect(e.message).toContain('text 1');
    expect(e.message).toContain(String(big.length));
    for (const part of ['Ana', 'Quintela', 'harbor-mill']) {
      expect(e.message).not.toContain(part);
      expect(JSON.stringify(e)).not.toContain(part);
    }
  });

  it('C32: maxTextLength overrides the limit, and a text exactly at it is accepted', () => {
    const text = `Dear ${secret}`;
    expect(blind([text], { seed: 's', maxTextLength: text.length }).texts[0]).not.toContain('Quintela');
    const e = thrown(() => blind([text], { seed: 's', maxTextLength: text.length - 1 }));
    expect(e.kind).toBe('input-too-large');
    expect([e.textIndex, e.length, e.limit]).toEqual([0, text.length, text.length - 1]);
    expect(e.message).not.toContain('Quintela');
  });

  it('C32: maxTextLength Infinity turns the check off, and a limit that is not a positive number is refused', () => {
    expect(blind(['Hola'], { seed: 's', maxTextLength: Infinity }).texts).toEqual(['Hola']);
    for (const bad of [0, -1, Number.NaN, '10' as unknown as number]) {
      expect(() => blind(['Hola'], { seed: 's', maxTextLength: bad })).toThrow('maxTextLength must be a positive number');
    }
  });
});

describe('answer size limit', () => {
  const secret = 'Ana Quintela <ana.quintela@harbor-mill.example>';
  const { texts, mapping } = blind([`Dear ${secret}`], { seed: 'u' });
  const fake = texts[0] as string;
  /** Fails when `e` quotes the real or the fake value. */
  const quotesNothing = (e: InputTooLargeError): void => {
    for (const part of ['Ana', 'Quintela', 'harbor-mill', ...fake.split(/[\s<>@.]+/).filter((w) => w.length > 3)]) {
      expect(e.message).not.toContain(part);
      expect(JSON.stringify(e)).not.toContain(part);
    }
  };

  it('C32: unblind refuses an answer past the default limit with index 0 and the sizes, never its content', () => {
    const big = `${fake}\n`.repeat(Math.ceil((MAX_TEXT_LENGTH + 1) / (fake.length + 1)));
    const e = thrown(() => unblind(big, mapping));
    expect(e).toBeInstanceOf(InputTooLargeError);
    expect(e.kind).toBe('input-too-large');
    expect([e.textIndex, e.length, e.limit]).toEqual([0, big.length, 1_048_576]);
    expect(e.message).toMatch(/^unblind: input-too-large \(text 0 is \d+ UTF-16 units, the limit is 1048576\)$/);
    quotesNothing(e);
  });

  it('C32: unblind takes maxTextLength, accepts an answer exactly at it, and Infinity turns the check off', () => {
    expect(unblind(fake, mapping, { maxTextLength: fake.length }).text).toBe(`Dear ${secret}`);
    const e = thrown(() => unblind(fake, mapping, { maxTextLength: fake.length - 1 }));
    expect([e.kind, e.textIndex, e.length, e.limit]).toEqual(['input-too-large', 0, fake.length, fake.length - 1]);
    quotesNothing(e);
    expect(unblind(fake, mapping, { maxTextLength: Infinity }).text).toBe(`Dear ${secret}`);
    for (const bad of [0, -1, Number.NaN, '10' as unknown as number]) {
      expect(() => unblind(fake, mapping, { maxTextLength: bad })).toThrow('unblind: maxTextLength must be a positive number');
      expect(() => createUnblinder(mapping, { maxTextLength: bad })).toThrow('unblind: maxTextLength must be a positive number');
    }
  });

  it('C32: createUnblinder counts every chunk pushed against the limit and refuses the push that passes it', () => {
    const limit = fake.length + 10;
    const u = createUnblinder(mapping, { maxTextLength: limit });
    let out = u.push(fake.slice(0, 20));
    out += u.push(fake.slice(20));
    out += u.push('0123456789');
    const e = thrown(() => u.push('x'));
    expect(e).toBeInstanceOf(InputTooLargeError);
    expect([e.kind, e.textIndex, e.length, e.limit]).toEqual(['input-too-large', 0, limit + 1, limit]);
    quotesNothing(e);
    // The refused chunk is not taken: the stream ends with what came before it.
    expect(out + u.end().text).toBe(`Dear ${secret}0123456789`);
  });

  it('C32: createUnblinder has the same default limit as unblind', () => {
    const u = createUnblinder(mapping);
    const chunk = 'a '.repeat(65_536);
    for (let i = 0; i < 8; i++) u.push(chunk);
    expect(thrown(() => u.push('a')).length).toBe(MAX_TEXT_LENGTH + 1);
  });
});
