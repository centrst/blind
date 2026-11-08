/**
 * The pair log and the letter-case helpers that decide what blind writes and
 * what unblind gives back. Every value below is invented.
 */
import { describe, expect, it } from 'vitest';
import { adaptCase, caseLike, caseVariants } from '../src/case.js';
import { fakesPattern, findFakes } from '../src/match.js';
import { PairLog } from '../src/pairlog.js';

describe('letter case', () => {
  it('C1/unit: adaptCase keeps ALL CAPS of two letters or more, all lower, and leaves anything else as the fake is', () => {
    expect(adaptCase('ANA', 'Lucía')).toBe('LUCÍA');
    expect(adaptCase('ana', 'Lucía')).toBe('lucía');
    expect(adaptCase('Ana', 'Lucía')).toBe('Lucía');
    expect(adaptCase('McAna', 'Lucía')).toBe('Lucía');
    expect(adaptCase('A', 'Lucía')).toBe('Lucía');
    expect(adaptCase('a', 'Lucía')).toBe('lucía');
    expect(adaptCase('12-34', 'Lucía')).toBe('Lucía');
  });

  it('C1/unit: caseLike follows a mixed phrase word by word when the word counts match', () => {
    expect(caseLike('the Company', 'Estival Servicios')).toBe('estival Servicios');
    expect(caseLike('The COMPANY', 'Estival Servicios')).toBe('Estival SERVICIOS');
    expect(caseLike('  la   Empresa ', 'Estival Servicios')).toBe('estival Servicios');
    expect(caseLike('THE COMPANY', 'Estival Servicios')).toBe('ESTIVAL SERVICIOS');
    expect(caseLike('the company', 'Estival Servicios')).toBe('estival servicios');
    expect(caseLike('The Company', 'Estival Servicios')).toBe('Estival Servicios');
    // A word count that differs, or a single mixed word, keeps the fake as it is.
    expect(caseLike('the Big Company', 'Estival Servicios')).toBe('Estival Servicios');
    expect(caseLike('McAna', 'Estival')).toBe('Estival');
    expect(caseLike('No 5', 'Estival Servicios')).toBe('Estival Servicios');
  });

  it('C1/unit: caseVariants gives the fake, then lower, capitals, each word capitalised, one letter flipped at a time, then every other capitalisation, each once', () => {
    const lucia = [...caseVariants('Lucia')];
    expect(lucia.slice(0, 7)).toEqual(['Lucia', 'lucia', 'LUCIA', 'LUcia', 'LuCia', 'LucIa', 'LuciA']);
    // Then every other capitalisation, each once: 2^5 in all.
    expect(lucia).toHaveLength(32);
    expect(new Set(lucia).size).toBe(32);
    expect(new Set(lucia.map((v) => v.toLowerCase()))).toEqual(new Set(['lucia']));
    // An address walks every capitalisation too. The whole walk is checked on a
    // short one, since 22 letters would be 2^22 strings.
    const short = [...caseVariants('sa@g.example')];
    expect(short.slice(0, 4)).toEqual(['sa@g.example', 'SA@G.EXAMPLE', 'Sa@G.Example', 'Sa@g.example']);
    expect(short).toHaveLength(2 ** 10);
    expect(new Set(short).size).toBe(2 ** 10);
    expect(new Set(short.map((m) => m.toLowerCase()))).toEqual(new Set(['sa@g.example']));
    // A long address starts the same way, and the first 20,000 it gives are distinct capitalisations of it.
    const mail: string[] = [];
    for (const m of caseVariants('sala@grupo-ribera.example')) if (mail.push(m) === 20_000) break;
    expect(mail.slice(0, 4)).toEqual(['sala@grupo-ribera.example', 'SALA@GRUPO-RIBERA.EXAMPLE', 'Sala@Grupo-Ribera.Example', 'Sala@grupo-ribera.example']);
    expect(mail).toHaveLength(20_000);
    expect(new Set(mail.map((m) => m.toLowerCase()))).toEqual(new Set(['sala@grupo-ribera.example']));
    expect(new Set(mail).size).toBe(mail.length);
    expect([...caseVariants('600-12')]).toEqual(['600-12']);
  });
});

describe('fakesPattern', () => {
  const find = (fake: string, text: string): string[] => [...findFakes(text, new RegExp(fakesPattern([fake]), 'giu'))].map((m) => `${m.index}:${m[0]}`);

  it('C1/unit: a letter edge refuses a letter beside it, a digit edge refuses a digit, other edges refuse nothing', () => {
    expect(find('Lucia', 'Lucia, lucia7, 7Lucia, Luciana, aLucia')).toEqual(['0:Lucia', '7:lucia', '16:Lucia']);
    expect(find('612 345', '612 345x9, 9612 345, 612 3456, a612 345')).toEqual(['0:612 345', '32:612 345']);
    expect(find('+34 6', 'x+34 6.')).toEqual(['1:+34 6']);
    expect(find('(9)', 'a(9)b')).toEqual(['1:(9)']);
    expect(find('a.b?', 'za.b?z')).toEqual([]);
    expect(find('a.b?', 'z a.b?z')).toEqual(['2:a.b?']);
    // A letter outside the BMP before the fake counts as a letter.
    expect(find('Ana', '\u{1D4D0}Ana \u{1F600}Ana')).toEqual(['8:Ana']);
    // Longest first, and a shorter fake where the longer one would end inside a word.
    expect([...findFakes('Ana Ruizs, Ana Ruiz.', new RegExp(fakesPattern(['Ana', 'Ana Ruiz']), 'giu'))].map((m) => `${m.index}:${m[0]}`)).toEqual(['0:Ana', '11:Ana Ruiz']);
  });
});

describe('PairLog', () => {
  it('C1/unit: a claimed fake gives back its value exactly, and a second value cannot claim it', () => {
    const log = new PairLog();
    expect(log.claim('org', 'the Company', 'estival Servicios')).toBe(true);
    expect(log.claim('org', 'The Company', 'Estival Servicios')).toBe(true);
    expect(log.claim('org', 'The Company', 'Estival Servicios')).toBe(true);
    expect(log.claim('org', 'THE Company', 'Estival Servicios')).toBe(false);
    expect(log.pairs).toEqual([
      { kind: 'org', real: 'the Company', fake: 'estival Servicios' },
      { kind: 'org', real: 'The Company', fake: 'Estival Servicios' },
    ]);
    expect(log.restore('estival Servicios')).toBe('the Company');
    expect(log.restore('Estival Servicios')).toBe('The Company');
    expect(log.ownerOf('Estival Servicios')).toBe('The Company');
    expect(log.ownerOf('ESTIVAL SERVICIOS')).toBeUndefined();
    expect(log.fakeOf('org', 'The Company')).toBe('Estival Servicios');
    expect(log.fakeOf('person', 'The Company')).toBeUndefined();
    expect(log.fakeOf('org', 'THE Company')).toBeUndefined();
    expect(log.knows('ESTIVAL servicios')).toBe(true);
    expect(log.knows('Estival')).toBe(false);
    expect(log.keys()).toEqual(['estival servicios']);
  });

  it('C1/unit: another letter case comes back through the first pair, a name in the case it is written in, anything else as stored', () => {
    const log = new PairLog([
      { kind: 'person', real: 'Ana', fake: 'Lucia' },
      { kind: 'person', real: 'ANA', fake: 'LUCIA' },
      { kind: 'email', real: 'Ana@ondara.example', fake: 'lucia@grupo-ribera.example' },
      { kind: 'place', real: 'Valdecañas', fake: 'Brookfield' },
    ]);
    expect(log.pairs).toEqual([]);
    expect(log.restore('LUCIA')).toBe('ANA');
    expect(log.restore('lucia')).toBe('ana');
    expect(log.restore('LuCia')).toBe('Ana');
    expect(log.restore('BROOKFIELD')).toBe('VALDECAÑAS');
    expect(log.restore('LUCIA@GRUPO-RIBERA.EXAMPLE')).toBe('Ana@ondara.example');
    expect(log.restore('Nadie')).toBeUndefined();
    const plain = new PairLog([{ kind: 'person', real: 'Ana', fake: '[REDACTED_PERSON_1]' }], false);
    expect(plain.restore('[redacted_person_1]')).toBe('Ana');
  });

  it('C1/unit: an earlier pair holds its fake, and is read but not listed again', () => {
    const log = new PairLog([{ kind: 'person', real: 'Maria', fake: 'Lucia' }]);
    expect(log.claim('person', 'María', 'Lucia')).toBe(false);
    expect(log.claim('person', 'Maria', 'Lucia')).toBe(true);
    expect(log.fakeOf('person', 'Maria')).toBe('Lucia');
    expect(log.pairs).toEqual([]);
  });

  it('C1/unit: a reservation is listed after the claims, once, and only when no value claimed its fake', () => {
    const log = new PairLog([{ kind: 'domain', real: 'old.example', fake: 'taken.example' }]);
    log.reserve('person', 'Ana', 'Lucia');
    log.reserve('person', 'Ana', 'Lucia');
    log.reserve('domain', 'ondara.example', 'grupo-ribera.example');
    log.reserve('domain', 'other.example', 'taken.example');
    log.reserve('org', 'Ondara', 'Norvale');
    expect(log.ownerOf('Lucia')).toBeUndefined();
    expect(log.fakeOf('person', 'Ana')).toBeUndefined();
    expect(log.claim('person', 'A​na', 'Lucia')).toBe(true);
    expect(log.claim('org', 'ONDARA', 'NORVALE')).toBe(true);
    expect(log.pairs).toEqual([
      { kind: 'person', real: 'A​na', fake: 'Lucia' },
      { kind: 'org', real: 'ONDARA', fake: 'NORVALE' },
      { kind: 'domain', real: 'ondara.example', fake: 'grupo-ribera.example' },
      { kind: 'org', real: 'Ondara', fake: 'Norvale' },
    ]);
  });
});
