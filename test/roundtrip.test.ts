/**
 * Round trips the Gretel benchmark found broken, as invented minimal cases.
 * A stub detector stands in for a NER model where the core finds nothing on
 * its own: a role word in any letter case, a name glued to digits.
 */
import { describe, expect, it } from 'vitest';
import { blind, unblind, type Detector, type KnownValue, type Mapping, type ReplaceWith, type Span } from '../src/index.js';
import { fakesPattern, findFakes } from '../src/match.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const MODES: ReplaceWith[] = ['fake', 'placeholder', 'random'];

/** Marks every case-insensitive match of `pattern` as `kind`, the way a NER model returns spans. */
function stub(kind: 'person' | 'org', pattern: RegExp): Detector {
  return {
    name: 'stub',
    detect(text) {
      const out: Span[] = [];
      for (const m of text.matchAll(pattern)) out.push({ start: m.index, end: m.index + m[0].length, kind, priority: 50 });
      return out;
    },
  };
}

const roundTrips = (text: string, opts: { known?: KnownValue[]; detectors?: Detector[]; replaceWith?: ReplaceWith; seed?: string; mapping?: Mapping } = {}): ReturnType<typeof blind> => {
  const res = blind([text], { seed: 'rt', now: NOW, ...opts });
  expect(unblind(res.texts[0] as string, JSON.parse(JSON.stringify(res.mapping)) as Mapping).text).toBe(text);
  return res;
};

describe('round trip on text from outside the corpus', () => {
  it('C1/unit: a fake may touch a digit but not a letter, and a number may touch a letter but not a digit', () => {
    const find = (fake: string, text: string): string[] => [...findFakes(text, new RegExp(fakesPattern([fake]), 'giu'))].map((m) => m[0]);
    expect(find('Hugo', 'hugo420, Hugo. 7Hugo')).toEqual(['hugo', 'Hugo', 'Hugo']);
    expect(find('Hugo', 'Hugon, aHugo')).toEqual([]);
    expect(find('(207)555-0150', 'Tel (207)555-0150x493.')).toEqual(['(207)555-0150']);
    expect(find('171-7650', '171-76501 and 9171-7650')).toEqual([]);
  });

  it('C1/unit: a name glued to digits comes back in every mode', () => {
    const text = 'El programa lo dirige brescia420, con Ivo Brescia de enlace.';
    for (const replaceWith of MODES) {
      const res = roundTrips(text, { replaceWith, known: [{ kind: 'person', value: 'Ivo Brescia' }], detectors: [stub('person', /brescia(?=\d)/giu)] });
      expect(res.texts[0], replaceWith).not.toMatch(/brescia/i);
    }
  });

  it('C1/unit: one org in three letter cases keeps one fake, written in each case, and comes back in every mode', () => {
    const text = 'The Company agrees. Then the Company pays, and THE COMPANY signs.';
    const detectors = [stub('org', /the company/giu)];
    for (const replaceWith of MODES) roundTrips(text, { replaceWith, detectors });
    const res = roundTrips(text, { detectors });
    const fakes = res.mapping.pairs.filter((p) => p.kind === 'org').map((p) => p.fake);
    expect(new Set(fakes.map((f) => f.toLowerCase())).size).toBe(1);
    expect(new Set(fakes).size).toBe(3);
  });

  it('C1/unit: a role word in lower case, as a title and in capitals comes back as written beside a heading', () => {
    const text = 'CLÁUSULAS DE LA EMPRESA\n\nLa Empresa paga. Según la Empresa, la empresa cobra.\nN\nNuestra organización y nuestra organización.';
    const detectors = [stub('org', /la empresa|nuestra organización/giu)];
    for (const replaceWith of MODES) roundTrips(text, { replaceWith, detectors });
  });

  it('C1/unit: a name with and without its accent comes back as written, a case change keeps the fake and an accent change gets its own', () => {
    const res = roundTrips('Hola Belén Quiroga. Gracias, Belen. Firmado: BELÉN QUIROGA.', { known: [{ kind: 'person', value: 'Belén Quiroga' }] });
    const first = res.mapping.pairs.filter((p) => p.kind === 'person' && /^bel[eé]n$/i.test(p.real));
    const fakeOf = (real: string): string | undefined => first.find((p) => p.real === real)?.fake.toLowerCase();
    expect(fakeOf('BELÉN')).toBe(fakeOf('Belén'));
    expect(fakeOf('Belen')).not.toBe(fakeOf('Belén'));
  });

  it('C1/unit: an address and a host in two letter cases each come back as written', () => {
    roundTrips('Write to TQuiroga@lindera.example or tquiroga@lindera.example. More at www.Lindera.example and www.lindera.example.');
  });

  it('C1/unit: a number written with a full-width digit and plainly gets two fakes and both come back, in every mode', () => {
    const text = 'Llama al 791 345 678 o al ７91 345 678. Cuenta ES91 2100 0418 4502 0005 1332 y ES91 2100 0418 4502 0005 133２. Ref 20481735 y 2048173５.';
    for (const replaceWith of MODES) {
      const res = roundTrips(text, { replaceWith });
      for (const kind of ['phone', 'iban', 'id'] as const) {
        const fakes = res.mapping.pairs.filter((p) => p.kind === kind).map((p) => p.fake);
        expect(new Set(fakes).size, `${replaceWith} ${kind}`).toBe(fakes.length);
      }
    }
  });

  it('C1/unit: one address in every capitalisation of its local part still comes back, each as written', () => {
    const forms = Array.from({ length: 64 }, (_, mask) => [...'abcdef'].map((c, i) => (mask & (1 << i) ? c.toUpperCase() : c)).join(''));
    const res = roundTrips(forms.map((f) => `${f}@ondara.example`).join('; '));
    const fakes = res.mapping.pairs.filter((p) => p.kind === 'email').map((p) => p.fake);
    expect(fakes).toHaveLength(64);
    expect(new Set(fakes.map((f) => f.toLowerCase())).size).toBe(1);
  });

  it('C21/unit: a later turn keeps the fake each spelling got, and both turns round trip with the last mapping', () => {
    const known: KnownValue[] = [{ kind: 'person', value: 'Belén Quiroga' }];
    const one = 'Hola Belén Quiroga. Gracias, Belen.';
    const two = 'Otra vez Belen y BELÉN QUIROGA.';
    const a = blind([one], { seed: 'turns', now: NOW, known });
    const b = blind([two], { mapping: a.mapping, now: NOW });
    for (const p of a.mapping.pairs) expect(b.mapping.pairs).toContainEqual(p);
    const fake = (m: Mapping, real: string): string | undefined => m.pairs.find((p) => p.kind === 'person' && p.real === real)?.fake;
    expect(fake(b.mapping, 'Belen')).toBe(fake(a.mapping, 'Belen'));
    expect(unblind(a.texts[0] as string, b.mapping).text).toBe(one);
    expect(unblind(b.texts[0] as string, b.mapping).text).toBe(two);
  });
});
