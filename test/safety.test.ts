/**
 * Direct tests of the files that carry the safety claims: leaks.ts (C2, C3),
 * amounts.ts (C4) and dates.ts (C5), plus the folds that feed them. The
 * property and corpus suites reach these files through blind(). These tests
 * pin down the edges, so a changed comparison or constant fails here by name.
 */
import { describe, expect, it } from 'vitest';
import { AmountPlan, amountKey, detectAmounts, detectPercents, formatNumber, freeAmountFake, parseNumber, type ParsedNumber } from '../src/amounts.js';
import { amountDetector } from '../src/detect.js';
import { dateKey, detectDates, freeDateFake, renderDate, shiftOcc, shiftYmd, type DateOcc } from '../src/dates.js';
import { foldLookalikes, skeleton, stripInvisible, visibleOffsets } from '../src/fold.js';
import { flexAtoms, literalAtoms, matchAlternatives } from '../src/match.js';
import { assertNoLeaks, blind, BlindError, createUnblinder, LeakError, unblind, type KnownValue } from '../src/index.js';
import { guard, InputTooLargeError } from '../src/errors.js';
import { checkLeaks, denyDomains, shortTextLeaks, type LeakInput, type Original } from '../src/leaks.js';
import { Rng } from '../src/prng.js';

/** A Spanish IBAN for the variants below. Its last groups read as a phone on their own, so they are derived from it. */
const ES_IBAN = 'ES91 2100 0418 4502 0005 1332';

const input = (over: Partial<LeakInput>): LeakInput => ({
  outputs: [''],
  replaced: [[]],
  originals: [],
  deny: [],
  amountKeys: new Set(),
  dateKeys: new Set(),
  dateOrder: 'dmy',
  ...over,
});

const hits = (over: Partial<LeakInput>): Array<[string, number, number]> =>
  checkLeaks(input(over)).hits.map((h) => [h.kind, h.textIndex, h.offset]);

/** True when `message` holds an 8-character slice of any of `inputs`. */
const quotes = (message: string, inputs: string[]): boolean => {
  const slices = new Set<string>();
  for (let i = 0; i + 8 <= message.length; i++) slices.add(message.slice(i, i + 8));
  return inputs.some((t) => {
    for (let i = 0; i + 8 <= t.length; i++) if (slices.has(t.slice(i, i + 8))) return true;
    return false;
  });
};

describe('leak check', () => {
  it('C2/unit: a person is matched as a whole word, in any case, with accents folded', () => {
    expect(hits({ outputs: ['Banana split'], originals: [{ kind: 'person', value: 'Ana' }] })).toEqual([]);
    expect(hits({ outputs: ['Hola ana, hola ANA'], originals: [{ kind: 'person', value: 'Ana' }] })).toEqual([['person', 0, 5], ['person', 0, 15]]);
    expect(hits({ outputs: ['Hola María'], originals: [{ kind: 'person', value: 'Maria' }] })).toEqual([['person', 0, 5]]);
    expect(hits({ outputs: ['Hola María'], originals: [{ kind: 'person', value: 'María' }] })).toHaveLength(1);
  });

  it('C2/unit: values shorter than three characters are never matched', () => {
    expect(hits({ outputs: ['Al y Bo'], originals: [{ kind: 'person', value: 'Al' }, { kind: 'org', value: 'Bo' }] })).toEqual([]);
    expect(hits({ outputs: ['Eva'], originals: [{ kind: 'person', value: 'Eva' }] })).toHaveLength(1);
    expect(hits({ outputs: ['Eva'], originals: [{ kind: 'person', value: ' Eva ' }] })).toHaveLength(1);
  });

  it('C2/unit: a short non-person value is a whole word, a long one can sit inside a longer word', () => {
    expect(hits({ outputs: ['Zetas y Zeta'], originals: [{ kind: 'org', value: 'Zeta' }] })).toEqual([['org', 0, 8]]);
    expect(hits({ outputs: ['Norteño'], originals: [{ kind: 'org', value: 'Norte' }] })).toEqual([['org', 0, 0]]);
    expect(hits({ outputs: ['xNorte'], originals: [{ kind: 'place', value: 'Norte' }] })).toEqual([['place', 0, 1]]);
  });

  it('C2/unit: phones, IBANs and ids are found through any spacing and punctuation', () => {
    expect(hits({ outputs: ['call 34-791.345 678 now'], originals: [{ kind: 'phone', value: '+34 791 345 678' }] })).toEqual([['phone', 0, 5]]);
    expect(hits({ outputs: ['ES91 2100 0418 4502 0005 1332'], originals: [{ kind: 'iban', value: 'ES9121000418450200051332' }] })).toEqual([['iban', 0, 0]]);
    expect(hits({ outputs: ['ref (12) 34-5678'], originals: [{ kind: 'id', value: '12345678' }] })).toHaveLength(1);
    // Five characters are too few to be a safe search, six are enough.
    expect(hits({ outputs: ['12345'], originals: [{ kind: 'id', value: '12345' }] })).toEqual([]);
    expect(hits({ outputs: ['123456'], originals: [{ kind: 'id', value: '123456' }] })).toHaveLength(1);
    expect(hits({ outputs: ['x123456 and 1234567'], originals: [{ kind: 'id', value: '123456' }] })).toEqual([]);
  });

  it('C2/unit: a time is not an id, unless the id itself has colons', () => {
    // A property run found this: the code 100000 was replaced, and the header time 10:00:00
    // read as the same six digits, so the check reported a leak that was not there.
    expect(hits({ outputs: ['Date: Mon, 23 Oct 2023 10:00:00 +0100'], originals: [{ kind: 'id', value: '100000' }] })).toEqual([]);
    expect(hits({ outputs: ['at 12:34:56 and 12.34.56'], originals: [{ kind: 'id', value: '123456' }] })).toEqual([['id', 0, 16]]);
    expect(hits({ outputs: ['host 2001:db8::1:0 up'], originals: [{ kind: 'id', value: '2001:db8::1:0' }] })).toHaveLength(1);
  });

  it('C2/unit: an email with a header time and a six-digit code blinds without a false leak, in every mode', () => {
    // The fast-check seed that exposed the case (TESTING.md, P5), a number and not a phone.
    const P15_REPLAY = 711059849;
    const email = [
      'From: Partners Aldara Inc. <security@partners-aldara.example>',
      'Date: Mon, 1 Jan 2024 10:00:00 +0100',
      'Your verification code is 100000. It expires in 10 minutes.',
    ].join('\n');
    for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
      const res = blind([email], { seed: `p15-${P15_REPLAY}`, replaceWith, known: [{ kind: 'org', value: 'Partners Aldara Inc.' }] });
      expect(res.leaks, replaceWith).toEqual({ ok: true, hits: [], unenforced: [] });
      expect(res.texts[0], replaceWith).not.toContain(' 100000');
      expect(res.texts[0], replaceWith).toContain('10:00:00');
    }
  });

  it('C2/unit: the same original listed twice reports one hit, two kinds report two', () => {
    expect(hits({ outputs: ['Ana'], originals: [{ kind: 'person', value: 'Ana' }, { kind: 'person', value: 'ana' }] })).toHaveLength(1);
    expect(hits({ outputs: ['Ana'], originals: [{ kind: 'person', value: 'Ana' }, { kind: 'place', value: 'Ana' }] })).toHaveLength(2);
  });

  it('C2/unit: amounts and dates are flagged outside the ranges the engine wrote, not inside', () => {
    const out = 'Total 247,80 € y 247,80 €';
    expect(hits({ outputs: [out], amountKeys: new Set(['2:24780']) })).toEqual([['amount', 0, 6], ['amount', 0, 17]]);
    expect(hits({ outputs: [out], amountKeys: new Set(['2:24780']), replaced: [[[6, 12]]] })).toEqual([['amount', 0, 17]]);
    expect(hits({ outputs: [out], amountKeys: new Set(['2:24780']), replaced: [[[0, 5]]] })).toHaveLength(2);
    expect(hits({ outputs: [out], amountKeys: new Set(['2:1']) })).toEqual([]);
    const d = 'el 3 de marzo de 2026';
    expect(hits({ outputs: [d], dateKeys: new Set(['2026-3-3']) })).toEqual([['date', 0, 3]]);
    expect(hits({ outputs: [d], dateKeys: new Set(['2026-3-3']), replaced: [[[3, 21]]] })).toEqual([]);
    expect(hits({ outputs: ['03/04/2026'], dateKeys: new Set(['2026-3-4']), dateOrder: 'mdy' })).toHaveLength(1);
    expect(hits({ outputs: ['03/04/2026'], dateKeys: new Set(['2026-3-4']), dateOrder: 'dmy' })).toEqual([]);
  });

  it('C3/unit: deny entries match in any case and accent, are trimmed and need two characters', () => {
    expect(hits({ outputs: ['STATUS OF PROJECT FALCON'], deny: ['Project Falcon'] })).toEqual([['deny', 0, 10]]);
    expect(hits({ outputs: ['un proyecto en malaga'], deny: ['  Málaga  '] })).toEqual([['deny', 0, 15]]);
    expect(hits({ outputs: ['abc'], deny: ['a'] })).toEqual([]);
    expect(hits({ outputs: ['abc'], deny: ['ab'] })).toHaveLength(1);
    expect(hits({ outputs: ['abc'], deny: [' a '] })).toEqual([]);
    // A deny entry is a substring match, not a whole-word match.
    expect(hits({ outputs: ['xFalconx'], deny: ['Falcon'] })).toHaveLength(1);
  });

  it('C3/unit: *@domain denies every address on the domain and its subdomains, nothing longer', () => {
    const deny = ['*@my-domain.example'];
    expect(hits({ outputs: ['Info@MY-DOMAIN.Example'], deny })).toEqual([['deny', 0, 0]]);
    expect(hits({ outputs: ['a.b+c@mail.my-domain.example'], deny })).toHaveLength(1);
    expect(hits({ outputs: ['x@my-domain.examples'], deny })).toEqual([]);
    expect(hits({ outputs: ['x@my-domain.example-two'], deny })).toEqual([]);
    expect(hits({ outputs: ['x@other.example'], deny })).toEqual([]);
    expect(hits({ outputs: ['*@my-domain.example'], deny: ['  *@my-domain.example  '] })).toEqual([]);
  });

  it('C3/unit: every text is checked and hits carry the text index', () => {
    expect(hits({ outputs: ['ok', 'Ana', 'fine', 'ana'], replaced: [[], [], [], []], originals: [{ kind: 'person', value: 'Ana' }] })).toEqual([
      ['person', 1, 0],
      ['person', 3, 0],
    ]);
  });

  it('C2/unit: look-alikes, full-width letters and zero-width characters do not hide a value', () => {
    expect(hits({ outputs: ['Аna'], originals: [{ kind: 'person', value: 'Ana' }] })).toHaveLength(1);
    expect(hits({ outputs: ['A​na'], originals: [{ kind: 'person', value: 'Ana' }] })).toHaveLength(1);
    expect(hits({ outputs: ['Ａｎａ'], originals: [{ kind: 'person', value: 'Ana' }] })).toHaveLength(1);
  });

  it('C2/unit: a hit offset points into the blind text, past hidden characters and decomposed accents', () => {
    expect(hits({ outputs: ['A\u200bdiós Ana'], originals: [{ kind: 'person', value: 'Ana' }] })).toEqual([['person', 0, 7]]);
    expect(hits({ outputs: ['Nin\u0303a Ana'], originals: [{ kind: 'person', value: 'Ana' }] })).toEqual([['person', 0, 6]]);
    expect(hits({ outputs: ['Nin\u0303a Falcon'], originals: [], deny: ['Falcon'] })).toEqual([['deny', 0, 6]]);
  });

  it('C2/unit: LeakError names kinds and text numbers, never a value', () => {
    const report = checkLeaks(input({ outputs: ['ok', 'Ana Falcon'], replaced: [[], []], originals: [{ kind: 'person', value: 'Ana' }], deny: ['Falcon'] }));
    expect(report.ok).toBe(false);
    const err = new LeakError(report);
    expect(err.name).toBe('LeakError');
    expect(err.message).toBe('blind: 2 leak(s) in text 1 (kinds: person, deny)');
    expect(err.message).not.toContain('Ana');
    expect(() => assertNoLeaks({ leaks: report })).toThrow(LeakError);
    expect(() => assertNoLeaks({ leaks: { ok: true, hits: [] } })).not.toThrow();
    const two = new LeakError({ ok: false, hits: [{ kind: 'org', textIndex: 0, offset: 1 }, { kind: 'org', textIndex: 2, offset: 4 }] });
    expect(two.message).toBe('blind: 2 leak(s) in text 0, 2 (kinds: org)');
  });

  it('C3/unit: denyDomains keeps only *@ entries, lower-cased and trimmed', () => {
    expect([...denyDomains(['*@Foo.Example ', 'plain', '*@bar.example'])]).toEqual(['foo.example', 'bar.example']);
  });

  it('C2/unit: a known org is checked without its legal suffix, and a role address on a public host is not a leak', () => {
    const r = blind(['Contrato con Gestoria Norte y no-reply@platform.example'], { known: [{ kind: 'org', value: 'Gestoría Norte S.L.' }], seed: 'org', allowDomains: ['platform.example'] });
    expect(r.texts[0]).not.toContain('Norte');
    expect(r.texts[0]).toContain('no-reply@platform.example');
    expect(r.leaks.ok).toBe(true);
  });

  it('C2/unit: a particle such as del in a known name is not a leak', () => {
    const r = blind(['Hola Ramon del Rio, el rio del pueblo'], { known: [{ kind: 'person', value: 'Ramon del Rio' }], seed: 'p' });
    expect(r.texts[0]!.match(/ del /g)).toHaveLength(2);
    expect(r.leaks.ok).toBe(true);
  });
});

it('C5/unit: a month word inside an IBAN is not shifted as a date or used as the reference year', () => {
  const text = 'IBAN NL15 JUNE 1007 0000 52. Due 1 Jan 2024.';
  const res = blind([text], { seed: 'date-repro' });
  expect(res.mapping.refYear).toBe(2024);
  const dates = res.mapping.pairs.filter((p) => p.kind === 'date');
  expect(dates).toHaveLength(1);
  expect(dates[0]!.real).toBe('1 Jan 2024');
  const shifted = detectDates(dates[0]!.fake, 'dmy')[0]!.occ;
  expect(Date.UTC(shifted.y!, shifted.m - 1, shifted.d) - Date.UTC(2024, 0, 1)).toBe(res.mapping.dayShift * 86400000);
  expect(res.texts[0]).toContain(dates[0]!.fake);
  expect(res.mapping.pairs.filter((p) => p.kind === 'iban')).toHaveLength(1);
  expect(unblind(res.texts[0]!, res.mapping).text).toBe(text);
});

describe('which originals the leak check looks for, and how', () => {
  const person = (value: string, more: Partial<Original> = {}): Original => ({ kind: 'person', value, ...more });

  it('a two-letter name part counts capitalised, and in lower case only where it marks one and the language does not write it as a word', () => {
    expect(hits({ outputs: ['Ask Wu today. Ask wu too.'], originals: [person(' Wu ')] })).toEqual([['person', 0, 4]]);
    // Found in the text and given lower case, the part is one value under the wider rule.
    expect(hits({ outputs: ['Write to wu today.'], originals: [person('Wu'), person('Wu', { lowerCase: true })] })).toEqual([['person', 0, 9]]);
    const su = [person('Su', { known: true, lowerCase: true })];
    expect(hits({ outputs: ['Write to su today and ask SU, not sU.'], originals: su })).toEqual([['person', 0, 9], ['person', 0, 26]]);
    expect(hits({ outputs: ['Escribe a su hermana y a su madre.'], originals: su })).toEqual([]);
  });

  it('a capitalised part and the same letters in lower case are two values, and so are a found value and a known one', () => {
    expect(hits({ outputs: ['Mo dijo'], originals: [person('mo'), person('Mo')] })).toEqual([['person', 0, 0]]);
    expect(hits({ outputs: ['ref AB-12'], originals: [{ kind: 'id', value: 'AB12' }, { kind: 'id', value: 'AB12', known: true }] })).toEqual([['id', 0, 4]]);
  });

  it('a value listed twice is one value, a phone as much as a name', () => {
    expect(hits({ outputs: ['Ruiz llamó al 790 123 456'], originals: [person('Ruiz'), { kind: 'phone', value: '790 123 456' }, person('Ruiz'), { kind: 'phone', value: '790 123 456' }] }))
      .toEqual([['person', 0, 0], ['phone', 0, 14]]);
  });

  it('amount and date originals are left to the amount and date checks', () => {
    expect(hits({ outputs: ['Total 247,80 € el 3 de marzo'], originals: [{ kind: 'amount', value: '247,80' }, { kind: 'date', value: '3 de marzo' }] })).toEqual([]);
  });

  it('an unknown value made of particles is a plain word, a known one counts only as written or in capitals', () => {
    expect(hits({ outputs: ['la casa van der'], originals: [person('Van Der')] })).toEqual([['person', 0, 8]]);
    expect(hits({ outputs: ['la casa van der, Van Der'], originals: [person('Van Der', { known: true })] })).toEqual([['person', 0, 17]]);
  });

  it('a known id of two letters or digits is found through separators, and one with none is looked for as text', () => {
    expect(hits({ outputs: ['ref AB 12'], originals: [{ kind: 'id', value: 'AB12', known: true }] })).toEqual([['id', 0, 4]]);
    expect(hits({ outputs: ['ref AB 12'], originals: [{ kind: 'id', value: 'AB12' }] })).toEqual([]);
    expect(hits({ outputs: ['clave \u65e5\u672c'], originals: [{ kind: 'id', value: '\u65e5\u672c', known: true }] })).toEqual([['id', 0, 6]]);
  });

  it('a short value is looked for only when known, a name part, or in a script without word spaces', () => {
    expect(hits({ outputs: ['Q y QQ'], originals: [{ kind: 'org', value: 'Q', known: true }] })).toEqual([]);
    expect(hits({ outputs: ['Q y QQ'], originals: [{ kind: 'org', value: 'QQ', known: true }] })).toEqual([['org', 0, 4]]);
    expect(hits({ outputs: ['abc'], originals: [person('  ')] })).toEqual([]);
    expect(hits({ outputs: ['\u674e\u660e\u6765\u4e86'], originals: [person('\u674e\u660e')] })).toEqual([['person', 0, 0]]);
    expect(hits({ outputs: ['a\u674e y a\u674e'], originals: [person('a\u674e')] })).toEqual([]);
  });

  it('a person is a whole word at any length, an org of five letters or more is found inside a word', () => {
    expect(hits({ outputs: ['los Morenos'], originals: [person('Moreno')] })).toEqual([]);
    expect(hits({ outputs: ['los Morenos'], originals: [{ kind: 'org', value: 'Moreno' }] })).toEqual([['org', 0, 4]]);
  });

  it('an amount touching a range blind wrote, on either side, is outside it', () => {
    const keys = new Set(['2:24780']);
    expect(hits({ outputs: ['abc247,80 €'], replaced: [[[0, 3]]], amountKeys: keys })).toEqual([['amount', 0, 3]]);
    expect(hits({ outputs: ['247,80 € x'], replaced: [[[6, 8]]], amountKeys: keys })).toEqual([['amount', 0, 0]]);
    expect(hits({ outputs: ['abc 247,80 €'], replaced: [[[5, 6]]], amountKeys: keys })).toEqual([]);
  });

  it('a short-text check finds a value that two originals of different reach share', () => {
    expect(shortTextLeaks({ originals: [{ kind: 'org', value: 'Moreno' }, person('Moreno')], deny: [], amountKeys: new Set(), dateKeys: new Set(), dateOrder: 'dmy' })('los Morenos')).toBe(true);
  });

  it('a hand-built report with an unknown kind or a bad index is named without quoting either', () => {
    const odd = new LeakError({ ok: false, hits: [{ kind: 'Ana Ruiz' as never, textIndex: 0.5, offset: 0 }, { kind: 7 as never, textIndex: 1, offset: 0 }] });
    expect(odd.message).toBe('blind: 2 leak(s) in text ?, 1 (kinds: other)');
  });

  it('an input too large and a wrapped internal error carry their names and kinds', () => {
    const big = new InputTooLargeError(2, 10, 5);
    expect(big.name).toBe('InputTooLargeError');
    expect(big.kind).toBe('input-too-large');
    let caught: unknown;
    try {
      guard('blind', 'testing', () => { throw new Error('Ana Ruiz'); });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BlindError);
    expect((caught as BlindError).kind).toBe('internal');
    expect((caught as BlindError).message).toBe('blind: internal error while testing');
  });
});

describe('the short-text leak test', () => {
  // shortTextLeaks promises the answer checkLeaks gives for one text with nothing marked as written by blind.
  const originals: Original[] = [
    { kind: 'person', value: 'Ana' }, { kind: 'person', value: 'Ruiz' }, { kind: 'person', value: 'Li' },
    { kind: 'person', value: '\u674e\u660e' }, { kind: 'org', value: 'Gestoría Norte' }, { kind: 'place', value: 'Vigo' },
    { kind: 'email', value: 'ana@gestoria-norte.example' }, { kind: 'phone', value: '790 123 456' },
    { kind: 'iban', value: 'ES91 2100 0418 4502 0005 1332' }, { kind: 'id', value: '2001:db8::1' },
    { kind: 'id', value: 'EXP-0412' }, { kind: 'id', value: 'AB12', known: true }, { kind: 'id', value: '1234' },
  ];
  const base = { originals, deny: ['Project Falcon', '*@vidal.example', 'x'], amountKeys: new Set(['2:24780']), dateKeys: new Set(['2026-3-3']), dateOrder: 'dmy' as const };
  const texts = [
    '', 'nada que ver', 'Ana Ruiz firmó', 'ANA RUIZ', 'ruiz', 'Ruizes', 'xAna', 'Anaya', 'Li lo sabe', 'li lo sabe', 'Lima', 'ALi',
    'GESTORIA NORTE SL', 'la gestoría norte', 'Vigo', 'Vigoés', 'escribe a ana@gestoria-norte.example',
    'Llama al 790-123-456', '(790) 123.456', 'x790123456', '790 123 456 7', 'tel: 790/123/456',
    `IBAN ${ES_IBAN.toLowerCase().split(' ').slice(0, 4).join('')} ${ES_IBAN.toLowerCase().split(' ').slice(4).join(' ')}`, 'host 2001:db8::1', '2001 db8 1', 'a las 10:00:00', 'EXP 0412', 'exp-0412!', 'EXP-04123', 'zEXP0412',
    'AB 12', 'ab12', 'AB123', 'id 1234', 'id 12345', '\u674e\u660e\u6765\u4e86', 'PROJECT FALCON', 'projectfalcon',
    'bo@vidal.example', 'bo@mail.vidal.example', 'vidal.example', 'Total 247,80 €', 'Total 247.80', '24780', 'el 3 de marzo de 2026', '03/03/2026', '3 de marzo',
  ];

  it('gives the answer checkLeaks gives for the same text alone', () => {
    const test = shortTextLeaks(base);
    for (const t of texts) {
      const full = checkLeaks({ ...base, outputs: [t], replaced: [[]] });
      expect(test(t), JSON.stringify(t)).toBe(!full.ok);
    }
  });

  it('finds each kind of original on its own', () => {
    const one = (o: Partial<typeof base>, t: string): boolean => shortTextLeaks({ ...base, originals: [], deny: [], amountKeys: new Set(), dateKeys: new Set(), ...o })(t);
    expect(one({}, 'Ana Ruiz 790 123 456 247,80 €')).toBe(false);
    expect(one({ originals: [{ kind: 'phone', value: '790 123 456' }] }, 'call 790.123.456 now')).toBe(true);
    expect(one({ originals: [{ kind: 'id', value: '2001:db8::1' }] }, 'host 2001:db8::1')).toBe(true);
    expect(one({ originals: [{ kind: 'id', value: '2001:db8::1' }] }, 'host 2001 db8 1')).toBe(true);
    expect(one({ originals: [{ kind: 'id', value: '2001:db8::1' }] }, 'host 2001:db8::12')).toBe(false);
    expect(one({ originals: [{ kind: 'id', value: '100000' }] }, 'a las 10:00:00')).toBe(false);
    expect(one({ deny: ['Project Falcon'] }, 'el PROJECT FALCON')).toBe(true);
    expect(one({ deny: ['*@vidal.example'] }, 'bo@mail.vidal.example')).toBe(true);
    expect(one({ amountKeys: new Set(['2:24780']) }, 'EUR 247.80')).toBe(true);
    expect(one({ dateKeys: new Set(['2026-3-3']) }, '03/03/2026')).toBe(true);
    expect(one({ originals: [{ kind: 'person', value: 'Li' }] }, 'li')).toBe(false);
    expect(one({ originals: [{ kind: 'person', value: 'Li' }] }, 'Li')).toBe(true);
    expect(one({ originals: [{ kind: 'org', value: 'Gestoría Norte' }] }, 'xgestoria nortex')).toBe(true);
  });

  it('counts a known stop-word value written capitalised, which includes as written and in capitals', () => {
    const test = shortTextLeaks({ ...base, originals: [{ kind: 'person', value: 'Al', known: true }] });
    expect(test('Al dijo')).toBe(true);
    expect(test('AL dijo')).toBe(true);
    expect(test('al dijo')).toBe(false);
  });
});

describe('amounts', () => {
  it('C4/unit: parseNumber reads separators by position and group size', () => {
    expect(parseNumber('1.234,56')).toEqual({ minor: 123456, decimals: 2, dec: ',', thou: '.' });
    expect(parseNumber('1,234.56')).toEqual({ minor: 123456, decimals: 2, dec: '.', thou: ',' });
    expect(parseNumber('1.234')).toEqual({ minor: 1234, decimals: 0, dec: null, thou: '.' });
    expect(parseNumber('12,345')).toEqual({ minor: 12345, decimals: 0, dec: null, thou: ',' });
    expect(parseNumber('0.500')).toEqual({ minor: 500, decimals: 3, dec: '.', thou: null });
    expect(parseNumber('1234.567')).toEqual({ minor: 1234567, decimals: 3, dec: '.', thou: null });
    expect(parseNumber('1.5')).toEqual({ minor: 15, decimals: 1, dec: '.', thou: null });
    expect(parseNumber('1.234.567')).toEqual({ minor: 1234567, decimals: 0, dec: null, thou: '.' });
    expect(parseNumber('1.000.000,50')).toEqual({ minor: 100000050, decimals: 2, dec: ',', thou: '.' });
    expect(parseNumber('42')).toEqual({ minor: 42, decimals: 0, dec: null, thou: null });
    expect(parseNumber('123456789012345')?.minor).toBe(123456789012345);
    // Sixteen digits read back while a double holds them exactly, so the fake of a fifteen-digit amount does. `blind` scales fifteen at most.
    expect(parseNumber('1234567890123456')?.minor).toBe(1234567890123456);
    expect(parseNumber('12345678901234.56')).toEqual({ minor: 1234567890123456, decimals: 2, dec: '.', thou: null });
    expect(parseNumber('9007199254740992')).toBeNull();
    expect(parseNumber(`10${' 000'.repeat(5)}`)).toBeNull();
    expect(parseNumber('12,3x')).toBeNull();
    expect(parseNumber('x12')).toBeNull();
  });

  it('C4/unit: formatNumber groups, pads and keeps the decimal style', () => {
    expect(formatNumber(1234567, 2, ',', '.')).toBe('12.345,67');
    expect(formatNumber(1234567, 2, '.', ',')).toBe('12,345.67');
    expect(formatNumber(5, 2, ',', null)).toBe('0,05');
    expect(formatNumber(100000, 0, null, ',')).toBe('100,000');
    expect(formatNumber(999, 0, null, '.')).toBe('999');
    expect(formatNumber(1000, 0, null, '.')).toBe('1.000');
    expect(formatNumber(12345, 3, null, null)).toBe('12.345');
    expect(formatNumber(-250, 2, ',', null)).toBe('2,50');
  });

  it('C4/unit: detectAmounts finds prefix and suffix currencies in text order, once each', () => {
    const t = 'A 12,50 € B $3.00 C USD 4.25 D 7 euros E 1.234,56 EUR';
    const got = detectAmounts(t);
    expect(got.map((a) => a.raw)).toEqual(['12,50', '3.00', '4.25', '7', '1.234,56']);
    expect(got.map((a) => t.slice(a.fullStart, a.fullEnd))).toEqual(['12,50 €', '$3.00', 'USD 4.25', '7 euros', '1.234,56 EUR']);
    expect(detectAmounts('$5 € 5').map((x) => x.raw)).toEqual(['5', '5']);
    expect(detectAmounts('12,50')).toEqual([]);
    expect(detectAmounts('XUSD 12.00')).toEqual([]);
    expect(detectAmounts('USDX 12.00')).toEqual([]);
    expect(detectAmounts('1,5,6 €')).toEqual([]);
  });

  it('C4/unit: detectPercents keeps values above 0 up to 1000', () => {
    expect(detectPercents('0 % 0,5 % 12,5 % 3.5% 1000 % 1001 % 100 %')).toEqual([0.5, 12.5, 3.5, 1000, 100]);
    expect(detectPercents('a 5 % b 5 %')).toEqual([5, 5]);
    expect(detectPercents('1.5.5 %')).toEqual([]);
  });

  it('C4/unit: amountKey separates the same digits at different precision', () => {
    expect(amountKey({ minor: 2478, decimals: 2 })).toBe('2:2478');
    expect(amountKey({ minor: 2478, decimals: 0 })).not.toBe(amountKey({ minor: 2478, decimals: 2 }));
  });

  it('C4/unit: a derived amount is recomputed from its scaled operands, never scaled on its own', () => {
    const occ = (minor: number, start = 0): ReturnType<typeof detectAmounts>[number] => ({ minor, decimals: 2, dec: ',', thou: '.', start, end: start + 1, fullStart: start, fullEnd: start + 1, raw: String(minor) });
    // sum: 10,00 + 5,50 = 15,50
    const sum = new AmountPlan([[occ(1000), occ(550), occ(1550)]], [[]], 1.337);
    expect(sum.fakeMinor('2:1550')).toBe(sum.fakeMinor('2:1000') + sum.fakeMinor('2:550'));
    // The total must exceed both operands: 5,00 + 5,00 = 10,00 is not "10,00 plus 5,00".
    const notSum = new AmountPlan([[occ(1000), occ(1500), occ(500)]], [[]], 1.5);
    expect(notSum.fakeMinor('2:1500')).toBe(2250);
    // surcharge and percentage of a base
    const sur = new AmountPlan([[occ(20650), occ(24780)]], [[20]], 1.157);
    expect(sur.fakeMinor('2:24780')).toBe(Math.round((sur.fakeMinor('2:20650') * 120) / 100));
    const pct = new AmountPlan([[occ(20650), occ(4130)]], [[20]], 1.157);
    expect(pct.fakeMinor('2:4130')).toBe(Math.round((pct.fakeMinor('2:20650') * 20) / 100));
    // Without a percentage in the text a surcharge is not assumed.
    const none = new AmountPlan([[occ(20650), occ(24780)]], [[]], 1.157);
    expect(none.fakeMinor('2:24780')).toBe(Math.round(24780 * 1.157));
    // A positive amount never scales to zero.
    expect(new AmountPlan([[occ(1)]], [[]], 0.6).fakeMinor('2:1')).toBe(1);
    expect(new AmountPlan([[occ(0)]], [[]], 0.6).fakeMinor('2:0')).toBe(0);
    // A relation needs a nonzero operand.
    const zero = new AmountPlan([[occ(0), occ(500), occ(500)]], [[]], 1.2);
    expect(zero.fakeMinor('2:500')).toBe(600);
  });

  it('C4/unit: a tolerance of one unit in the last digit still counts as a relation', () => {
    // 10,05 * 1.05 = 10.5525, written as 10,55: one cent off, still a surcharge.
    const o = (minor: number): ReturnType<typeof detectAmounts>[number] => ({ minor, decimals: 2, dec: ',', thou: null, start: 0, end: 1, fullStart: 0, fullEnd: 1, raw: '' });
    const plan = new AmountPlan([[o(1005), o(1055)]], [[5]], 1.3);
    expect(plan.fakeMinor('2:1055')).toBe(Math.round((plan.fakeMinor('2:1005') / 100) * 1.05 * 100));
  });

  it('C4/unit: a total one unit off the sum of its parts stays one unit off, and a percentage is rounded afresh', () => {
    const o = (minor: number): ReturnType<typeof detectAmounts>[number] => ({ minor, decimals: 0, dec: null, thou: ',', start: 0, end: 1, fullStart: 0, fullEnd: 1, raw: '' });
    // 9,999 is 4,999 + 5,000 and 10,000 is the same sum read with a tolerance of one unit.
    const plan = new AmountPlan([[o(4999), o(5000), o(9999), o(10000)]], [[]], 1.533);
    const parts = plan.fakeMinor('0:4999') + plan.fakeMinor('0:5000');
    expect(plan.fakeMinor('0:9999')).toBe(parts);
    expect(plan.fakeMinor('0:10000')).toBe(parts + 1);
    // 10,05 * 1.05 = 10.5525: 10,54 and 10,55 both read as the surcharge, rounded afresh to one fake.
    // One keeps the relation, the other is scaled on its own, so the two fakes differ.
    const c = (minor: number): ReturnType<typeof detectAmounts>[number] => ({ ...o(minor), decimals: 2 });
    const sur = new AmountPlan([[c(1005), c(1054), c(1055)]], [[5]], 1.3);
    const exact = Math.round((sur.fakeMinor('2:1005') / 100) * 1.05 * 100);
    const [a, b] = [sur.fakeMinor('2:1054'), sur.fakeMinor('2:1055')];
    expect(a).not.toBe(b);
    expect([a, b]).toContain(exact);
    expect(Math.abs(a - 1054 * 1.3)).toBeLessThanOrEqual(2);
    expect(Math.abs(b - 1055 * 1.3)).toBeLessThanOrEqual(2);
  });

  it('C1/unit: no two amounts get one fake, and a clash moves an independent amount to the free fake nearest its scaled value', () => {
    const o = (minor: number): ReturnType<typeof detectAmounts>[number] => ({ minor, decimals: 2, dec: ',', thou: null, start: 0, end: 1, fullStart: 0, fullEnd: 1, raw: '' });
    // 0,01 and 0,02 at 0.6 both round to 0,01.
    const small = new AmountPlan([[o(1), o(2)]], [[]], 0.6);
    expect([small.fakeMinor('2:1'), small.fakeMinor('2:2')]).toEqual([1, 2]);
    // A fake an earlier turn gave out stays taken.
    const pinned = new AmountPlan([[o(1000)]], [[]], 1.5, new Map([['2:999', 1500]]));
    expect(pinned.fakeMinor('2:999')).toBe(1500);
    expect(pinned.fakeMinor('2:1000')).toBe(1501);
    // A derived amount cannot move: the independent amount it clashes with moves instead, here the smaller one.
    const low = new AmountPlan([[o(1000), o(550), o(1550), o(1549)]], [[]], 0.628);
    expect(low.fakeMinor('2:1550')).toBe(low.fakeMinor('2:1000') + low.fakeMinor('2:550'));
    expect(low.fakeMinor('2:1549')).toBe(972);
    // A derived amount on an earlier turn's fake: one of its operands moves, and the sum still holds.
    const operand = new AmountPlan([[o(1000), o(550), o(1550)]], [[]], 1.337, new Map([['2:9999', 2072]]));
    expect(operand.fakeMinor('2:1000')).toBe(1338);
    expect(operand.fakeMinor('2:1550')).toBe(1338 + 735);
    // With every operand pinned too, the derived amount is scaled on its own and moved.
    const loose = new AmountPlan([[o(1000), o(550), o(1550)]], [[]], 1.337, new Map([['2:1000', 1337], ['2:550', 735], ['2:9999', 2072]]));
    expect(loose.fakeMinor('2:1550')).toBe(2073);
    // Many amounts one cent apart, for many factors: every fake differs and stays within a few cents.
    const keys = Array.from({ length: 12 }, (_, i) => 49_990 + i);
    for (let f = 0.6; f <= 1.6; f += 0.0137) {
      const plan = new AmountPlan([keys.map(o)], [[]], f);
      const fakes = keys.map((k) => plan.fakeMinor(`2:${k}`));
      expect(new Set(fakes).size, `factor ${f}`).toBe(keys.length);
      keys.forEach((k, i) => expect(Math.abs((fakes[i] as number) - k * f), `factor ${f}`).toBeLessThanOrEqual(5));
    }
  });

  it('C4/unit: a chain base, tax, total keeps both steps after scaling, for many seeds', () => {
    for (let i = 0; i < 40; i++) {
      const r = blind(['Base 1.000,00 €. IVA 21 %: 210,00 €. Total 1.210,00 €.'], { seed: `chain${i}` });
      const [b, v, t] = detectAmounts(r.texts[0]!).map((a) => a.minor);
      expect(t).toBe(b! + v!);
      expect(Math.abs(v! * 100 - b! * 21)).toBeLessThanOrEqual(50);
    }
  });

  it('C4/unit: only the first 60 distinct amounts are searched for relations', () => {
    const amounts = Array.from({ length: 70 }, (_, i) => `${100 + i * 7},00 €`);
    const r = blind([`10 % 5 % ${amounts.join(' ')}`], { seed: 'many' });
    expect(detectAmounts(r.texts[0]!)).toHaveLength(70);
  });
});

describe('amount spellings', () => {
  const o = (written: string): ParsedNumber => parseNumber(foldLookalikes(written)) as ParsedNumber;
  /** The fakes freeAmountFake hands out in turn when each one it gave is then taken. */
  const turns = (minor: number, written: string, n: number): string[] => {
    const taken = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = freeAmountFake(minor, o(written), written, null, (x) => taken.has(x));
      out.push(f);
      taken.add(f);
    }
    return out;
  };

  it('reads repeated or three-digit groups as thousands, and refuses anything but digits around the marks', () => {
    expect(parseNumber('123.456')).toEqual({ minor: 123456, decimals: 0, dec: null, thou: '.' });
    expect(parseNumber('1.23.45')).toEqual({ minor: 12345, decimals: 0, dec: null, thou: '.' });
    expect(parseNumber('1234.567')).toEqual({ minor: 1234567, decimals: 3, dec: '.', thou: null });
    expect(parseNumber('a12')).toBeNull();
    expect(parseNumber('12a')).toBeNull();
    expect(parseNumber('12,3a')).toBeNull();
    expect(formatNumber(1234567, 0, null, '.')).toBe('1.234.567');
    expect(detectAmounts('EUR 9999999999999999')).toEqual([]);
    expect(amountDetector.detect('EUR 1234567890123456 y EUR 123456789012345', { dateOrder: 'dmy', isAllowedHost: () => false }).map((a) => a.end - a.start)).toEqual([15]);
  });

  it('writes a fake in the full-width habit of the spelling, digits and separators each in turn', () => {
    const cents = o('12,34');
    expect(freeAmountFake(5678, cents, '12,34', null, () => false)).toBe('56,78');
    expect(freeAmountFake(5678, cents, '\uff11\uff12,\uff13\uff14', null, () => false)).toBe('\uff15\uff16,\uff17\uff18');
    expect(freeAmountFake(5678, cents, '1\uff12,34', null, () => false)).toBe('5\uff16,78');
    expect(freeAmountFake(5678, cents, '12\uff0c34', null, () => false)).toBe('56\uff0c78');
    // Any full-width form counts as a full-width separator, from the first to the last.
    expect(freeAmountFake(5678, cents, '12\uff0134', null, () => false)).toBe('56\uff0c78');
    expect(freeAmountFake(5678, cents, '12\uff5e34', null, () => false)).toBe('56\uff0c78');
    expect(freeAmountFake(5678, cents, '12\uff5f34', null, () => false)).toBe('56,78');
    expect(freeAmountFake(123456, o('1234,56'), '1234,56', '.', () => false)).toBe('1.234,56');
  });

  it('when a rendering is taken, writes the same value another way: other marks, two decimals, full-width, then digit by digit', () => {
    expect(turns(1234, '12,34', 8)).toEqual(['12,34', '12.34', '\uff11\uff12,\uff13\uff14', '\uff11\uff12.\uff13\uff14', '\uff112,34', '1\uff12,34', '\uff11\uff12,34', '12,\uff134']);
    expect(turns(7, '7', 6)).toEqual(['7', '7.00', '7,00', '\uff17', '\uff17.\uff10\uff10', '\uff17,\uff10\uff10']);
    expect(turns(75, '7,5', 4)).toEqual(['7,5', '7.5', '7,50', '7.50']);
    expect(turns(123456, '1.234,56', 4)).toEqual(['1.234,56', '1234,56', '1234.56', '1,234.56']);
    const many = turns(1234, '12,34', 24);
    expect(new Set(many).size).toBe(24);
    for (const f of many) expect(parseNumber(foldLookalikes(f))).toMatchObject({ minor: 1234, decimals: 2 });
  });

  it('when no other rendering reads back as the same value, the plain one is returned', () => {
    // 1,001 with three decimals: every other way to write it reads as one thousand and one.
    expect(freeAmountFake(1001, o('1234,567'), '1234,567', null, (x) => x === '1,001')).toBe('1,001');
  });
});

describe('date spellings', () => {
  const turns = (written: string, n: number, order: 'dmy' | 'mdy' = 'dmy'): string[] => {
    const o = (detectDates(written, order)[0] as { occ: DateOcc }).occ;
    const taken = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const f = freeDateFake(o, order, (x) => taken.has(x));
      out.push(f);
      taken.add(f);
    }
    return out;
  };

  it('when a rendering is taken, writes the same date another way, fewest changes first, and only ways that read back as that date', () => {
    expect(turns('03/04/2026', 11)).toEqual(['03/04/2026', '3/4/2026', '03-04-2026', '03.04.2026', '03/04/26', '3-4-2026', '3.4.2026', '3/4/26', '03-04-26', '3-4-26', '03/04/2026']);
    expect(turns('03/04/26', 4)).toEqual(['03/04/26', '3/4/26', '03-04-26', '03/04/2026']);
    expect(turns('3 de marzo de 2026', 7)).toEqual(['3 de marzo de 2026', '3\u00ba de marzo de 2026', '3\u00b0 de marzo de 2026', '3 de marzo del 2026', '3\u00ba de marzo del 2026', '3\u00b0 de marzo del 2026', '3 de marzo de 2026']);
    expect(turns('3\u00ba de marzo', 4)).toEqual(['3\u00ba de marzo', '3 de marzo', '3\u00b0 de marzo', '3\u00ba de marzo']);
    expect(turns('March 3rd, 2026', 6, 'mdy')).toEqual(['March 3rd, 2026', 'March 3, 2026', 'March 3rd 2026', 'March. 3rd, 2026', '3rd March, 2026', 'March 3 2026']);
    expect(turns('3 March 2026', 6)).toEqual(['3 March 2026', '3rd March 2026', '3 March, 2026', '3 March. 2026', '3 of March 2026', 'March 3 2026']);
  });
});

describe('dates', () => {
  const found = (t: string, order: 'dmy' | 'mdy' = 'dmy'): Array<[string, number, number, number | null]> =>
    detectDates(t, order).map((d) => [t.slice(d.start, d.end), d.occ.m, d.occ.d, d.occ.y]);

  it('C5/unit: ISO dates must be real days between 1900 and 2200', () => {
    expect(found('2026-03-18')).toEqual([['2026-03-18', 3, 18, 2026]]);
    expect(found('1900-01-01')).toHaveLength(1);
    expect(found('2200-12-31')).toHaveLength(1);
    expect(found('1899-12-31')).toEqual([]);
    expect(found('2201-01-01')).toEqual([]);
    expect(found('2026-02-30')).toEqual([]);
    expect(found('2026-13-01')).toEqual([]);
    expect(found('2026-00-10')).toEqual([]);
    expect(found('2026-01-00')).toEqual([]);
    expect(found('2024-02-29')).toHaveLength(1);
    expect(found('2026-02-29')).toEqual([]);
    expect(found('12026-03-18')).toEqual([]);
  });

  it('C5/unit: numeric dates follow the order, swap when only one reading works, and need a 4-digit year after dots', () => {
    expect(found('05/06/2026')).toEqual([['05/06/2026', 6, 5, 2026]]);
    expect(found('05/06/2026', 'mdy')).toEqual([['05/06/2026', 5, 6, 2026]]);
    expect(found('03/25/2026')[0]).toEqual(['03/25/2026', 3, 25, 2026]);
    expect(found('25/03/2026', 'mdy')[0]).toEqual(['25/03/2026', 3, 25, 2026]);
    expect(found('31/04/2026')).toEqual([]);
    expect(found('12.05.2026')).toHaveLength(1);
    expect(found('12.05.26')).toEqual([]);
    expect(found('5-6-26')).toEqual([['5-6-26', 6, 5, 2026]]);
    expect(found('13/13/2026')).toEqual([]);
    expect(found('12/12/2026')).toHaveLength(1);
    const unpadded = detectDates('5/6/2026', 'dmy')[0]!.occ.fmt;
    expect(unpadded.pad).toBe(false);
    expect(detectDates('05/06/2026', 'dmy')[0]!.occ.fmt.pad).toBe(true);
    expect(detectDates('05/6/2026', 'dmy')[0]!.occ.fmt.pad).toBe(false);
    expect(detectDates('05/06/26', 'dmy')[0]!.occ.fmt.yearDigits).toBe(2);
    expect(detectDates('05/06/2026', 'dmy')[0]!.occ.fmt.yearDigits).toBe(4);
    expect(detectDates('05/06/2026', 'dmy')[0]!.occ.fmt.order).toBe('dmy');
    expect(detectDates('03/25/2026', 'dmy')[0]!.occ.fmt.order).toBe('mdy');
    expect(detectDates('25/03/2026', 'mdy')[0]!.occ.fmt.order).toBe('dmy');
  });

  it('C5/unit: English month names, short forms, ordinals and the year', () => {
    expect(found('March 18, 2026')).toEqual([['March 18, 2026', 3, 18, 2026]]);
    expect(found('Mar 5')).toEqual([['Mar 5', 3, 5, null]]);
    expect(found('mar 5 items')).toEqual([]);
    expect(found('march 5')).toHaveLength(1);
    expect(found('Sept. 5th, 2026')).toEqual([['Sept. 5th, 2026', 9, 5, 2026]]);
    expect(found('5th of March 2026')).toEqual([['5th of March 2026', 3, 5, 2026]]);
    expect(found('18 March')).toEqual([['18 March', 3, 18, null]]);
    expect(found('February 30, 2026')).toEqual([]);
    expect(found('30 February 2026')).toEqual([]);
    expect(found('Feb 29, 2024')).toHaveLength(1);
    expect(found('Marching 5')).toEqual([]);
    const fmt = (t: string): ReturnType<typeof detectDates>[number]['occ']['fmt'] => detectDates(t, 'dmy')[0]!.occ.fmt;
    expect(fmt('MARCH 5, 2026').monthCase).toBe('upper');
    expect(fmt('march 5, 2026').monthCase).toBe('lower');
    expect(fmt('March 5, 2026').monthCase).toBe('cap');
    expect(fmt('Mar 5').abbrev).toBe(3);
    expect(fmt('Sept 5').abbrev).toBe(4);
    expect(fmt('March 5').abbrev).toBe(0);
    expect(fmt('March 5th').ordinal).toBe(true);
    expect(fmt('March 5, 2026').comma).toBe(true);
    expect(fmt('March 5 2026').comma).toBe(false);
    expect(fmt('Mar. 5').dot).toBe(true);
    expect(fmt('5th of March').of).toBe(true);
    expect(fmt('5 March').of).toBe(false);
    expect(fmt('5 March, 2026').comma).toBe(true);
    expect(fmt('5 Mar. 2026').dot).toBe(true);
  });

  it('C5/unit: Spanish dates with de, del, an ordinal sign and no year', () => {
    expect(found('18 de marzo de 2026')).toEqual([['18 de marzo de 2026', 3, 18, 2026]]);
    expect(found('6 de octubre del 2026')).toEqual([['6 de octubre del 2026', 10, 6, 2026]]);
    expect(found('1º de abril')).toEqual([['1º de abril', 4, 1, null]]);
    expect(found('30 de febrero de 2026')).toEqual([]);
    expect(found('18 DE MARZO')).toHaveLength(1);
    expect(detectDates('6 de octubre del 2026', 'dmy')[0]!.occ.fmt.yearLink).toBe('del');
    expect(detectDates('6 de octubre de 2026', 'dmy')[0]!.occ.fmt.yearLink).toBe('de');
    expect(detectDates('1º de abril', 'dmy')[0]!.occ.fmt.ordSign).toBe('º');
    expect(detectDates('18 de MARZO', 'dmy')[0]!.occ.fmt.monthCase).toBe('upper');
    expect(detectDates('18 de marzo', 'dmy')[0]!.occ.fmt.monthCase).toBe('lower');
  });

  it('C5/unit: shiftYmd crosses months, years and leap days in both directions', () => {
    expect(shiftYmd(2024, 2, 28, 1)).toEqual({ y: 2024, m: 2, d: 29 });
    expect(shiftYmd(2024, 2, 28, 2)).toEqual({ y: 2024, m: 3, d: 1 });
    expect(shiftYmd(2025, 2, 28, 1)).toEqual({ y: 2025, m: 3, d: 1 });
    expect(shiftYmd(2026, 12, 30, 7)).toEqual({ y: 2027, m: 1, d: 6 });
    expect(shiftYmd(2026, 1, 3, -7)).toEqual({ y: 2025, m: 12, d: 27 });
    expect(shiftYmd(2026, 3, 18, 0)).toEqual({ y: 2026, m: 3, d: 18 });
    expect(shiftYmd(50, 3, 1, 7)).toEqual({ y: 50, m: 3, d: 8 });
  });

  it('C5/unit: shiftOcc keeps the format and leaves a missing year missing', () => {
    const base = detectDates('30 de diciembre', 'dmy')[0]!.occ;
    const moved = shiftOcc(base, 7, 2026);
    expect([moved.m, moved.d, moved.y]).toEqual([1, 6, null]);
    expect(renderDate(moved)).toBe('6 de enero');
    const dated = shiftOcc(detectDates('30 de diciembre de 2026', 'dmy')[0]!.occ, 7, 1999);
    expect(renderDate(dated)).toBe('6 de enero de 2027');
    // A yearless leap day uses the reference year.
    const leap = shiftOcc({ ...base, m: 2, d: 28 }, 1, 2024);
    expect([leap.m, leap.d]).toEqual([2, 29]);
    const noLeap = shiftOcc({ ...base, m: 2, d: 28 }, 1, 2025);
    expect([noLeap.m, noLeap.d]).toEqual([3, 1]);
  });

  it('C5/unit: renderDate rebuilds every supported format', () => {
    const rt = (t: string, order: 'dmy' | 'mdy' = 'dmy'): string => renderDate(detectDates(t, order)[0]!.occ);
    for (const t of [
      '2026-03-08', '05/06/2026', '5/6/26', '5-6-2026', '12.05.2026', 'March 8, 2026', 'Mar 8 2026', 'Sept. 5th, 2026', 'MARCH 8, 2026',
      'march 8', '8 March 2026', '8th of March, 2026', '8 Mar. 2026', '18 de marzo de 2026', '1º de abril', '6 de octubre del 2026',
    ]) {
      expect(rt(t), t).toBe(t);
    }
    expect(rt('18 DE MARZO')).toBe('18 de MARZO');
    expect(rt('03/25/2026', 'dmy')).toBe('03/25/2026');
    expect(rt('7/4/2026', 'mdy')).toBe('7/4/2026');
  });

  it('C5/unit: ordinals follow English rules, including 11th, 12th and 13th', () => {
    const day = (d: number): string => renderDate({ y: 2026, m: 3, d, fmt: detectDates('March 5th, 2026', 'dmy')[0]!.occ.fmt });
    expect(['1', '2', '3', '4', '11', '12', '13', '21', '22', '23', '24', '30'].map((d) => day(Number(d)).split(' ')[1]!.replace(',', ''))).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '24th', '30th',
    ]);
    const sept: DateOcc = { y: 2026, m: 9, d: 5, fmt: detectDates('Sept 5, 2026', 'dmy')[0]!.occ.fmt };
    expect(renderDate(sept)).toBe('Sept 5, 2026');
    expect(renderDate({ ...sept, m: 3 })).toBe('Mar 5, 2026');
  });

  it('C5/unit: dateKey is stable across spellings and marks a missing year', () => {
    expect(dateKey({ y: 2026, m: 3, d: 8 })).toBe('2026-3-8');
    expect(dateKey({ y: null, m: 3, d: 8 })).toBe('?-3-8');
    expect(dateKey(detectDates('8 March 2026', 'dmy')[0]!.occ)).toBe(dateKey(detectDates('2026-03-08', 'dmy')[0]!.occ));
  });

  it('C5/unit: blind shifts every date by the same whole weeks', () => {
    for (let i = 0; i < 30; i++) {
      const r = blind(['Del 2026-03-02 al 2026-03-20, o sea 18 días.'], { seed: `w${i}` });
      expect(Math.abs(r.mapping.dayShift) % 7).toBe(0);
      expect(r.mapping.dayShift).not.toBe(0);
      expect(Math.abs(r.mapping.dayShift)).toBeLessThanOrEqual(70);
      const [a, b] = detectDates(r.texts[0]!, 'dmy').map((d) => Date.UTC(d.occ.y!, d.occ.m - 1, d.occ.d));
      expect((b! - a!) / 86400000).toBe(18);
    }
  });
});

describe('folds', () => {
  it('C2/unit: foldLookalikes keeps the length and maps look-alike and full-width letters', () => {
    const s = 'АВЕКМНОРСТХаеорсхуіІјѕ';
    expect(foldLookalikes(s)).toBe('ABEKMHOPCTXaeopcxyiIjs');
    expect(foldLookalikes('ΑΒΕΖΗΙΚΜΝΟΡΤΥΧον')).toBe('ABEZHIKMNOPTYXov');
    expect(foldLookalikes('！Ａｚ０９＠～')).toBe('!Az09@~');
    expect(foldLookalikes('＀｟')).toBe('＀｟');
    expect(foldLookalikes('plain ñ text 😀')).toBe('plain ñ text 😀');
    for (const t of [s, 'x😀y', 'más']) expect(foldLookalikes(t)).toHaveLength(t.length);
  });

  it('C2/unit: stripInvisible removes zero-width and bidi marks only', () => {
    expect(stripInvisible('a​b‌c‍d‎e‏f⁠g﻿h‪i‮j')).toBe('abcdefghij');
    expect(stripInvisible('a b c')).toBe('a b c');
  });

  it('C2/unit: skeleton lowers, drops accents, marks and invisibles, and maps back to the original', () => {
    const sk = skeleton('Gestórıa');
    expect(sk.text.startsWith('gestor')).toBe(true);
    const s = skeleton('MÁRÍA x​y');
    expect(s.text).toBe('maria xy');
    expect(s.from).toEqual([0, 1, 2, 3, 5, 6, 7, 9]);
    expect(skeleton('İ').text).toBe('i');
    expect(skeleton('').text).toBe('');
    const wide = skeleton('Å😀z');
    expect(wide.text.endsWith('z')).toBe(true);
    expect(wide.from[wide.from.length - 1]).toBe(3);
  });

  it('C2/unit: a Greek nu beside a Greek letter is kept, and a folded Cyrillic or Greek word and its capitals have one skeleton', () => {
    expect(foldLookalikes('νisa')).toBe('visa');
    expect(foldLookalikes('Γιάννης')).toBe('Γιάννης');
    const key = (s: string): string => skeleton(foldLookalikes(s)).text;
    for (const w of ['Иван Петров', 'Газпромбанк', 'Ли На', 'Γιάννης Παπαδόπουλος', 'Αλφαβητική Τράπεζα']) {
      expect(key(w.toUpperCase()), w).toBe(key(w));
      expect(key(w.toLowerCase()), w).toBe(key(w));
    }
    // Look-alikes still meet the Latin letters they imitate.
    expect(key('Маrcо')).toBe('marco');
    expect(foldLookalikes('Иван Петров')).toHaveLength('Иван Петров'.length);
  });

  it('skeleton puts Hangul written as jamo back into syllables, the same ones NFC gives, mapped to where each began', () => {
    const cases = ['\u1100\u1161', '\u1112\u1175\u11c2', '\u1100\u1161\u11a8x', 'a\u1109\u1165\u11af\u1100\u1175'];
    for (const t of cases) expect(skeleton(t).text, JSON.stringify(t)).toBe(t.normalize('NFC').toLowerCase());
    expect(skeleton('\u1100\u1161').from).toEqual([0]);
    expect(skeleton('\u1112\u1175\u11c2').from).toEqual([0]);
    expect(skeleton('a\u1109\u1165\u11af\u1100\u1175').from).toEqual([0, 1, 4]);
    // A syllable with no final consonant takes a final jamo after it, one that has a final keeps it.
    expect(skeleton('\uac00\u11a8')).toEqual({ text: '\uac01', from: [0] });
    expect(skeleton('\uac01\u11a8')).toEqual({ text: '\uac01\u11a8', from: [0, 1] });
    expect(skeleton('\ud7a3')).toEqual({ text: '\ud7a3', from: [0] });
    expect(skeleton('\uac1c\u11a8')).toEqual({ text: '\uac1d', from: [0] });
    // A whole syllable followed by a vowel jamo is not a lead, so the two stay apart.
    expect(skeleton('\uac00\u1161')).toEqual({ text: '\uac00\u1161', from: [0, 1] });
  });

  it('skeleton leaves jamo outside the modern ranges, and a lead jamo with no vowel, as they are', () => {
    for (const t of ['\u1100x', '\u1113\u1161', '\u10ff\u1161', '\u1100\u1160', '\u1100\u1176', '\uac00\u11a7', '\uac00\u11c3', '\ud7a4\u11a8', '\u11a8']) {
      expect(skeleton(t).text, JSON.stringify(t)).toBe(t);
    }
    expect(skeleton('\u1100x').from).toEqual([0, 1]);
    expect(skeleton('x\u200b\u1100').from).toEqual([0, 2]);
  });

  it('visibleOffsets gives the offset in the original of every character that is not invisible', () => {
    expect(visibleOffsets('a\u200bb\u202ec')).toEqual([0, 2, 4]);
    expect(visibleOffsets('abc')).toEqual([0, 1, 2]);
    expect(visibleOffsets('\ufeff')).toEqual([]);
  });

  it('a BlindError carries its kind and the name BlindError', () => {
    const e = new BlindError('internal', 'blind: x');
    expect(e.name).toBe('BlindError');
    expect(e.kind).toBe('internal');
    expect(String(e)).toBe('BlindError: blind: x');
  });

  it('C2/unit: a name with a combining accent or a hidden character is found and replaced whole', () => {
    const r = blind(['Hola María García y A​na.'], { known: [{ kind: 'person', value: 'María García' }, { kind: 'person', value: 'Ana' }], seed: 'f' });
    expect(r.texts[0]).not.toMatch(/Mar|Gar|Ana|́|​/);
    expect(r.leaks.ok).toBe(true);
  });

  it('C1/unit: a value written with other scripts, full-width forms or hidden characters comes back as written', () => {
    // Detection reads the folded text. The pair log must still hold the span as typed, or unblind would return Latin look-alikes.
    const cases: Array<[string, KnownValue[]]> = [
      ['From: Сергей Петров <sergei@petrov-consult.example>', []],
      ['From: Νίκος Παπαδόπουλος <nikos@papadopoulos.example>', []],
      ['Total a pagar: ２４７,８０ € antes del 2026-03-01.', []],
      ['Hola A\u200bna Ru\u200biz, tu móvil +34 ７９１ ３４５ ６７８ y el IBAN ' + ES_IBAN.replace('E', '\u0415') + '.', [{ kind: 'person', value: 'Ana Ruiz' }]],
      ['Hola Аna Ruіz, factura ＦＡＣ-２０２６-０１２.', [{ kind: 'person', value: 'Ana Ruiz' }]],
    ];
    for (const [text, known] of cases) {
      const r = blind([text], { known, seed: 'as-written' });
      expect(r.texts[0], text).not.toMatch(/Сергей|Петров|Νίκος|２４７|Ruiz|７９１|ЕS91|ＦＡＣ|\u200b/u);
      expect(unblind(r.texts[0] as string, r.mapping).text, text).toBe(text);
    }
  });
});

describe('C36: errors and long or odd input', () => {
  // Every input is synthetic: runs of letters, digits, symbols and scripts.
  const longToken = 'a1'.repeat(5000);
  const token20k = 'Zq7'.repeat(6667).slice(0, 20000);
  const id8k = 'K9x'.repeat(2667).slice(0, 8000);
  const meta = String.raw`a(b[c\d*e?f`;
  const mixed = 'Lumo 東京駅 مرحبا ١٢٣ Ωmega １２３４５６７８ ';

  const cases: Array<{ name: string; text: string; known?: KnownValue[]; deny?: string[] }> = [
    { name: 'a long token', text: `x ${longToken}` },
    { name: 'a 20,000-character token', text: `x ${token20k} y` },
    { name: 'a known id of 8,000 characters', text: `ref ${id8k} end`, known: [{ kind: 'id', value: id8k }] },
    { name: 'a known phone of 8,000 digits', text: `tel ${'5'.repeat(8000)}`, known: [{ kind: 'phone', value: '5'.repeat(8000) }] },
    { name: 'a known org of 20,000 characters', text: `at ${token20k}.`, known: [{ kind: 'org', value: token20k }] },
    { name: 'regex metacharacters', text: `${meta.repeat(2000)} ( [ \\ * ? ${'('.repeat(9000)}${'['.repeat(9000)}${'\\'.repeat(9000)}` },
    { name: 'known values made of metacharacters', text: `${meta} and ${'(*?7'.repeat(2000)}`, known: [{ kind: 'org', value: meta }, { kind: 'person', value: 'Vexa (*?' }, { kind: 'id', value: '(*?7'.repeat(2000) }] },
    // An id with no letter or digit has nothing to fake, so blind refuses it with its own error.
    { name: 'a known id with no letter or digit', text: `ref ${'(*?'.repeat(30)} end`, known: [{ kind: 'id', value: '(*?'.repeat(30) }] },
    { name: '50,000 spaces', text: `Lumo${' '.repeat(50000)}Vexa <lumo@vexa.example>` },
    { name: '50,000 mixed whitespace characters', text: `a${'\t\n  　'.repeat(10000)}b` },
    { name: 'mixed scripts', text: mixed.repeat(2000), known: [{ kind: 'org', value: '東京駅'.repeat(3000) }, { kind: 'person', value: 'مرحبا Ωmega' }] },
    { name: 'full-width digits', text: `n ${'１２３４５６７８９０'.repeat(2000)}`, known: [{ kind: 'phone', value: '１２３４５６７８９０'.repeat(800) }] },
    { name: 'long deny entries', text: `mail q@${'d'.repeat(9000)}.example`, deny: ['*@' + 'd'.repeat(9000) + '.example', 'z9'.repeat(5000)] },
  ];

  for (const c of cases) {
    it(`C36: ${c.name} goes through blind and unblind, any error quoting none of it`, () => {
      const inputs = [c.text, ...(c.known ?? []).map((k) => k.value), ...(c.deny ?? [])];
      for (const known of c.known ? [undefined, c.known] : [undefined]) {
        let r;
        try {
          r = blind([c.text], { seed: 'c32', known, deny: c.deny });
        } catch (e) {
          expect(quotes(String((e as Error).message), inputs)).toBe(false);
          continue;
        }
        const text = r.texts[0] as string;
        expect(unblind(text, r.mapping).text).toBe(c.text);
        const u = createUnblinder(r.mapping);
        let streamed = '';
        for (let i = 0; i < text.length; i += 4999) streamed += u.push(text.slice(i, i + 4999));
        streamed += u.end().text;
        expect(streamed).toBe(c.text);
      }
    }, 60_000);
  }

  it('C36: a long token, a 20,000-character token and an 8,000-character known id return normally', () => {
    for (const c of cases.slice(0, 3)) expect(() => blind([c.text], { seed: 'c32', known: c.known })).not.toThrow();
  }, 60_000);

  it('C36: an error inside a stage names the stage, never the text', () => {
    const secret = 'Orvane Kelpstrom 7731-QZ';
    const throwing = { name: 'boom', detect: (t: string): never => { throw new SyntaxError(`bad: ${t}`); } };
    expect(() => blind([secret], { detectors: [throwing] })).toThrow(/^blind: internal error while detecting values$/);
    const r = blind([`Write to Orvane Kelpstrom <orvane@kelp.example>`], { seed: 'c32' });
    const broken = { ...r.mapping, pairs: r.mapping.pairs.map((p) => ({ ...p, fake: { toString: () => { throw new Error(secret); } } as unknown as string })) };
    for (const run of [() => unblind(secret, broken), () => createUnblinder(broken)]) {
      try {
        run();
      } catch (e) {
        expect((e as Error).message).toBe('blind: the mapping is not valid (pairs[0])');
        expect(quotes((e as Error).message, [secret])).toBe(false);
      }
    }
    expect(() => checkLeaks(input({ outputs: [secret], originals: [{ kind: 'id', value: null as unknown as string }] }))).toThrow(/^blind: internal error while checking for leaks$/);
  });

  it('C36: blind\'s own errors keep their message', () => {
    expect(() => blind(['x'], { replaceWith: 'nope' as never })).toThrow(/^blind: replaceWith must be one of/);
    const u = createUnblinder(blind(['x'], { seed: 'c32' }).mapping);
    u.end();
    expect(() => u.end()).toThrow('unblind: end called twice');
  });

  it('C36: a value too long for one pattern is matched the same way as one that fits', () => {
    // Cut patterns against one engine pattern, for values long enough to be cut but short enough to compile whole.
    const sep = String.raw`[\s.\-()]*`;
    const seps = ['', ' ', '-', '.', '(', ')', ' - ', ':'];
    const rng = new Rng('c32-pieces');
    for (let run = 0; run < 40; run++) {
      const len = 257 + rng.int(900);
      const chars = Array.from({ length: len }, () => 'abcXYZ0129'[rng.int(10)] as string);
      const spread = chars.map((ch, i) => (i === 0 ? ch : (seps[rng.int(seps.length)] as string) + (rng.int(2) ? ch.toUpperCase() : ch))).join('');
      const text = ['', 'x', ' ', 'z9 '][rng.int(4)] + spread + [' ', '', 'q', '.'][rng.int(4)] + spread.slice(0, rng.int(spread.length)) + ' ' + spread;
      const want = [...text.matchAll(new RegExp(String.raw`(?<![A-Za-z0-9])${chars.join(sep)}(?![A-Za-z0-9])`, 'gi'))].map((m) => [m.index, m.index + m[0].length]);
      expect(matchAlternatives(text, [flexAtoms(chars, sep)], '(?<![A-Za-z0-9])', '(?![A-Za-z0-9])', 'i')).toEqual(want);
      const word = chars.join('');
      const names = [word, word.slice(0, 300), word.slice(0, 280)];
      const prose = `${word} ${word.slice(0, 300)}x ${word.slice(0, 280)} ${word.toUpperCase()}`;
      const whole = [...prose.matchAll(new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${names.join('|')})(?![\p{L}\p{N}_])`, 'giu'))].map((m) => [m.index, m.index + m[0].length]);
      expect(matchAlternatives(prose, names.map(literalAtoms), String.raw`(?<![\p{L}\p{N}_])`, String.raw`(?![\p{L}\p{N}_])`, 'iu')).toEqual(whole);
    }
  });
});

describe('C42: blind\'s own errors are told apart by class, not by message', () => {
  // Synthetic private text. A forged error carries it after a blind: or unblind: prefix.
  const secret = 'Orvane Kelpstrom private-marker-4821';
  const stage = /^blind: internal error while detecting values$/;
  const thrower = (make: (t: string) => unknown) => ({ name: 'forger', detect: (t: string): never => { throw make(t); } });

  it('C42: a detector that throws an Error with a blind: or unblind: prefix is wrapped, the text dropped', () => {
    const makes: Array<(t: string) => unknown> = [
      (t) => new Error(`blind: ${t}`),
      (t) => new Error(`unblind: ${t}`),
      (t) => new TypeError(`blind: ${t}`),
      (t) => Object.assign(new Error(`blind: ${t}`), { name: 'BlindError', kind: 'internal' }),
    ];
    for (const make of makes) {
      let caught: unknown;
      try {
        blind([secret], { detectors: [thrower(make)] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(BlindError);
      expect((caught as BlindError).message).toMatch(stage);
      expect((caught as BlindError).kind).toBe('internal');
      expect(quotes((caught as Error).message, [secret])).toBe(false);
    }
  });

  it('C42: a thrown non-Error with a blind: prefix in its message is wrapped, the text dropped', () => {
    for (const make of [(t: string) => ({ message: `blind: ${t}` }), (t: string) => `blind: ${t}`, (t: string) => ({ name: 'BlindError', kind: 'leak', message: `blind: ${t}` })]) {
      let caught: unknown;
      try {
        blind([secret], { detectors: [thrower(make)] });
      } catch (e) {
        caught = e;
      }
      expect((caught as Error).message).toMatch(stage);
      expect(quotes(String((caught as Error).message), [secret])).toBe(false);
    }
  });

  it('C42: blind\'s own errors still pass through with their message and kind', () => {
    const own = (run: () => unknown): BlindError => {
      try {
        run();
      } catch (e) {
        expect(e).toBeInstanceOf(BlindError);
        return e as BlindError;
      }
      throw new Error('expected a throw');
    };
    const short = own(() => blind(['Write to Q today'], { known: [{ kind: 'person', value: 'Q' }] }));
    expect(short.message).toBe('blind: known entry 0 (person) is too short to find or check; give at least two characters');
    expect(short.kind).toBe('invalid-known');

    const large = own(() => blind(['short', 'x'.repeat(20)], { maxTextLength: 10 }));
    expect(large).toBeInstanceOf(InputTooLargeError);
    expect(large.kind).toBe('input-too-large');
    expect(large.message).toBe('blind: input-too-large (text 1 is 20 UTF-16 units, the limit is 10)');

    const r = blind(['Call Orvane Kelpstrom today'], { seed: 'c42', deny: ['today'] });
    const leak = own(() => assertNoLeaks(r));
    expect(leak).toBeInstanceOf(LeakError);
    expect(leak.kind).toBe('leak');
    expect(leak.message).toMatch(/^blind: \d+ leak\(s\) in text 0 \(kinds: /);

    const option = own(() => blind(['x'], { replaceWith: 'nope' as never }));
    expect(option.kind).toBe('invalid-option');
    expect(option.message).toMatch(/^blind: replaceWith must be one of/);

    const u = createUnblinder(blind(['x'], { seed: 'c42' }).mapping);
    u.end();
    const closed = own(() => u.push('y'));
    expect(closed.kind).toBe('stream-closed');
    expect(closed.message).toBe('unblind: push after end');

    const mapping = own(() => blind(['x'], { mapping: { version: 2 } as never }));
    expect(mapping.kind).toBe('invalid-mapping');
    expect(mapping.message).toBe('blind: the mapping is not valid (version)');
  });

  const caughtFrom = (detector: { name: string; detect: (t: string) => never }, text = secret): BlindError => {
    try {
      blind([text], { detectors: [detector] });
    } catch (e) {
      expect(e).toBeInstanceOf(BlindError);
      return e as BlindError;
    }
    throw new Error('expected a throw');
  };

  it('C42: a detector that throws a BlindError carrying the text is wrapped: the stage and kind remain, the text is dropped', () => {
    const own = new BlindError('internal', secret);
    const caught = caughtFrom(thrower(() => own));
    expect(caught).not.toBe(own);
    expect(caught.kind).toBe('internal');
    expect(caught.message).toBe('blind: detector error while detecting values (internal)');
    expect(caught.stack ?? '').not.toContain(secret.slice(0, 8));
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(quotes(caught.message, [secret])).toBe(false);
  });

  it('C42: a detector\'s BlindError reaches the caller only as its kind, never as thrown', () => {
    // This case once asserted the detector's BlindError passed through unchanged. Now only its kind does.
    const own = new BlindError('detector-not-prepared', `my-detector: text was not prepared: ${secret}`);
    const caught = caughtFrom(thrower(() => own));
    expect(caught).not.toBe(own);
    expect(caught.kind).toBe('detector-not-prepared');
    expect(caught.message).toBe('blind: detector error while detecting values (detector-not-prepared)');
    expect(caught.message).not.toContain('my-detector');
    expect(quotes(caught.message, [secret])).toBe(false);
  });

  it('C42: a BlindError whose kind is not one of blind\'s is wrapped as internal, the kind not quoted', () => {
    const own = Object.assign(new BlindError('internal', 'x'), { kind: secret });
    const caught = caughtFrom(thrower(() => own));
    expect(caught.kind).toBe('internal');
    expect(caught.message).toBe('blind: detector error while detecting values (internal)');
  });
});
