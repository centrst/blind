/**
 * The `replaceWith` modes beside `fake`: numbered placeholders and unrelated
 * random values. Every name, company, amount and number below is invented.
 */
import { describe, expect, it } from 'vitest';
import { detectAmounts, type AmountOcc } from '../src/amounts.js';
import { detectDates, type DateOcc } from '../src/dates.js';
import { assertNoLeaks, blind, checkMapping, createUnblinder, LeakError, unblind, type Mapping, type ReplaceWith } from '../src/index.js';
import { FEMALE_FIRST, LAST_NAMES, MALE_FIRST } from '../src/names.js';
import { Rng } from '../src/prng.js';
import { placeholderLiterals, placeholderNumber, Placeholders, RandomFakes } from '../src/replace.js';
import { PairLog } from '../src/pairlog.js';

const NOW = new Date('2026-06-01T00:00:00Z');

const EMAIL = [
  'From: Ana Ruiz <ana@gestoria-norte.example>',
  'Hola Pablo, te paso la factura de Gestoría Norte S.L.',
  'Total: 247,80 € (cuota 206,50 € + 20 %), vence el 3 de marzo de 2026.',
  'IBAN ES91 2100 0418 4502 0005 1332, tarjeta 4111 1111 1111 1111 12/28.',
  'DNI 12345678Z. Llámame al +34 790 123 456. Un saludo, Ana',
].join('\n');
const PABLO = [{ kind: 'person' as const, value: 'Pablo Mena' }];

const placeholder = (texts: string[], mapping?: Mapping): ReturnType<typeof blind> =>
  blind(texts, { known: PABLO, seed: 'p', now: NOW, ...(mapping ? { mapping } : { replaceWith: 'placeholder' }) });

const stream = (answer: string, mapping: Mapping, cuts: number[]): string => {
  const u = createUnblinder(mapping);
  let out = '';
  let at = 0;
  for (const c of [...cuts, answer.length]) {
    out += u.push(answer.slice(at, c));
    at = c;
  }
  return out + u.end().text;
};

describe('placeholder output', () => {
  it('C26: writes [REDACTED_<KIND>_<n>], numbered per kind in order of first appearance, amounts and dates included', () => {
    const r = placeholder([EMAIL]);
    expect(r.texts[0]).toBe([
      'From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>',
      'Hola [REDACTED_PERSON_2], te paso la factura de Gestoría Norte S.L.',
      'Total: [REDACTED_AMOUNT_1] € (cuota [REDACTED_AMOUNT_2] € + 20 %), vence el [REDACTED_DATE_1].',
      'IBAN [REDACTED_IBAN_1], tarjeta [REDACTED_ID_1] 12/28.',
      'DNI [REDACTED_ID_2]. Llámame al [REDACTED_PHONE_1]. Un saludo, [REDACTED_PERSON_3]',
    ].join('\n'));
    expect(r.leaks.ok).toBe(true);
    expect(r.replaced).toMatchObject({ person: 3, email: 1, amount: 2, date: 1, iban: 1, id: 2, phone: 1 });
    expect(r.mapping).toMatchObject({ replaceWith: 'placeholder', factor: 1, dayShift: 0 });
  });

  it('C26: one value gets one placeholder across the texts of a call, a full name found again bare included', () => {
    const r = placeholder([EMAIL, 'Ana Ruiz pagó 247,80 €. Pablo lo confirma.']);
    expect(r.texts[1]).toBe('[REDACTED_PERSON_1] pagó [REDACTED_AMOUNT_1] €. [REDACTED_PERSON_2] lo confirma.');
  });

  it('C26: a later turn reuses every placeholder and numbers new values after the highest so far', () => {
    const first = placeholder([EMAIL]);
    const next = placeholder(['¿Ana Ruiz pagó la cuota de 206,50 €? Carlos Vidal <carlos@vidal.example> dice que sí, el 4 de marzo de 2026.'], first.mapping);
    expect(next.texts[0]).toBe('¿[REDACTED_PERSON_1] pagó la cuota de [REDACTED_AMOUNT_2] €? [REDACTED_PERSON_4] <[REDACTED_EMAIL_2]> dice que sí, el [REDACTED_DATE_2].');
    expect(next.mapping.pairs.slice(0, first.mapping.pairs.length)).toEqual(first.mapping.pairs);
  });

  it('C26: each spelling of a value is its own value, so each comes back exactly as written', () => {
    // The second "Ana" starts with a Cyrillic А. Detection folds it, the placeholder keeps the spelling.
    const text = 'From: Ana Ruiz <ana@x.example>\n\u0410na Ruiz firma. Ana lo confirma.';
    const r = blind([text], { seed: 'p', replaceWith: 'placeholder' });
    expect(r.texts[0]).toBe('From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>\n[REDACTED_PERSON_2] firma. [REDACTED_PERSON_3] lo confirma.');
    expect(unblind(r.texts[0] as string, r.mapping).text).toBe(text);
  });

  it('C26: unblind restores real values, and lists unknown placeholders, amounts and dates as invented without changing them', () => {
    const r = placeholder([EMAIL]);
    const answer = '[REDACTED_PERSON_1] debe [REDACTED_AMOUNT_1] € desde el [REDACTED_DATE_1], más 15,00 € el 2026-04-01. Lo sabe [REDACTED_PERSON_7].';
    const back = unblind(answer, r.mapping);
    expect(back.text).toBe('Ana Ruiz debe 247,80 € desde el 3 de marzo de 2026, más 15,00 € el 2026-04-01. Lo sabe [REDACTED_PERSON_7].');
    expect(back.invented).toEqual(['15,00 €', '2026-04-01', '[REDACTED_PERSON_7]']);
  });

  it('C26: a placeholder literal already in the input is never given to a value and comes back as a literal', () => {
    const text = 'Li Na met [REDACTED_PERSON_1] and [redacted_amount_1], then paid 12,00 €.';
    const r = blind([text], { known: [{ kind: 'person', value: 'Li Na' }], seed: 'p', replaceWith: 'placeholder' });
    expect(r.texts[0]).toBe('[REDACTED_PERSON_2] met [REDACTED_PERSON_1] and [redacted_amount_1], then paid [REDACTED_AMOUNT_2] €.');
    expect(r.mapping.literals).toEqual(['[REDACTED_PERSON_1]', '[REDACTED_AMOUNT_1]']);
    expect(r.collisions).toEqual([]);
    expect(unblind(r.texts[0] as string, r.mapping).text).toBe(text);
  });

  it('C26: a literal seen in an earlier turn or another text of the call keeps its number in every later allocation', () => {
    const known = ['Li Na', 'Bo Wen', 'Ana Ruiz'].map((value) => ({ kind: 'person' as const, value }));
    const first = blind(['Li Na wrote.', 'Ask [REDACTED_PERSON_3].'], { known, seed: 'p', replaceWith: 'placeholder' });
    expect(first.texts).toEqual(['[REDACTED_PERSON_1] wrote.', 'Ask [REDACTED_PERSON_3].']);
    const next = blind(['Bo Wen called. Ana Ruiz too.'], { known, mapping: first.mapping });
    expect(next.texts[0]).toBe('[REDACTED_PERSON_2] called. [REDACTED_PERSON_4] too.');
    expect(next.mapping.literals).toEqual(['[REDACTED_PERSON_3]']);
    expect(unblind('[REDACTED_PERSON_3] and [REDACTED_PERSON_4]', next.mapping).text).toBe('[REDACTED_PERSON_3] and Ana Ruiz');
  });

  it('C26: a mapping that already gives a literal of the text to a value reports it in collisions by kind and index', () => {
    const edited: Mapping = {
      version: 1, seed: 'p', replaceWith: 'placeholder', factor: 1, dayShift: 0, dateOrder: 'dmy', refYear: 2026,
      pairs: [{ kind: 'person', real: 'Li Na', fake: '[REDACTED_PERSON_1]' }],
    };
    const r = blind(['Ask [REDACTED_PERSON_1] and Li Na.'], { mapping: edited });
    expect(r.collisions).toEqual([{ kind: 'person', index: 0 }]);
    expect(JSON.stringify(r.collisions)).not.toContain('Li Na');
    expect(() => checkMapping({ ...edited, literals: ['Li Na'] })).toThrow('(literals)');
    expect(() => checkMapping({ ...edited, replaceWith: 'random', pairs: [], literals: ['[REDACTED_PERSON_1]'] })).toThrow('(literals)');
  });

  it('C26: unblind and the streaming unblinder report the same literal collisions as blind, by kind and index', () => {
    const edited: Mapping = {
      version: 1, seed: 'p', replaceWith: 'placeholder', factor: 1, dayShift: 0, dateOrder: 'dmy', refYear: 2026,
      pairs: [{ kind: 'person', real: 'Bo Wen', fake: '[REDACTED_PERSON_2]' }, { kind: 'person', real: 'Li Na', fake: '[REDACTED_PERSON_1]' }],
    };
    const r = blind(['Ask [REDACTED_PERSON_1], Bo Wen and Li Na.'], { mapping: edited });
    expect(r.mapping.literals).toEqual(['[REDACTED_PERSON_1]']);
    expect(r.collisions).toEqual([{ kind: 'person', index: 1 }]);
    const answer = 'Ask [REDACTED_PERSON_1].';
    expect(unblind(answer, r.mapping).collisions).toEqual(r.collisions);
    const u = createUnblinder(r.mapping);
    u.push(answer);
    expect(u.end().collisions).toEqual(r.collisions);
    expect(JSON.stringify(unblind(answer, r.mapping).collisions)).not.toContain('Li Na');
    expect(unblind(answer, { ...r.mapping, literals: [] }).collisions).toEqual([]);
  });

  it('C26: two names joined by a conjunction or a comma get two placeholders, a particle inside one name keeps one', () => {
    const known = ['Bo Wen', 'Ana Ruiz', 'Lucía de la Fuente', 'Pieter van Dijk', 'Hans von Berg', 'Rosa del Valle', 'Juan de Soto']
      .map((value) => ({ kind: 'person' as const, value }));
    for (const sep of [' and ', ' AND ', ' y ', ' e ', ' & ', ', ']) {
      const text = `Bo Wen${sep}Ana Ruiz signed.`;
      const r = blind([text], { known, seed: 'p', replaceWith: 'placeholder' });
      expect(r.texts[0]).toBe(`[REDACTED_PERSON_1]${sep}[REDACTED_PERSON_2] signed.`);
      expect(unblind(r.texts[0] as string, r.mapping).text).toBe(text);
    }
    const text = 'Lucía de la Fuente, Pieter van Dijk, Hans von Berg and Rosa del Valle met Juan de Soto. Pieter van Dijk y Ana Ruiz too.';
    const r = blind([text], { known, seed: 'p', replaceWith: 'placeholder' });
    expect(r.texts[0]).toBe('[REDACTED_PERSON_1], [REDACTED_PERSON_2], [REDACTED_PERSON_3] and [REDACTED_PERSON_4] met [REDACTED_PERSON_5]. [REDACTED_PERSON_2] y [REDACTED_PERSON_6] too.');
    expect(unblind(r.texts[0] as string, r.mapping).text).toBe(text);
  });

  it('C1/C2: in fake mode two names joined by a conjunction or a comma keep separate fakes and the conjunction', () => {
    const known = ['Bo Wen', 'Ana Ruiz'].map((value) => ({ kind: 'person' as const, value }));
    for (const sep of [' and ', ' y ', ' e ', ' & ', ', ']) {
      const text = `Bo Wen${sep}Ana Ruiz signed.`;
      const r = blind([text], { known, seed: 'p' });
      const out = r.texts[0] as string;
      expect(out.endsWith(' signed.')).toBe(true);
      const [first, second] = out.slice(0, -' signed.'.length).split(sep);
      expect(first?.split(' ')).toHaveLength(2);
      expect(second?.split(' ')).toHaveLength(2);
      expect(first).not.toBe(second);
      expect(out).not.toMatch(/\b(?:Bo|Wen|Ana|Ruiz)\b/);
      expect(unblind(out, r.mapping).text).toBe(text);
    }
  });

  it('C27: a placeholder split across chunks at any point is restored, and the stream equals one-shot unblind', () => {
    const r = placeholder([EMAIL]);
    const answer = `Resumen: ${r.texts[0] as string}\nY [REDACTED_ID_9] no consta.`;
    const whole = unblind(answer, r.mapping);
    expect(whole.text).toBe(`Resumen: ${EMAIL}\nY [REDACTED_ID_9] no consta.`);
    for (let c = 1; c < answer.length; c++) expect(stream(answer, r.mapping, [c]), `cut at ${c}`).toBe(whole.text);
    const u = createUnblinder(r.mapping);
    expect(u.push('Hola [REDACTED_PER')).toBe('');
    expect(u.push('SON_1]') + u.end().text).toBe('Hola Ana Ruiz');
  });

  it('C27: random output, split across chunks at any point, streams to exactly the one-shot result', () => {
    const r = blind([EMAIL], { known: PABLO, seed: 'r', now: NOW, replaceWith: 'random' });
    const answer = `Resumen: ${r.texts[0] as string}\nTotal calculado: 999,99 €.`;
    const whole = unblind(answer, r.mapping);
    expect(whole.text).toBe(`Resumen: ${EMAIL}\nTotal calculado: 999,99 €.`);
    for (let c = 1; c < answer.length; c++) expect(stream(answer, r.mapping, [c]), `cut at ${c}`).toBe(whole.text);
  });
});

const names = new Set([...FEMALE_FIRST, ...MALE_FIRST, ...LAST_NAMES]);
const random = (texts: string[], seed = 'r', mapping?: Mapping): ReturnType<typeof blind> =>
  blind(texts, { known: PABLO, seed, now: NOW, ...(mapping ? { mapping } : { replaceWith: 'random' }) });
const amountsOf = (t: string): number[] => detectAmounts(t).map((a) => a.minor);
const dayNumber = (t: string): number[] => detectDates(t, 'dmy').map((d) => Date.UTC(d.occ.y ?? 2026, d.occ.m - 1, d.occ.d) / 86_400_000);

describe('random output', () => {
  it('C28: each value becomes a random value of its kind, with no shape, layout or checksum kept', () => {
    const r = random([`${EMAIL}\nExpediente EXP-2026-0412, servidor 10.20.30.40.`]);
    const out = r.texts[0] as string;
    expect(r.leaks.ok).toBe(true);
    const from = /^From: (\S+) (\S+) <([^>]+)>/.exec(out)!;
    expect(names.has(from[1] as string) && names.has(from[2] as string)).toBe(true);
    expect(from[3]).toMatch(/^[a-z.]+@[a-z-]+\.example$/);
    expect(out).toMatch(/IBAN ES\d{2}( \d{4}){5},/);
    expect(out).toMatch(/tarjeta \d{9} 12\/28/);
    expect(out).toMatch(/DNI \d{9}\./);
    expect(out).toMatch(/Llámame al \+34 6\d{2} \d{3} \d{3}\./);
    expect(out).toMatch(/Expediente \d{9},/);
    expect(out).toMatch(/servidor (192\.0\.2|198\.51\.100|203\.0\.113)\.\d+\./);
    expect(r.mapping).toMatchObject({ replaceWith: 'random', factor: 1, dayShift: 0 });
  });

  it('C28: amounts are not scaled and dates are not shifted by whole weeks, so neither relation survives', () => {
    const text = 'Cuota 100,00 €, recargo 200,00 €, total 300,00 €. Del 3 de marzo de 2026 al 10 de marzo de 2026.';
    const out = random([text]).texts[0] as string;
    const [a, b, c] = amountsOf(out) as [number, number, number];
    expect(b).not.toBe(2 * a);
    expect(c).not.toBe(a + b);
    const [d1, d2] = dayNumber(out) as [number, number];
    expect(d2 - d1).not.toBe(7);
    expect(out).toMatch(/^Cuota \d{1,4},\d{2} €, recargo \d{1,4},\d{2} €, total \d{1,4},\d{2} €\. Del \d{1,2} de \p{L}+ de 202[567] al \d{1,2} de \p{L}+ de 202[567]\.$/u);
  });

  it('C28: one value keeps one random fake within a call and across turns, and the same seed gives the same output', () => {
    const first = random([EMAIL, 'Ana pagó 247,80 € el 3 de marzo de 2026.']);
    const fakeTotal = /Total: (\S+) €/.exec(first.texts[0] as string)![1];
    const fakeDate = /vence el (.+?)\./.exec(first.texts[0] as string)![1];
    expect(first.texts[1]).toContain(`pagó ${fakeTotal} € el ${fakeDate}.`);
    const next = random(['¿Ana ya pagó los 247,80 € del 3 de marzo de 2026?'], 'ignored', first.mapping);
    expect(next.texts[0]).toContain(`${fakeTotal} € del ${fakeDate}?`);
    expect(random([EMAIL]).texts).toEqual(random([EMAIL]).texts);
    expect(random([EMAIL], 'other').texts).not.toEqual(random([EMAIL]).texts);
  });

  it('C28: an amount the model computes from random fakes cannot be mapped back, so it stays as written and is listed as invented', () => {
    const r = random(['Cuota 206,50 € y recargo 41,30 €.']);
    const [a, b] = amountsOf(r.texts[0] as string) as [number, number];
    const sum = `${String(Math.floor((a + b) / 100))},${String((a + b) % 100).padStart(2, '0')} €`;
    const back = unblind(`${r.texts[0] as string} Suman ${sum}.`, r.mapping);
    expect(back.text).toBe(`Cuota 206,50 € y recargo 41,30 €. Suman ${sum}.`);
    expect(back.invented).toEqual([sum]);
  });
});

describe('the mode lives in the mapping', () => {
  const made = (replaceWith?: ReplaceWith): Mapping =>
    blind(['Ana Ruiz <ana@x.example> pagó 247,80 € el 3 de marzo de 2026. DNI 12345678Z.'], { seed: 'm', replaceWith }).mapping;

  it('C29: the mapping records the mode, and a later turn keeps it without being told', () => {
    expect(made().replaceWith).toBe('fake');
    for (const mode of ['placeholder', 'random'] as const) {
      const next = blind(['Ana pagó.'], { mapping: made(mode) });
      expect(next.mapping.replaceWith).toBe(mode);
      expect(blind(['Ana pagó.'], { mapping: made(mode), replaceWith: mode }).texts).toEqual(next.texts);
    }
    expect(blind(['Ana pagó.'], { mapping: made('placeholder') }).texts[0]).toBe('[REDACTED_PERSON_2] pagó.');
  });

  it('C29: a replaceWith that differs from the mapping throws an error that names the field', () => {
    expect(() => blind(['x'], { mapping: made('placeholder'), replaceWith: 'random' })).toThrow(/replaceWith is 'random' but the mapping was made with replaceWith 'placeholder'/);
    expect(() => blind(['x'], { mapping: made(), replaceWith: 'placeholder' })).toThrow(/replaceWith/);
    // A mapping from before modes existed is a fake one.
    const old: Mapping = made();
    delete old.replaceWith;
    expect(() => blind(['x'], { mapping: old, replaceWith: 'random' })).toThrow(/mapping was made with replaceWith 'fake'/);
    expect(blind(['Ana pagó.'], { mapping: old }).mapping.replaceWith).toBe('fake');
    expect(() => blind(['x'], { replaceWith: 'mask' as ReplaceWith })).toThrow(/replaceWith must be one of fake, placeholder, random/);
  });

  it('C29: checkMapping accepts placeholder and random mappings and refuses ones that break their mode, naming only the field', () => {
    const ph = made('placeholder');
    const rnd = made('random');
    const fake = made('fake');
    for (const m of [ph, rnd, fake]) expect(() => checkMapping(JSON.parse(JSON.stringify(m)))).not.toThrow();
    const amountPair = rnd.pairs.findIndex((p) => p.kind === 'amount');
    const cases: Array<[unknown, string]> = [
      [{ ...ph, replaceWith: 'mask' }, 'replaceWith'],
      [{ ...ph, factor: 1.2 }, 'factor'], [{ ...ph, dayShift: 14 }, 'dayShift'],
      [{ ...rnd, factor: 0.8 }, 'factor'], [{ ...rnd, dayShift: -7 }, 'dayShift'],
      [{ ...ph, pairs: [{ kind: 'person', real: 'Ana', fake: 'Lucía' }] }, 'pairs[0]'],
      [{ ...ph, pairs: [{ kind: 'person', real: 'Ana', fake: '[REDACTED_EMAIL_1]' }] }, 'pairs[0]'],
      [{ ...ph, pairs: [{ kind: 'id', real: '1', fake: '[REDACTED_ID_0]' }] }, 'pairs[0]'],
      [{ ...rnd, pairs: rnd.pairs.map((p, i) => (i === amountPair ? { ...p, fake: p.real } : p)) }, `pairs[${amountPair}]`],
      [{ ...rnd, pairs: [{ kind: 'phone', real: '790 123 456', fake: '790 123 456' }] }, 'pairs[0]'],
      // Relabelling a mapping does not get round the checks of the mode it claims.
      [{ ...fake, replaceWith: 'placeholder' }, 'factor'], [{ ...ph, replaceWith: 'fake' }, 'factor'], [{ ...ph, replaceWith: undefined }, 'factor'],
    ];
    for (const [m, field] of cases) {
      expect(() => blind(['x'], { mapping: m as Mapping }), field).toThrow(`blind: the mapping is not valid (${field})`);
    }
  });
});

describe('the leak check in every mode', () => {
  // Rosa is also an ordinary word here, so her bare first name is not carried from the header; the leak check still knows it.
  const LEAKY = 'From: Rosa Quesada <rosa@asesores-quesada.example>\n\nHola Rosa, la pintura rosa ya llegó. Project Falcon sigue.';

  for (const mode of ['placeholder', 'random'] as const) {
    it(`C30: in ${mode} mode a found value left in the text and a deny entry are reported by kind and offset, never by value`, () => {
      const r = blind([LEAKY], { seed: 'l', replaceWith: mode, deny: ['Project Falcon'] });
      expect(r.leaks.ok).toBe(false);
      expect(new Set(r.leaks.hits.map((h) => h.kind))).toEqual(new Set(['person', 'deny']));
      for (const h of r.leaks.hits) expect(Object.keys(h).sort()).toEqual(['kind', 'offset', 'textIndex']);
      expect(() => assertNoLeaks(r)).toThrow(LeakError);
      let message = '';
      try {
        assertNoLeaks(r);
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toMatch(/rosa|quesada|falcon/i);
      expect(JSON.stringify(r.leaks)).not.toMatch(/rosa|quesada|falcon/i);
    });

    it(`C30: in ${mode} mode a clean text passes the leak check and no real value is left`, () => {
      const r = blind([EMAIL], { known: PABLO, seed: 'c', now: NOW, replaceWith: mode });
      expect(() => assertNoLeaks(r)).not.toThrow();
      for (const real of ['Ana', 'Ruiz', 'Pablo', 'gestoria-norte', '247,80', '206,50', '3 de marzo', '2100 0418', '4111 1111', '12345678Z', '790 123 456']) {
        expect(r.texts[0], real).not.toContain(real);
      }
    });
  }
});

/** An Rng that hands out the values it is given, in order, and fails on one outside the bounds asked for. */
class Scripted extends Rng {
  constructor(private readonly queue: number[]) {
    super('scripted');
  }

  override range(min: number, max: number): number {
    const v = this.queue.shift();
    if (v === undefined || v < min || v > max) throw new Error(`scripted draw ${String(v)} outside ${min}..${max}`);
    return v;
  }

  override int(n: number): number {
    return this.range(0, n - 1);
  }
}

const occ = (text: string): AmountOcc => detectAmounts(text)[0] as AmountOcc;
const dateOcc = (text: string): DateOcc => (detectDates(text, 'dmy')[0] as { occ: DateOcc }).occ;
const fakes = (draws: number[]): RandomFakes => new RandomFakes(new Scripted(draws), [], 'dmy', new PairLog());

describe('placeholder numbering', () => {
  it('reads the number of a placeholder of its own kind only, written alone and in full', () => {
    expect(placeholderNumber('person', '[REDACTED_PERSON_12]')).toBe(12);
    expect(placeholderNumber('person', '[REDACTED_PERSON_3]')).toBe(3);
    expect(placeholderNumber('person', '[REDACTED_EMAIL_3]')).toBeNull();
    expect(placeholderNumber('person', 'x[REDACTED_PERSON_3]')).toBeNull();
    expect(placeholderNumber('person', '[REDACTED_PERSON_3]x')).toBeNull();
    expect(placeholderNumber('person', '[REDACTED_PERSON_0]')).toBeNull();
    expect(placeholderNumber('person', 'Lucía')).toBeNull();
  });

  it('lists literals of two or more digits, in upper case, once each', () => {
    expect(placeholderLiterals(['a [redacted_person_12] b', 'c [REDACTED_PERSON_12] [REDACTED_ID_40]'])).toEqual(['[REDACTED_PERSON_12]', '[REDACTED_ID_40]']);
    expect(placeholderLiterals(['[REDACTED_PERSON_1a]'])).toEqual([]);
  });

  it('starts with no pairs and numbers a new value after the highest earlier number of its kind', () => {
    expect(new Placeholders([]).pairs).toEqual([]);
    const ph = new Placeholders([
      { kind: 'person', real: 'Ana Ruiz', fake: '[REDACTED_PERSON_12]' },
      { kind: 'person', real: 'Bo Wen', fake: '[REDACTED_PERSON_3]' },
      { kind: 'person', real: 'Li Na', fake: 'Lucía' },
      { kind: 'email', real: 'li@x.example', fake: '[REDACTED_EMAIL_2]' },
    ]);
    expect(ph.get('person', 'Bo Wen')).toBe('[REDACTED_PERSON_3]');
    expect(ph.get('person', 'Rosa Vidal')).toBe('[REDACTED_PERSON_13]');
    expect(ph.get('email', 'rosa@x.example')).toBe('[REDACTED_EMAIL_3]');
    expect(ph.get('phone', '790 123 456')).toBe('[REDACTED_PHONE_1]');
    expect(ph.pairs).toEqual([
      { kind: 'person', real: 'Rosa Vidal', fake: '[REDACTED_PERSON_13]' },
      { kind: 'email', real: 'rosa@x.example', fake: '[REDACTED_EMAIL_3]' },
      { kind: 'phone', real: '790 123 456', fake: '[REDACTED_PHONE_1]' },
    ]);
  });
});

describe('random values, one draw at a time', () => {
  it('an id draw equal to the value itself is drawn again', () => {
    expect(fakes([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2]).id('111111111')).toBe('222222222');
  });

  it('a random amount is its drawn digits and cents, never the original, and one amount keeps one fake', () => {
    const f = fakes([2, 1, 2, 34, 2, 1, 2, 34, 1, 9, 0]);
    expect(f.amount(occ('Cuota 5,00 €'))).toBe('12,34');
    expect(f.amount(occ('Cuota 5,00 €'))).toBe('12,34');
    // 12,34 is taken, so the next amount draws again.
    expect(f.amount(occ('Recargo 7,00 €'))).toBe('9,00');
    // A draw equal to the amount itself is drawn again.
    expect(fakes([2, 1, 2, 34, 1, 5, 0]).amount(occ('Cuota 12,34 €'))).toBe('5,00');
  });

  it('a random date is the drawn day, never the original, and one date keeps one fake', () => {
    const f = fakes([2026, 4, 4, 2026, 4, 4, 2025, 9, 30]);
    const march = dateOcc('el 3 de marzo de 2026');
    expect(f.date(march, 2026)).toMatchObject({ y: 2026, m: 4, d: 4 });
    expect(f.date(march, 2026)).toMatchObject({ y: 2026, m: 4, d: 4 });
    expect(f.date(dateOcc('el 5 de marzo de 2026'), 2026)).toMatchObject({ y: 2025, m: 9, d: 30 });
    expect(fakes([2026, 3, 3, 2027, 1, 31]).date(march, 2026)).toMatchObject({ y: 2027, m: 1, d: 31 });
  });

  it('random dates fall within a year either side of the reference year, and a date without a year never gets 29 February or later', () => {
    const years = new Set<number>();
    const lateDays = { dated: 0, yearless: 0 };
    const dated = dateOcc('el 3 de marzo de 2026');
    const yearless = dateOcc('el 3 de marzo');
    for (let i = 0; i < 400; i++) {
      const f = new RandomFakes(new Rng(`d${i}`), [], 'dmy', new PairLog());
      const a = f.date(dated, 2026);
      const b = f.date(yearless, 2026);
      years.add(a.y as number);
      expect(b.y).toBeNull();
      expect(a.d).toBeLessThanOrEqual(new Date(Date.UTC(a.y as number, a.m, 0)).getUTCDate());
      if (a.d > 28) lateDays.dated++;
      if (b.d > 28) lateDays.yearless++;
    }
    expect([...years].sort()).toEqual([2025, 2026, 2027]);
    expect(lateDays.dated).toBeGreaterThan(0);
    expect(lateDays.yearless).toBe(0);
  });

  it('random amounts keep the decimals and have one to four integer digits, never a leading zero', () => {
    const lengths = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const out = new RandomFakes(new Rng(`a${i}`), [], 'dmy', new PairLog()).amount(occ('Cuota 5,00 €'));
      expect(out).toMatch(/^[1-9]\d{0,3},\d{2}$/);
      lengths.add(out.indexOf(','));
    }
    expect([...lengths].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('random values across spellings and turns', () => {
  it('one amount or date written two ways in a call gets one random value, in each spelling', () => {
    const r = blind(['Pagado EUR 247.80 y 247,80 €, el 03/03/2026 y el 3 de marzo de 2026.'], { seed: 'r', now: NOW, replaceWith: 'random' });
    const m = /^Pagado EUR (\d+)\.(\d\d) y (\d+),(\d\d) €, el (\d\d)\/(\d\d)\/(\d{4}) y el (\d+) de (\p{L}+) de (\d{4})\.$/u.exec(r.texts[0] as string);
    expect(m).not.toBeNull();
    const [, i1, c1, i2, c2, dd, mm, y1, d2, , y2] = m as unknown as string[];
    expect([i1, c1]).toEqual([i2, c2]);
    expect(Number(dd)).toBe(Number(d2));
    expect(y1).toBe(y2);
    expect(Number(mm)).toBeGreaterThan(0);
  });

  it('a later turn writes an earlier amount or date in a new spelling with the same random value', () => {
    const first = random(['Total: 247,80 €, vence el 3 de marzo de 2026.']);
    const [, amount, cents, day, month, year] = /^Total: (\d+),(\d\d) €, vence el (\d+) de (\p{L}+) de (\d{4})\.$/u.exec(first.texts[0] as string) as unknown as string[];
    // A new amount and date come first, so the turn's own draws cannot hand out the same values again by chance.
    const next = blind(['Recargo 15,00 € el 9/9/2026. Pagado EUR 247.80 el 3/3/2026.'], { mapping: first.mapping, now: NOW });
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    expect(next.texts[0]).toMatch(new RegExp(`Pagado EUR ${amount as string}\\.${cents as string} el ${day as string}/${months.indexOf(month as string) + 1}/${year as string}\\.$`));
  });
});
