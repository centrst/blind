import { expect, it } from 'vitest';
import { assertNoLeaks, blind, checkMapping, createUnblinder, unblind, type BlindOptions } from '../src/index.js';

const known = [{ kind: 'person' as const, value: 'Dana Whitfield' }];

function redact(texts: string[], options: BlindOptions = {}) {
  const result = blind(texts, { known, replaceWith: 'placeholder', seed: 'identity', ...options });
  assertNoLeaks(result);
  expect(result.collisions).toEqual([]);
  checkMapping(JSON.parse(JSON.stringify(result.mapping)));
  result.texts.forEach((text, i) => expect(unblind(text, result.mapping).text).toBe(texts[i]));
  const tokens = result.identities.flatMap((identity) => [...identity.names, ...identity.emails]);
  expect(new Set(tokens).size).toBe(tokens.length);
  for (const token of tokens) {
    expect(token).toMatch(/^\[REDACTED_(PERSON|EMAIL)_[1-9]\d*\]$/);
    expect(result.texts.some((text) => text.includes(token))).toBe(true);
  }
  return result;
}

it('links a full name, short name and explicitly associated email without merging their restoration tokens', () => {
  const text = 'From: Dana Whitfield <dana.whitfield@mail.example>\n\nThanks, Dana';
  const result = blind([text], { known, replaceWith: 'placeholder', seed: 'identity' });
  expect(result).toMatchObject({ identities: [{
    names: ['[REDACTED_PERSON_1]', '[REDACTED_PERSON_2]'],
    emails: ['[REDACTED_EMAIL_1]'],
  }] });
  expect(result.leaks.ok).toBe(true);
  expect(result.collisions).toEqual([]);
  expect(unblind(result.texts[0]!, result.mapping).text).toBe(text);
});

it('collects candidates across a batch before linking names, including detected names without known entries', () => {
  for (const known of [[], [{ kind: 'person' as const, value: 'Dana Whitfield' }]]) {
    const result = redact(['Thanks, Dana', 'From: Dana Whitfield <reply@mail.example>'], { known });
    expect(result.identities).toEqual([{
      names: ['[REDACTED_PERSON_1]', '[REDACTED_PERSON_2]'], emails: ['[REDACTED_EMAIL_1]'],
    }]);
  }
});

it('leaves a shared first name unlinked regardless of candidate or mention order', () => {
  const people = ['Dana Whitfield', 'Dana Ashcombe'];
  for (const names of [people, [...people].reverse()]) {
    const known = names.map((value) => ({ kind: 'person' as const, value }));
    for (const texts of [
      ['Meeting with Dana.', 'Dana Whitfield and Dana Ashcombe will host.'],
      ['Dana Whitfield and Dana Ashcombe will host.', 'Meeting with Dana.'],
      ['Meeting with Dana. Dana Whitfield will host.'],
    ]) expect(redact(texts, { known }).identities).toEqual([]);
  }
});

it('does not mistake a surname, initial, stop word or separately known single name for a unique first name', () => {
  for (const [people, text] of [
    [['Dana Whitfield', 'Mira Dana'], 'Dana Whitfield met Mira Dana. Dana joined.'],
    [['Dana Whitfield'], 'Dana Whitfield called. Whitfield replied.'],
    [['D. Whitfield'], 'D. Whitfield called. D. replied.'],
    [['Al Whitfield'], 'Al Whitfield called. Al replied.'],
    [['Dana Whitfield', 'Dana'], 'Dana Whitfield called. Dana replied.'],
  ] as const) {
    expect(redact([text], { known: people.map((value) => ({ kind: 'person', value })) }).identities).toEqual([]);
  }
});

it('never infers address ownership from a local part, domain or nearby prose', () => {
  for (const text of [
    'Dana Whitfield wrote to dana.whitfield@mail.example.',
    'Dana Whitfield. dana@mail.example is available.',
    'Dana Whitfield <dana.whitfield@mail.example',
    'Dana Whitfield\n<dana.whitfield@mail.example>',
  ]) expect(redact([text]).identities).toEqual([]);
});

it('omits a shared mailbox but keeps the independent name links', () => {
  const result = redact([
    'From: Dana Whitfield <team@mail.example>\nThanks, Dana',
    'From: Mira Ashcombe <team@mail.example>\nThanks, Mira',
  ]);
  expect(result.identities).toEqual([
    { names: ['[REDACTED_PERSON_1]', '[REDACTED_PERSON_2]'], emails: [] },
    { names: ['[REDACTED_PERSON_3]', '[REDACTED_PERSON_4]'], emails: [] },
  ]);
});

it('an unresolved short display name or organization blocks a shared mailbox association', () => {
  for (const sender of ['Mira', 'Ashcombe Ltd']) {
    const result = redact([
      'From: Dana Whitfield <team@mail.example>',
      `From: ${sender} <team@mail.example>`,
    ]);
    expect(result.identities).toEqual([]);
  }
});

it('keeps address spellings separate and links only the exact address in the display-name mailbox', () => {
  const result = redact(['From: Dana Whitfield <dana@mail.example>\nOther mailbox: DANA@mail.example']);
  expect(result.identities).toEqual([{ names: ['[REDACTED_PERSON_1]'], emails: ['[REDACTED_EMAIL_1]'] }]);
});

it('supports quoted display names and several explicit addresses for one person', () => {
  const result = redact([
    'From: "Dana Whitfield" <first@mail.example>',
    'To: Dana Whitfield <second@mail.example>\nThanks, Dana',
  ]);
  expect(result.identities).toEqual([{
    names: ['[REDACTED_PERSON_1]', '[REDACTED_PERSON_2]'],
    emails: ['[REDACTED_EMAIL_1]', '[REDACTED_EMAIL_2]'],
  }]);
});

it('groups spelling variants while every token restores its own exact form in answers and streams', () => {
  const result = redact(['Dana Whitfield, DANA WHITFIELD, Dána Whitfield, Dana, DANA and Dána.']);
  expect(result.identities).toHaveLength(1);
  const names = result.identities[0]!.names;
  expect(names).toHaveLength(6);
  const answer = [...names].reverse().join(' / ');
  const restored = 'Dána / DANA / Dana / Dána Whitfield / DANA WHITFIELD / Dana Whitfield';
  expect(unblind(answer, result.mapping).text).toBe(restored);
  for (let cut = 0; cut <= answer.length; cut++) {
    const stream = createUnblinder(result.mapping);
    expect(stream.push(answer.slice(0, cut)) + stream.push(answer.slice(cut)) + stream.end().text).toBe(restored);
  }
});

it('uses names carried by a JSON mapping, leaves old tokens fixed and reevaluates ambiguity each call', () => {
  const first = redact(['From: Dana Whitfield <dana@mail.example>\nThanks, Dana']);
  const mapping = JSON.parse(JSON.stringify(first.mapping));
  const next = redact(['Dana called Dana Whitfield.'], { known: [], mapping });
  expect(next.identities).toEqual([{
    names: ['[REDACTED_PERSON_2]', '[REDACTED_PERSON_1]'], emails: [],
  }]);
  expect(next.mapping.pairs).toEqual(first.mapping.pairs);
  const ambiguous = redact(['Dana Whitfield met Dana Ashcombe. Dana called.'], {
    mapping, known: [{ kind: 'person', value: 'Dana Ashcombe' }],
  });
  expect(ambiguous.identities).toEqual([]);
  expect(ambiguous.mapping.pairs.slice(0, first.mapping.pairs.length)).toEqual(first.mapping.pairs);
});

it('does not expose unused known values, old relationships or placeholder literals in its legend', () => {
  const first = redact(['From: Dana Whitfield <dana@mail.example>\nThanks, Dana']);
  expect(redact(['Nothing to report.'], { mapping: first.mapping }).identities).toEqual([]);
  const result = redact(['Dana Whitfield and Dana met [REDACTED_PERSON_1].']);
  expect(result.identities).toEqual([{ names: ['[REDACTED_PERSON_2]', '[REDACTED_PERSON_3]'], emails: [] }]);
  const collided = blind(['Dana Whitfield and Dana met [REDACTED_PERSON_1].'], { mapping: first.mapping });
  expect(collided.collisions).toEqual([{ kind: 'person', index: 0 }]);
  expect(collided.identities).toEqual([]);
});

it('leaves fake and random modes outside the placeholder identity contract', () => {
  for (const replaceWith of ['fake', 'random'] as const) {
    expect(redact(['From: Dana Whitfield <dana@mail.example>\nThanks, Dana'], { replaceWith }).identities).toEqual([]);
  }
});

it('links a short name before its full name', () => {
  const text = 'Meeting with Dana. Dana Whitfield will host.';
  const result = blind([text], { known, replaceWith: 'placeholder', seed: 'identity' });
  expect(result).toMatchObject({ identities: [{
    names: ['[REDACTED_PERSON_1]', '[REDACTED_PERSON_2]'], emails: [],
  }] });
  expect(unblind(result.texts[0]!, result.mapping).text).toBe(text);
});
