/**
 * Fakes in the language of the value, or of the text around it, and first
 * names that keep their gender (C31). Every value below is invented.
 */
import { describe, expect, it } from 'vitest';
import { blind } from '../src/index.js';
import { addressLanguage, hostLanguage, nameLanguages, orgLanguage, placeLanguage, spellingLanguage, TextLanguage, winner, wordLanguage } from '../src/language.js';
import { FAKES, type Lang } from '../src/names.js';
import { Rng } from '../src/prng.js';
import { PairLog } from '../src/pairlog.js';
import { asciiLower, looksFemale, Surrogates } from '../src/surrogates.js';
import { fakeListLanguage } from './support/properties.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const has = (list: readonly string[], fake: string): boolean => list.some((x) => asciiLower(x) === asciiLower(fake));
const fakeOf = (pairs: ReadonlyArray<{ kind: string; real: string; fake: string }>, kind: string, real: string): string => {
  const p = pairs.find((x) => x.kind === kind && x.real === real);
  if (!p) throw new Error(`no ${kind} pair`);
  return p.fake;
};

describe('the language of a value', () => {
  it('C31/unit: a word is read by the lists, then an accent, then its spelling, and a word in both lists says nothing', () => {
    expect(winner(1, 1)).toBeUndefined();
    expect(winner(2, 1)).toBe('en');
    expect(winner(0, 3)).toBe('es');
    expect(wordLanguage('Sophia')).toBe('en');
    expect(wordLanguage('Ruiz')).toBe('es');
    expect(wordLanguage('Laura')).toBeUndefined();
    expect(wordLanguage('Martin')).toBeUndefined();
    expect(wordLanguage('Martín')).toBe('es');
    expect(wordLanguage('Thistlewood')).toBe('en');
    expect(wordLanguage('Quintana')).toBeUndefined();
    expect(spellingLanguage('Ellsworth')).toBe('en');
    expect(spellingLanguage('Galindo')).toBe('es');
    expect(spellingLanguage('Barragán')).toBe('es');
    expect(spellingLanguage('Mena')).toBeUndefined();
    // One English sign and one Spanish sign is a tie.
    expect(spellingLanguage('Wenceslao')).toBeUndefined();
  });

  it('C31/unit: a name word that says nothing takes the language of the rest of the name, and a split name keeps each word its own', () => {
    expect(nameLanguages(['Laura', 'Ward'])).toEqual(['en', 'en']);
    expect(nameLanguages(['Mena', 'Ruiz'])).toEqual(['es', 'es']);
    expect(nameLanguages(['Ana', 'Ward'])).toEqual(['es', 'en']);
    expect(nameLanguages(['Laura', 'Ana', 'Ward'])).toEqual([undefined, 'es', 'en']);
    expect(nameLanguages(['Mena', 'Quintana'])).toEqual([undefined, undefined]);
  });

  it('C31/unit: a company counts its legal suffix twice, a host its country domain twice, and each word once', () => {
    expect(orgLanguage('Moorcroft Joinery Ltd.')).toBe('en');
    expect(orgLanguage('Gestoría Norte S.L.')).toBe('es');
    expect(orgLanguage('Talleres Wicker')).toBeUndefined();
    expect(orgLanguage('Wicker Talleres S.L.')).toBe('es');
    expect(orgLanguage('Talleres Wicker LLC')).toBe('en');
    expect(orgLanguage('Ondara')).toBeUndefined();
    expect(placeLanguage('Valdecañas')).toBe('es');
    expect(placeLanguage('Wrenfield')).toBe('en');
    expect(placeLanguage('Ondara')).toBeUndefined();
    expect(hostLanguage('ward-bookkeeping.example')).toBe('en');
    expect(hostLanguage('gestoria-norte.example')).toBe('es');
    // These hosts need a country suffix, so `.example` will not do. The underscore keeps them unregistrable.
    expect(hostLanguage('ondara_.co.uk')).toBe('en');
    expect(hostLanguage('mail.despacho_inventado.es')).toBe('es');
    expect(hostLanguage('ondara.example')).toBeUndefined();
    // Two-letter labels say nothing.
    expect(hostLanguage('my.ondara.example')).toBeUndefined();
  });

  it('C31/unit: an address reads its host and the names its local part holds, but not role words, glued spellings or a public host', () => {
    expect(addressLanguage('ana@ondara.example')).toBe('es');
    expect(addressLanguage('sophia@ondara.example')).toBe('en');
    expect(addressLanguage('news@ondara.example')).toBeUndefined();
    expect(addressLanguage('bbustamante@ondara.example')).toBeUndefined();
    expect(addressLanguage('sophia@despacho_inventado.es')).toBe('es');
    expect(addressLanguage('sophia@despacho_inventado.es', true)).toBe('en');
    expect(addressLanguage('sophia%40despacho_inventado.es')).toBe('es');
    expect(addressLanguage('gestoria-norte.example')).toBe('es');
  });
});

describe('the language of the text around a value', () => {
  const at = (text: string, word: string, values: Array<{ start: number; end: number }> = []): Lang => new TextLanguage([text], [values]).at(0, text.indexOf(word));

  it('C31/unit: the paragraph of a value decides when one language leads by two words', () => {
    const text = 'Hi Ben, thanks for the note.\n\nHola Pablo, gracias por la nota.';
    expect(at(text, 'Ben')).toBe('en');
    expect(at(text, 'Pablo')).toBe('es');
    expect(new TextLanguage([text]).at(0, text.length)).toBe('es');
  });

  it('C31/unit: a paragraph that does not decide reads its neighbours, one on each side at a time, then the whole text', () => {
    // The middle paragraph has no function words, its neighbours are English.
    expect(at('Hello, this is the plan for the week.\n\nLindenwood 12\n\nThe rest is in the file, as you know.', 'Lindenwood')).toBe('en');
    // The nearer paragraph wins over a stronger one further away.
    expect(at('Hola, te paso la nota y el plan de la semana.\n\nNos vemos.\n\nLindenwood 12\n\nThe file is attached for you.', 'Lindenwood')).toBe('en');
    // No paragraph leads by two, so the whole text decides.
    expect(at('the note\n\nLindenwood 12', 'Lindenwood')).toBe('en');
    expect(at('Hola,\n\nLindenwood 12\n\ny', 'Lindenwood')).toBe('es');
  });

  it('C31/unit: a header block reads as the message below it', () => {
    const text = 'Thanks, see you on the day.\n\nFrom: x\nSubject: nota\n\nHola, te paso la nota.';
    expect(at(text, 'From')).toBe('es');
    expect(at(text, 'Thanks')).toBe('en');
  });

  it('C31/unit: a text with no function words follows the call, and a call with none is English', () => {
    expect(new TextLanguage(['Lindenwood 12', 'Hola, te paso la nota.']).at(0, 0)).toBe('es');
    expect(new TextLanguage(['Lindenwood 12', 'Hola, te paso la nota.']).call).toBe('es');
    expect(new TextLanguage(['Lindenwood 12']).call).toBe('en');
    expect(new TextLanguage([]).call).toBe('en');
  });

  it('C31/unit: detected values and header keys do not vote', () => {
    const text = 'Ana de la Fuente de la Vega';
    expect(new TextLanguage([text]).call).toBe('es');
    expect(new TextLanguage([text], [[{ start: 0, end: text.length }]]).call).toBe('en');
    // "To:" is a header key, not the English word.
    expect(new TextLanguage(['To: to\nPara: x']).call).toBe('en');
    expect(new TextLanguage(['To: x\nPara: x']).call).toBe('en');
    expect(new TextLanguage(['To: de\nTo: el']).call).toBe('es');
  });
});

describe('blind writes fakes in the language of the value or its text', () => {
  const lists = (lang: Lang): string[] => [...FAKES[lang].female, ...FAKES[lang].male, ...FAKES[lang].last];

  it('C31/unit: the README sender gets an English name and host, and the Spanish one Spanish ones', () => {
    const en = blind(['From: Sophia Ward <sophia@ward-bookkeeping.example>\nHi Ben, here is the invoice.'], { known: [{ kind: 'person', value: 'Ben Carver' }], seed: 'readme', now: NOW });
    const es = blind(['From: Ana Ruiz <ana@gestoria-norte.example>\nHola Pablo, te paso la factura.'], { known: [{ kind: 'person', value: 'Pablo Mena' }], seed: 'readme', now: NOW });
    for (const real of ['Sophia', 'Ward', 'Ben']) expect(has(lists('en'), fakeOf(en.mapping.pairs, 'person', real))).toBe(true);
    for (const real of ['Ana', 'Ruiz', 'Pablo']) expect(has(lists('es'), fakeOf(es.mapping.pairs, 'person', real))).toBe(true);
    // The known surnames the texts never write get no pair (C21).
    expect(() => fakeOf(en.mapping.pairs, 'person', 'Carver')).toThrow('no person pair');
    expect(() => fakeOf(es.mapping.pairs, 'person', 'Mena')).toThrow('no person pair');
    expect(fakeListLanguage('email', fakeOf(en.mapping.pairs, 'email', 'sophia@ward-bookkeeping.example'))).toBe('en');
    expect(fakeListLanguage('email', fakeOf(es.mapping.pairs, 'email', 'ana@gestoria-norte.example'))).toBe('es');
  });

  it('C31/unit: a value that says its language gets a fake in it, whatever the text around it', () => {
    const known = (person: string, org: string, place: string) => [
      { kind: 'person' as const, value: person },
      { kind: 'org' as const, value: org },
      { kind: 'place' as const, value: place },
    ];
    const es = blind(['From: Joaquín Peñalver <jpenalver@asesores-ondara.example>\nHi team, the invoice from Gestoría Ondara S.L. for the office in Valdecañas is attached. Thanks for your help.'], {
      known: known('Joaquín Peñalver', 'Gestoría Ondara S.L.', 'Valdecañas'),
      seed: 'value',
      now: NOW,
    });
    expect(has(lists('es'), fakeOf(es.mapping.pairs, 'person', 'Joaquín'))).toBe(true);
    expect(has(lists('es'), fakeOf(es.mapping.pairs, 'person', 'Peñalver'))).toBe(true);
    expect(fakeListLanguage('org', fakeOf(es.mapping.pairs, 'org', 'Gestoría Ondara S.L.'))).toBe('es');
    expect(fakeListLanguage('place', fakeOf(es.mapping.pairs, 'place', 'Valdecañas'))).toBe('es');
    expect(fakeListLanguage('email', fakeOf(es.mapping.pairs, 'email', 'jpenalver@asesores-ondara.example'))).toBe('es');
    const en = blind(['From: Imogen Ashworth <imogen@ashworth-joinery.example>\nHola, te paso la factura de Moorcroft Joinery Ltd. para la oficina de Wrenfield. Gracias por todo.'], {
      known: known('Imogen Ashworth', 'Moorcroft Joinery Ltd.', 'Wrenfield'),
      seed: 'value',
      now: NOW,
    });
    expect(has(FAKES.en.female, fakeOf(en.mapping.pairs, 'person', 'Imogen'))).toBe(true);
    expect(has(lists('en'), fakeOf(en.mapping.pairs, 'person', 'Ashworth'))).toBe(true);
    expect(fakeListLanguage('org', fakeOf(en.mapping.pairs, 'org', 'Moorcroft Joinery Ltd.'))).toBe('en');
    expect(fakeListLanguage('place', fakeOf(en.mapping.pairs, 'place', 'Wrenfield'))).toBe('en');
    expect(fakeListLanguage('email', fakeOf(en.mapping.pairs, 'email', 'imogen@ashworth-joinery.example'))).toBe('en');
  });

  it('C31/unit: a name that says nothing follows its paragraph, so each part of a two-language text gets its own', () => {
    const text = 'Hi team, the notes from Laura Mena are attached, and you can reply to me.\n\nHola equipo, te paso las notas de Daniel Quintana, y me cuentas.';
    const res = blind([text], { known: [{ kind: 'person', value: 'Laura Mena' }, { kind: 'person', value: 'Daniel Quintana' }], seed: 'mixed', now: NOW });
    for (const real of ['Laura', 'Mena']) expect(has(lists('en'), fakeOf(res.mapping.pairs, 'person', real))).toBe(true);
    for (const real of ['Daniel', 'Quintana']) expect(has(lists('es'), fakeOf(res.mapping.pairs, 'person', real))).toBe(true);
  });

  it('C31/unit: a name in both languages follows the text, and is English when nothing says', () => {
    const run = (text: string): string => fakeOf(blind([text], { known: [{ kind: 'person', value: 'Daniel Mena' }], seed: 'both', now: NOW }).mapping.pairs, 'person', 'Daniel');
    expect(has(FAKES.en.male, run('Dear Daniel Mena, thank you for the note.'))).toBe(true);
    expect(has(FAKES.es.male, run('Hola Daniel Mena, gracias por la nota.'))).toBe(true);
    expect(has(FAKES.en.male, run('Daniel Mena'))).toBe(true);
  });

  it('C31/unit: a value keeps its fake in a later turn in the other language, and a new spelling of it keeps its language', () => {
    const first = blind(['Dear Laura Mena, thank you for the note.'], { known: [{ kind: 'person', value: 'Laura Mena' }], seed: 'turns', now: NOW });
    const fake = fakeOf(first.mapping.pairs, 'person', 'Laura');
    expect(has(FAKES.en.female, fake)).toBe(true);
    const second = blind(['Hola, ¿ha pagado Laura Mena la factura de la semana?'], { mapping: first.mapping, now: NOW });
    expect(fakeOf(second.mapping.pairs, 'person', 'Laura')).toBe(fake);
    // Another spelling of a word from an earlier turn gets a fake of its own, in the language of the first.
    const log = new PairLog(first.mapping.pairs);
    const sur = new Surrogates(new Rng('turns 2'), { avoid: new Set(), isAllowedHost: () => false, log, lang: 'es' });
    sur.restore(first.mapping.pairs);
    const other = sur.person('Láura', 'Láura', 'es');
    expect(asciiLower(other)).not.toBe(asciiLower(fake));
    expect(has(FAKES.en.female, other)).toBe(true);
  });

  it('C31/unit: a Spanish company leads with its noun and an English one ends with it, and so do their hosts', () => {
    const sur = new Surrogates(new Rng('org'), { avoid: new Set(), isAllowedHost: () => false, log: new PairLog() });
    const [noun, base] = sur.org('Talleres Ondara', 'Talleres Ondara', 'es').split(' ') as [string, string];
    expect(FAKES.es.orgNouns).toContain(noun);
    expect(FAKES.es.orgBases).toContain(base);
    const [base2, noun2] = sur.org('Ondara Works', 'Ondara Works', 'en').split(' ') as [string, string];
    expect(FAKES.en.orgBases).toContain(base2);
    expect(FAKES.en.orgNouns).toContain(noun2);
    expect(sur.org('Ondara', 'Ondara', 'es').split(' ')).toHaveLength(1);
    const [n3, b3, n4] = sur.org('Talleres Ondara Norte', 'Talleres Ondara Norte', 'es').split(' ') as [string, string, string];
    expect([FAKES.es.orgNouns.includes(n3), FAKES.es.orgBases.includes(b3), FAKES.es.orgNouns.includes(n4)]).toEqual([true, true, true]);
    const [hn, hb] = sur.domain('ondara.example', 'es').replace('.example', '').split('-') as [string, string];
    expect([FAKES.es.domainNouns.includes(hn), FAKES.es.domainNames.includes(hb)]).toEqual([true, true]);
    const [ha, hc] = sur.domain('qualmon.example', 'en').replace('.example', '').split('-') as [string, string];
    expect([FAKES.en.domainNames.includes(ha), FAKES.en.domainNouns.includes(hc)]).toEqual([true, true]);
    // A noun the text writes is not used, so no real word stays in the fake.
    const avoid = new Set(FAKES.es.orgNouns.filter((n) => n !== 'Reformas').map(asciiLower));
    const s2 = new Surrogates(new Rng('org'), { avoid, isAllowedHost: () => false, log: new PairLog() });
    expect(s2.org('Talleres Ondara', 'Talleres Ondara', 'es').split(' ')[0]).toBe('Reformas');
    // With no language given, a value that says nothing is English.
    expect(fakeListLanguage('place', sur.place('Ondara'))).toBe('en');
    expect(fakeListLanguage('place', sur.place('Qualmon', 'Qualmon', 'es'))).toBe('es');
  });
});

describe('first names keep their gender', () => {
  it('C31/unit: the lists know women\'s names that do not end in "a" and men\'s that do, and other names keep the final-a rule', () => {
    for (const n of ['imogen', 'rose', 'phoebe', 'carmen', 'belen', 'pilar', 'andrea', 'laura']) expect(looksFemale(n)).toBe(true);
    for (const n of ['joshua', 'luca', 'nikita', 'garth', 'pablo', 'elias']) expect(looksFemale(n)).toBe(false);
    expect(looksFemale('zorvina')).toBe(true);
    expect(looksFemale('tarquel')).toBe(false);
  });

  it('C31/unit: Imogen and Rose get women\'s fakes, Joshua a man\'s', () => {
    for (const [first, list] of [['Imogen', FAKES.en.female], ['Rose', FAKES.en.female], ['Joshua', FAKES.en.male], ['Belén', FAKES.es.female]] as const) {
      const res = blind([`From: ${first} Hale <hale@hale-studio.example>\n${first === 'Belén' ? 'Hola, te paso la nota.' : 'Hi, here is the note.'}`], { seed: 'readme', now: NOW });
      expect(has(list, fakeOf(res.mapping.pairs, 'person', first))).toBe(true);
    }
  });
});
