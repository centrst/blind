import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { blind, prepareUnblinder, unblind, type Mapping, type ReplaceWith } from '../src/index.js';
import { checkLeaks, type LeakInput } from '../src/leaks.js';
import { literalIndex } from '../src/literal-index.js';
import * as script from '../src/script.js';
import { check } from './support/properties.js';

const leakInput = (over: Partial<LeakInput>): LeakInput => ({
  outputs: [], replaced: [], originals: [], deny: [], amountKeys: new Set(), dateKeys: new Set(), dateOrder: 'dmy', ...over,
});

describe('literal search for multi-text leak checks', () => {
  it('C2: agrees with indexOf for every overlapping occurrence, including suffixes and UTF-16 offsets', () => {
    const word = fc.array(fc.constantFrom('a', 'b', '日', '🌱', '\ud800', '\udc00'), { maxLength: 12 }).map((xs) => xs.join(''));
    check(fc.property(fc.array(word, { maxLength: 30 }), fc.array(word, { maxLength: 8 }), (values, texts) => {
      const find = literalIndex(values);
      for (const text of texts) {
        const expected = new Map<number, number[]>();
        values.forEach((value, index) => {
          if (!value) return;
          const offsets: number[] = [];
          for (let i = text.indexOf(value); i >= 0; i = text.indexOf(value, i + 1)) offsets.push(i);
          if (offsets.length) expected.set(index, offsets);
        });
        expect(find(text)).toEqual(expected);
      }
    }), { numRuns: 2000, seed: 601 });
  });

  it('C2: reports nested and overlapping values in rule order, with offsets in the original text', () => {
    const output = '🌱 Élorane elorane 428-619';
    expect(checkLeaks(leakInput({
      outputs: [output, 'Élo', 'rane'],
      originals: [
        { kind: 'id', value: '428619' },
        { kind: 'org', value: 'lorane' },
        { kind: 'person', value: 'Élorane' },
        { kind: 'domain', value: 'lorane' },
      ],
    })).hits).toEqual([
      { kind: 'id', textIndex: 0, offset: 19 },
      { kind: 'org', textIndex: 0, offset: 4 },
      { kind: 'org', textIndex: 0, offset: 12 },
      { kind: 'person', textIndex: 0, offset: 3 },
      { kind: 'person', textIndex: 0, offset: 11 },
      { kind: 'domain', textIndex: 0, offset: 4 },
      { kind: 'domain', textIndex: 0, offset: 12 },
    ]);
    expect(checkLeaks(leakInput({ outputs: ['abababa'], originals: [{ kind: 'org', value: 'ababa' }] })).hits)
      .toEqual([{ kind: 'org', textIndex: 0, offset: 0 }, { kind: 'org', textIndex: 0, offset: 2 }]);
  });

  it('C2: does no per-original boundary work for absent values in thousands of texts', () => {
    const edges = vi.spyOn(script, 'wordEdges');
    try {
      const report = checkLeaks(leakInput({
        outputs: Array.from({ length: 2000 }, () => '[email_1]'),
        originals: Array.from({ length: 1000 }, (_, i) => ({ kind: 'email', value: `tavia${i}@host.example` })),
      }));
      expect(report.ok).toBe(true);
      expect(edges).not.toHaveBeenCalled();
    } finally {
      edges.mockRestore();
    }
  });

  it('C2: keeps detector inputs, boundary context and empty fields separate while propagating names across fields', () => {
    const source = ['From: Lenora Veldren <lenora@veldrin.example>', 'Lenora replied.', '', 'lenora is a label.', 'Invoice', '7319'];
    const received: string[] = [];
    const result = blind(source, {
      seed: 'boundaries', replaceWith: 'placeholder',
      detectors: [{ name: 'observe', detect(text) { received.push(text); return []; } }],
    });
    expect(received).toEqual(source);
    expect(result.texts[1]).not.toContain('Lenora');
    expect(result.texts.slice(2)).toEqual(source.slice(2));
    expect(result.leaks.hits).toContainEqual({ kind: 'person', textIndex: 3, offset: 0 });
    const prepared = prepareUnblinder(result.mapping);
    expect(result.texts.map((text) => prepared.unblind(text).text)).toEqual(source);
  });
});

describe('prepared independent restoration', () => {
  const source = ['Ms. Tavia Norwick at Veltrin Ltd. paid €431.27 on 14/03/2026.', 'Email tavia@veltrin.example.', 'Ｔａｖｉａ Norwick', ''];

  it.each<ReplaceWith>(['fake', 'placeholder', 'random'])('C27: restores every spelling exactly and matches one-shot results in %s mode', (replaceWith) => {
    const result = blind(source, { seed: 'prepared', replaceWith, known: [{ kind: 'person', value: 'Tavia Norwick' }] });
    expect(result.leaks.ok).toBe(true);
    const prepared = prepareUnblinder(result.mapping);
    expect(result.texts.map((text) => prepared.unblind(text).text)).toEqual(source);
    const answers = [...result.texts, 'unlisted@other.example [REDACTED_PERSON_999] €901.18 19/08/2031', ''];
    for (const text of [...answers, ...answers.slice().reverse()]) expect(prepared.unblind(text)).toEqual(unblind(text, result.mapping));
  });

  it('C27: snapshots source pairs and scaling settings, returns independent reports, and never rereads the source', () => {
    const mapping = blind(source, { seed: 'snapshot' }).mapping;
    mapping.pairs.push({ kind: 'amount', real: '732.19', fake: mapping.pairs.find((p) => p.kind === 'amount')!.fake });
    const original = structuredClone(mapping);
    const answer = `${mapping.pairs[0]!.fake} unlisted@other.example €901.18 19/08/2031`;
    const expected = unblind(answer, original);
    expect(expected.collisions.length).toBeGreaterThan(0);
    const prepared = prepareUnblinder(mapping);
    mapping.pairs[0]!.real = 'Changed Source';
    mapping.factor = 7;
    mapping.dayShift = 210;
    mapping.dateOrder = 'mdy';
    mapping.refYear = 2099;
    Object.defineProperty(mapping, 'pairs', { get() { throw new Error('Source must not be read again'); } });
    const first = prepared.unblind(answer);
    expect(first).toEqual(expected);
    first.invented.length = 0;
    first.collisions[0]!.index = -1;
    first.collisions.length = 0;
    expect(prepared.unblind(answer)).toEqual(expected);
  });

  it('C32: validates options once, applies limits per text, and can restore after a refused text', () => {
    const mapping = blind([], { seed: 'limits' }).mapping;
    for (const maxTextLength of [0, -1, NaN]) expect(() => prepareUnblinder(mapping, { maxTextLength })).toThrow('unblind: maxTextLength must be a positive number');
    const opts = { maxTextLength: 5 };
    const prepared = prepareUnblinder(mapping, opts);
    opts.maxTextLength = 1;
    for (let i = 0; i < 20; i++) expect(prepared.unblind('hello').text).toBe('hello');
    expect(() => prepared.unblind('private')).toThrow('unblind: input-too-large');
    expect(prepared.unblind('hello').text).toBe('hello');
  });

  it('C27: keeps split placeholders in separate fields and requires preparing an extended mapping again', () => {
    const first = blind(['lenora@veldrin.example'], { seed: 'continued', replaceWith: 'placeholder' });
    const prepared = prepareUnblinder(first.mapping);
    const fake = first.texts[0]!;
    expect(prepared.unblind(fake.slice(0, 8)).text).toBe(fake.slice(0, 8));
    expect(prepared.unblind(fake.slice(8)).text).toBe(fake.slice(8));
    expect(prepared.unblind(fake).text).toBe('lenora@veldrin.example');
    const later = blind(['tavia@norwick.example'], { mapping: first.mapping });
    expect(prepared.unblind(later.texts[0]!).invented).toEqual([later.texts[0]]);
    expect(prepareUnblinder(later.mapping).unblind(later.texts[0]!).text).toBe('tavia@norwick.example');
  });

  it('C36: hides mapping failures behind the same error boundary as one-shot restoration', () => {
    const mapping = { get pairs() { throw new Error('sensitive@invented.example'); } } as unknown as Mapping;
    expect(() => prepareUnblinder(mapping)).toThrow(/^unblind: internal error while reading the mapping$/);
  });
});
