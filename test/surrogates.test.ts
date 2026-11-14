/**
 * The fake generators on their own: what each keeps of the value, what it
 * claims in the pair log, and how an earlier call's pairs are read back.
 * Every value below is invented.
 */
import { describe, expect, it } from 'vitest';
import { blind } from '../src/index.js';
import { luhnValid } from '../src/ids.js';
import { FAKES, FEMALE_FIRST, LAST_NAMES, MALE_FIRST, PLACES } from '../src/names.js';
import { Rng } from '../src/prng.js';
import { PairLog } from '../src/pairlog.js';
import { asciiLower, Surrogates } from '../src/surrogates.js';
import type { Pair } from '../src/types.js';
import { ibanValid } from './support/values.js';

const lower = (xs: readonly string[]): Set<string> => new Set(xs.map(asciiLower));
const FEMALE = lower(FEMALE_FIRST);
const MALE = lower(MALE_FIRST);
const LAST = lower(LAST_NAMES);

function make(seed = 'sur', opts: { avoid?: string[]; texts?: string[]; earlier?: Pair[] } = {}): { sur: Surrogates; log: PairLog } {
  const log = new PairLog(opts.earlier ?? []);
  const sur = new Surrogates(new Rng(seed), { avoid: new Set(opts.avoid ?? []), isAllowedHost: (h) => h === 'gmail.com' || h.endsWith('.gmail.com'), log, texts: opts.texts });
  if (opts.earlier) sur.restore(opts.earlier);
  return { sur, log };
}

describe('people', () => {
  it('C2/unit: a first name gets a first name of the same look and a surname gets a surname, by position or around a comma', () => {
    const { sur } = make();
    const [f1, l1] = sur.person('Ana Ruiz').split(' ') as [string, string];
    expect(FEMALE.has(asciiLower(f1))).toBe(true);
    expect(LAST.has(asciiLower(l1))).toBe(true);
    const [f2] = sur.person('Pedro Lamas').split(' ') as [string];
    expect(MALE.has(asciiLower(f2))).toBe(true);
    // "Surname, First": the word after the comma is the first name.
    const [l3, f3] = sur.person('Zubiri, Carmen').split(', ') as [string, string];
    expect(LAST.has(asciiLower(l3))).toBe(true);
    expect(FEMALE.has(asciiLower(f3))).toBe(true);
    expect(MALE.has(asciiLower(sur.person('Luca Brindisi').split(' ')[0] as string))).toBe(true);
    expect(FEMALE.has(asciiLower(sur.person('Beatriz Ocaña').split(' ')[0] as string))).toBe(true);
  });

  it('C2/unit: particles and one-letter words stay, and a token keeps its fake in every letter case', () => {
    const { sur } = make();
    const out = sur.person('Ana de la Fuente');
    expect(out).toMatch(/^\S+ de la \S+$/);
    expect(sur.person('J. Ruiz')).toMatch(/^J\. \S+$/);
    const fake = out.split(' ')[0] as string;
    expect(sur.person('ANA')).toBe(fake.toUpperCase());
    expect(sur.person('ana')).toBe(fake.toLowerCase());
  });

  it('C1/unit: the base fake of a name is reserved for its plain spelling, and each spelling written gets a pair', () => {
    const { sur, log } = make();
    const fake = sur.person('ANA');
    expect(log.pairs).toEqual([
      { kind: 'person', real: 'ANA', fake },
      { kind: 'person', real: 'Ana', fake: fake[0] + fake.slice(1).toLowerCase() },
    ]);
    expect(sur.person('Ana')).toBe(fake[0] + fake.slice(1).toLowerCase());
    expect(log.pairs).toHaveLength(2);
    // Another spelling of the same letters gets its own base fake.
    const other = sur.person('Aña');
    expect(asciiLower(other)).not.toBe(asciiLower(fake));
    expect(sur.person('AÑA')).toBe(other.toUpperCase());
    // A spelling that differs only in case from the holder of the fake gets another case of it.
    const { sur: s2 } = make('mc');
    const a = s2.person('McAdam');
    const b = s2.person('Mcadam');
    expect(b).not.toBe(a);
    expect(b.toLowerCase()).toBe(a.toLowerCase());
  });

  it('C1/unit: a known name is primed without writing a pair for its spelling', () => {
    const { sur, log } = make();
    sur.prime('Ana Ruiz');
    expect(log.pairs.map((p) => p.real)).toEqual(['Ana', 'Ruiz']);
    expect(sur.email('aruiz@ondara.example')).toMatch(/^[a-z][a-z]+@[a-z]+-[a-z]+\.example$/);
  });

  it('C1/unit: look-alike letters and hidden characters in a name come back through a pair for the whole span', () => {
    const { sur, log } = make();
    const out = sur.person('Ana Ruiz', 'A​na Ruiz');
    expect(log.pairs).toContainEqual({ kind: 'person', real: 'A​na Ruiz', fake: out });
    expect(log.restore(out)).toBe('A​na Ruiz');
    expect(sur.person('Ana', 'A​na')).toBe(out.split(' ')[0]);
  });

  it('C2/unit: when the lists run out the fake is made of syllables', () => {
    const { sur } = make('syl', { avoid: [...FEMALE] });
    expect(sur.person('Ana')).toMatch(/^[A-Z][a-z]{5}$/);
  });
});

describe('orgs and places', () => {
  it('C1/unit: an org keeps its suffix and the case of each word, and its name without the suffix is reserved', () => {
    const { sur, log } = make();
    const out = sur.org('Talleres Ondara S.L.');
    expect(out).toMatch(/^\S+ \S+ S\.L\.$/);
    // A Spanish company, so its fake leads with a Spanish noun: "Asesores Lumera S.L.".
    expect(FAKES.es.orgNouns).toContain(out.split(' ')[0]);
    expect(FAKES.es.orgBases).toContain(out.split(' ')[1]);
    expect(sur.org('the Ondara')).toMatch(/^[a-z]\S* [A-Z]\S*$/);
    const core = out.replace(/ S\.L\.$/, '');
    expect(log.pairs).toContainEqual({ kind: 'org', real: 'Talleres Ondara', fake: core });
    expect(sur.org('TALLERES ONDARA S.L.')).toBe(`${core.toUpperCase()} S.L.`);
  });

  it('C1/unit: a place keeps its fake in every case, and another spelling gets its own', () => {
    const { sur } = make();
    const a = sur.place('Valdecañas');
    expect(PLACES).toContain(a);
    expect(sur.place('VALDECAÑAS')).toBe(a.toUpperCase());
    expect(sur.place('Valdecañas')).toBe(a);
    expect(sur.place('Valdecanas', 'Valdecanas')).not.toBe(a);
  });
});

describe('hosts, addresses and links', () => {
  it('C2/unit: a host keeps common labels and a two-letter country suffix, and a public host stays', () => {
    const { sur } = make();
    // The test needs a country suffix, so `.example` will not do. The underscore keeps the hosts unregistrable.
    const a = sur.domain('mail.ondara_.co.uk');
    expect(a).toMatch(/^mail\.[a-z]+-[a-z]+\.example$/);
    const reg = a.slice('mail.'.length);
    expect(sur.domain('ondara_.co.uk')).toBe(reg);
    expect(sur.domain('ventas.ondara_.co.uk')).toMatch(new RegExp(`^[a-z]+\\.${reg.replace(/\./g, '\\.')}$`));
    expect(sur.domain('ventas.ondara_.co.uk')).not.toMatch(/^ventas\./);
    expect(sur.domain('x.ondara_.com')).toMatch(/^x\.[a-z]+-[a-z]+\.example$/);
    expect(sur.domain('ondara_.com')).not.toBe(reg);
    expect(sur.domain('mail.gmail.com')).toBe('mail.gmail.com');
  });

  it('C1/unit: a host written with capitals gets another case of its fake, so both come back', () => {
    const { sur, log } = make();
    const a = sur.domainSpan('ondara.example');
    const b = sur.domainSpan('ondara.example', 'Ondara.example');
    expect(b).not.toBe(a);
    expect(b.toLowerCase()).toBe(a);
    expect(log.restore(a)).toBe('ondara.example');
    expect(log.restore(b)).toBe('Ondara.example');
  });

  it('C2/unit: an address builds its local part from the names it holds and keeps role words and short runs', () => {
    const { sur } = make();
    const [first, last] = sur.person('Ana Ruiz').split(' ').map(asciiLower) as [string, string];
    expect(sur.email('ana.ruiz@ondara.example')).toMatch(new RegExp(`^${first}\\.${last}@[a-z]+-[a-z]+\\.example$`));
    expect(sur.email('aruiz@ondara.example').split('@')[0]).toBe(`${first[0]}${last}`);
    expect(sur.email('anaruiz@ondara.example').split('@')[0]).toBe(`${first}${last}`);
    expect(sur.email('info@ondara.example')).toMatch(/^info@/);
    expect(sur.email('ab@ondara.example')).toMatch(/^ab@/);
    const d1 = sur.email('ventas2024@ondara.example').split('@')[0] as string;
    const d2 = sur.email('soporte2024@ondara.example').split('@')[0] as string;
    expect(d1).toMatch(/^ventas\d{4}$/);
    expect(d1).not.toBe('ventas2024');
    expect(d2.slice(-4)).toBe(d1.slice(-4));
    expect(sur.email('nobody-at-all')).toBe('nobody-at-all');
    expect(sur.email('x_y@gmail.com')).toBe('x_y@gmail.com');
  });

  it('C1/unit: an address in two letter cases gets two cases of one fake', () => {
    const { sur, log } = make();
    const a = sur.email('tquiroga@lindera.example');
    const b = sur.email('tquiroga@lindera.example', 'TQuiroga@lindera.example');
    expect(b).not.toBe(a);
    expect(b.toLowerCase()).toBe(a.toLowerCase());
    expect(log.restore(b)).toBe('TQuiroga@lindera.example');
  });

  it('C2/unit: a link keeps scheme, port and layout, maps known names and long numbers in the path, and an address inside it', () => {
    const { sur } = make();
    const name = asciiLower(sur.person('Ana'));
    const out = sur.url('https://ondara.example:8443/clientes/ana/2024ab77?ref=ana@ondara.example#top');
    expect(out).toMatch(new RegExp(`^https://[a-z]+-[a-z]+\\.example:8443/clientes/${name}/[0-9a-z]{8}\\?ref=${name}@[a-z]+-[a-z]+\\.example#top$`));
    expect(out).not.toContain('2024ab77');
    const ip = sur.url('http://192.168.10.20/panel');
    expect(ip).toMatch(/^http:\/\/(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+\/panel$/);
    expect(sur.url('/only/a/path')).toBe('/only/a/path');
  });
});

describe('numbers', () => {
  it('C2/unit: a phone keeps its prefix and layout, and a Spanish mobile moves to the unattributed 75 to 79', () => {
    const { sur } = make();
    // A live-range 6xx mobile on purpose: the test proves it moves into the reserved 75 to 79. Only the 6 prefix is
    // written; the rest is drawn at run time, and the checks are booleans so a failure prints neither number.
    const rng = new Rng('C2/unit live mobile');
    const digits = `6${Array.from({ length: 8 }, () => rng.int(10)).join('')}`;
    const live = `+34 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
    const a = sur.phone(live);
    expect(/^\+34 7[5-9]\d \d{3} \d{3}$/.test(a), 'fake is +34 7[5-9]x xxx xxx').toBe(true);
    expect(a !== live, 'fake differs').toBe(true);
    expect(sur.phone(digits) === a.replace(/^\+34 /, '').replace(/ /g, ''), 'bare digits get the same fake').toBe(true);
    const drama = '0044 20 7946 0000';
    // A London number, drama range or not, gets another number in London's drama range.
    expect(sur.phone(drama)).toMatch(/^0044 20 7946 0\d{3}$/);
    expect(sur.phone(drama)).not.toBe(drama);
    // Country code 999 is unassigned; the digits after it are only a layout.
    expect(sur.phone(['+999', '123', '456'].join(' '))).toMatch(/^\+99\d \d{3} \d{3}$/);
    expect(sur.phone('(615)555-0142')).toMatch(/^\(\d{3}\)555-01\d{2}$/);
  });

  it('C31/unit: a phone keeps what kind of line it is: UK, Spanish and North American mobiles, landlines and special-rate numbers', () => {
    const { sur } = make('lines');
    // The inputs below are live-range lines on purpose: the test proves each kind lands in a reserved range or keeps its kind.
    const nanp = /^[2-9][0-8]\d55501\d{2}$/;
    const n11 = (d: string): boolean => d.slice(1, 3) === '11' || d.slice(4, 6) === '11';
    let moved60 = 0;
    for (let i = 0; i < 40; i++) {
      const d = String(100000 + i * 7919).slice(-6);
      expect(sur.phone(`+44 7700 ${d}`)).toMatch(/^\+44 7700 900\d{3}$/);
      expect(sur.phone(`07700 ${d}`)).toMatch(/^07700 900\d{3}$/);
      expect(sur.phone(`+44 20 79${d.slice(0, 2)} ${d.slice(2)}`)).toMatch(/^\+44 20 \d{4} \d{4}$/);
      expect(sur.phone(`020 79${d.slice(0, 2)} ${d.slice(2)}`)).toMatch(/^020 \d{4} \d{4}$/);
      expect(sur.phone(`+34 712 ${d.slice(0, 3)} ${d.slice(3)}`)).toMatch(/^\+34 7[5-9]\d \d{3} \d{3}$/);
      expect(sur.phone(`6${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}12`)).toMatch(/^7[5-9]\d \d{3} \d{3}$/);
      if (/^7[5-9]/.test(sur.phone(`600 ${d.slice(0, 3)} ${d.slice(3)}`))) moved60++;
      expect(sur.phone(`912 ${d.slice(0, 3)} ${d.slice(3)}`)).toMatch(/^9[1-8]\d \d{3} \d{3}$/);
      expect(sur.phone(`900 ${d.slice(0, 3)} ${d.slice(3)}`)).toMatch(/^900 \d{3} \d{3}$/);
      expect(sur.phone(`+34 702 ${d.slice(0, 3)} ${d.slice(3)}`)).toMatch(/^\+34 70\d \d{3} \d{3}$/);
      const us = sur.phone(`(415) 555-${d.slice(2)}`);
      expect(us).toMatch(/^\(\d{3}\) \d{3}-\d{4}$/);
      expect(us.replace(/\D/g, '')).toMatch(nanp);
      expect(n11(us.replace(/\D/g, ''))).toBe(false);
      expect(sur.phone(`+1 415 555 ${d.slice(2)}`).replace(/\D/g, '').slice(1)).toMatch(nanp);
      expect(sur.phone(`+49 151 674 ${d.slice(2)}`)).toMatch(/^\+49 1\d\d \d{3} \d{4}$/);
      expect(sur.phone(`06 12 ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}`)).toMatch(/^06 \d\d \d\d \d\d \d\d$/);
    }
    // A Spanish mobile starting 60 is a mobile like any other, unlike 900 or 702, which keep their three digits.
    expect(moved60).toBe(40);
  });

  it('C31/unit: a UK mobile written nationally is found as one phone', () => {
    const res = blind(['Call me on 07700 900123, or 07700900123, or 07700 900 123 after six.'], { seed: 'uk' });
    expect(res.mapping.pairs.filter((p) => p.kind === 'phone').map((p) => p.real)).toEqual(['07700 900123', '07700900123', '07700 900 123']);
    for (const real of ['07700 900123', '07700900123', '07700 900 123']) expect(res.texts[0]).not.toContain(real);
  });

  it('C1/unit: a number written another way that holds the same fake gets another one, and a fake already in the input is not used', () => {
    const { sur, log } = make('num');
    const a = sur.phone('791 345 678');
    const b = sur.phone('791 345 678', '７91 345 678');
    expect(b).not.toBe(a);
    expect(log.restore(b)).toBe('７91 345 678');
    const again = make('num', { texts: [`Old line ${a}.`] }).sur.phone('791 345 678');
    expect(again).not.toBe(a);
    const iban1 = sur.iban('ES91 2100 0418 4502 0005 1332');
    const iban2 = sur.iban('ES91 2100 0418 4502 0005 1332', 'ES91 2100 0418 4502 0005 133２');
    expect(iban2).not.toBe(iban1);
    const id1 = sur.id('EXP-2026-0412');
    expect(sur.id('EXP-2026-0412', 'ＥXP-2026-0412')).not.toBe(id1);
    const card = sur.typedId('4111 1111 1111 1111', 'card');
    expect(sur.typedId('4111 1111 1111 1111', 'card', '４111 1111 1111 1111')).not.toBe(card);
  });

  it('C20/unit: an IBAN keeps its country and spacing with valid check digits, an id keeps its shape, a card passes Luhn', () => {
    const { sur } = make();
    const iban = sur.iban('ES91 2100 0418 4502 0005 1332');
    expect(iban).toMatch(/^ES\d{2}( \d{4}){5}$/);
    expect(ibanValid(iban.replace(/\s/g, ''))).toBe(true);
    expect(sur.iban('ES9121000418450200051332')).toBe(iban.replace(/\s/g, ''));
    const id = sur.id('EXP-2026-0412');
    expect(id).toMatch(/^[A-Z]{3}-\d{4}-\d{4}$/);
    expect(id).not.toBe('EXP-2026-0412');
    expect(sur.id('exp-2026-0412')).toMatch(/^[a-z]{3}-\d{4}-\d{4}$/);
    const card = sur.typedId('4111-1111-1111-1111', 'card');
    expect(card).toMatch(/^4\d{3}-\d{4}-\d{4}-\d{4}$/);
    expect(luhnValid(card.replace(/-/g, ''))).toBe(true);
    expect(sur.typedId('4111 1111 1111 1111', 'card')).toBe(card.replace(/-/g, ' '));
    expect(sur.typedId('192.168.1.7', 'ipv4')).toMatch(/^(192\.0\.2|198\.51\.100|203\.0\.113)\.\d+$/);
    // One address in two layouts: one fake address, the second in capitals so each layout comes back.
    const v6 = sur.typedId('2001:db8::1', 'ipv6');
    expect(sur.typedId('2001:0db8:0:0:0:0:0:1', 'ipv6')).toBe(v6.toUpperCase());
  });
});

describe('continuing', () => {
  it('C21/unit: the pairs of an earlier call give every value the same fake again and keep spelling fakes apart', () => {
    const one = make('turns');
    const s1 = one.sur;
    const values = {
      person: s1.person('Ana Ruiz'),
      upper: s1.person('RUIZ'),
      accent: s1.person('Rúiz'),
      org: s1.org('Talleres Ondara'),
      orgAccent: s1.org('Talleres Óndara'),
      orgSuffix: s1.org('Talleres Ondara S.L.'),
      place: s1.place('Villaluenga del Monte'),
      email: s1.email('ana.ruiz@ondara.example'),
      url: s1.url('https://ondara.example/precios'),
      domain: s1.domainSpan('ondara.example'),
      phone: s1.phone('+34 791 345 678'),
      iban: s1.iban('ES91 2100 0418 4502 0005 1332'),
      id: s1.id('EXP-2026-0412'),
      card: s1.typedId('4111 1111 1111 1111', 'card'),
      ip: s1.typedId('192.168.1.7', 'ipv4'),
      ip6: s1.typedId('2001:db8::7', 'ipv6'),
    };
    const pairs = one.log.pairs;
    const { sur: s2 } = make('another seed', { earlier: pairs });
    expect(s2.person('Ana Ruiz')).toBe(values.person);
    expect(s2.person('ruiz')).toBe(values.upper.toLowerCase());
    expect(s2.person('RÚIZ')).toBe(values.accent.toUpperCase());
    expect(s2.org('Talleres Ondara')).toBe(values.org);
    expect(s2.org('TALLERES ÓNDARA')).toBe(values.orgAccent.toUpperCase());
    expect(s2.place('Villaluenga del Monte')).toBe(values.place);
    expect(s2.place('villaluenga del monte')).toBe(values.place.toLowerCase());
    expect(s2.email('ana.ruiz@ondara.example')).toBe(values.email);
    expect(s2.email('ANA.RUIZ@ondara.example')).toBe(values.email.toUpperCase());
    expect(s2.url('https://ondara.example/precios')).toBe(values.url);
    expect(s2.domainSpan('ondara.example')).toBe(values.domain);
    expect(s2.domain('ondara.example')).toBe(values.domain);
    expect(s2.phone('+34 791 345 678')).toBe(values.phone);
    expect(s2.phone('791 345 678')).toBe(values.phone.replace(/^\+34 /, ''));
    expect(s2.iban('ES91 2100 0418 4502 0005 1332')).toBe(values.iban);
    expect(s2.iban('ES9121000418450200051332')).toBe(values.iban.replace(/\s/g, ''));
    expect(s2.id('EXP-2026-0412')).toBe(values.id);
    expect(s2.typedId('4111-1111-1111-1111', 'card')).toBe(values.card.replace(/ /g, '-'));
    expect(s2.typedId('192.168.1.7', 'ipv4')).toBe(values.ip);
    expect(s2.typedId('2001:db8::7', 'ipv6')).toBe(values.ip6);
    expect(s2.typedId('2001:0db8::7', 'ipv6')).toBe(values.ip6.toUpperCase());
    // New values never get a fake an earlier call gave out.
    const taken = new Set(pairs.map((p) => asciiLower(p.fake.split(/\s+/)[0] as string)));
    for (const n of ['Pilar', 'Rosa', 'Marta', 'Elena', 'Clara']) expect(taken.has(asciiLower(s2.person(n)))).toBe(false);
  });
});

describe('generic id fakes', () => {
  const fakes = (text: string): string[] => Array.from({ length: 60 }, (_, i) => /EXP-\S+|[A-Z]{3}-\d{4}-\d{4}/.exec(blind([text], { seed: `d${i}` }).texts[0] as string)?.[0] as string);

  it('keep a leading digit that is not zero when the original has one, and may start with zero when the original does', () => {
    const plain = fakes('Expediente EXP-5555-7777.');
    for (const f of plain) expect(f).toMatch(/^[A-Z]{3}-[1-9]\d{3}-\d{4}$/);
    expect(plain.some((f) => /0/.test(f))).toBe(true);
    const zero = fakes('Expediente EXP-0555-0777.');
    for (const f of zero) expect(f).toMatch(/^[A-Z]{3}-\d{4}-\d{4}$/);
    expect(zero.some((f) => f[4] === '0')).toBe(true);
  });
});
