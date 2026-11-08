import { describe, expect, it } from 'vitest';
import { blind, unblind } from '../src/index.js';
import { FAKES, type Lang } from '../src/names.js';
import type { KnownValue } from '../src/types.js';

const NOW = new Date('2026-06-01T00:00:00Z');

// Invented people and companies, 50 and 30 per language, every word distinct.
const PEOPLE: Record<Lang, { first: string[]; last: string[] }> = {
  en: {
    first: `Harold Priscilla Winston Delphine Gareth Imogen Percival Rosalind Cedric Phoebe Lionel Matilda Ambrose
      Georgina Humphrey Isadora Jasper Lavinia Nigel Odette Quentin Rowena Sebastian Tamsin Valentine Wilhelmina
      Barnaby Cordelia Desmond Frederick Gwendolyn Augustus Beatrice Cuthbert Dorothea Eustace Florence Godfrey
      Henrietta Ignatius Rosamund Lucian Millicent Oswald Prudence Rupert Seraphina Thaddeus Winifred Wilfred`.split(/\s+/),
    last: `Ashworth Bellamy Cartwright Doherty Ellsworth Fairchild Goodwin Haverford Ingram Jessop Kingsley Lambert
      Mortimer Nightingale Oakley Pritchard Quigley Rutherford Somerset Tennant Upshaw Vanstone Whitcombe Yardley
      Abernathy Blackwood Crawley Dunleavy Eldridge Fenmore Gresham Hathaway Inchcombe Jellicoe Kilbride Loxley
      Merriweather Northcott Ostrander Penhaligon Quilter Rookhurst Stallworth Thistlewood Ulverston Vosper
      Wetherall Yeovil Wickham Ambleside`.split(/\s+/),
  },
  es: {
    first: `Joaquín Rosendo Aurora Ernesto Leonor Facundo Gloria Anselmo Belén Cayetano Dolores Eloy Fermina Genaro
      Herminia Isidro Jacinta Lisandro Macarena Nicolás Ofelia Plácido Remedios Saturnino Trinidad Ulises Verónica
      Wenceslao Amparo Baldomero Candelaria Demetrio Estefanía Florencio Griselda Honorio Itziar Casilda Dámaso
      Eulalia Fructuoso Gumersinda Hermenegildo Inocencia Leocadia Modesto Nemesio Petronila Quintín Romualdo`.split(/\s+/),
    last: `Arroyo Bustamante Cifuentes Duarte Espinosa Figueroa Galindo Hidalgo Iglesias Jaramillo Quintana Rebollo
      Zamora Villalobos Sepúlveda Peñalver Ocaña Navarrete Medrano Lazcano Urrutia Echeverría Maldonado Olmos Tejada
      Barragán Cuesta Fontán Arrizabalaga Bermúdez Carvajal Dorronsoro Egea Fuertes Gorostiza Hurtado Irazábal
      Juárez Lequerica Mondragón Nieva Orduña Pereda Quijano Rentería Sarasola Tolosa Uribarri Valcárcel Yanguas`.split(/\s+/),
  },
};
const ORGS: Record<Lang, string[]> = {
  en: `Aldara Bruma Cendal Dorsal Esquilo Farola Galeon Hontanar Isleta Jaspe Kepler Lumbre Marisma Nevado Ocaso
    Pinar Quimera Rastro Sotavento Tramuntana Umbral Vendaval Wicker Yelmo Zafiro Ironbridge Foxglove Larkspur
    Millstone Pennywhistle`.split(/\s+/).map((b) => `${b} Consulting`),
  es: `Aldara Bruma Cendal Dorsal Esquilo Farola Galeón Hontanar Isleta Jaspe Kepler Lumbre Marisma Nevado Ocaso
    Pinar Quimera Rastro Sotavento Tramuntana Umbral Vendaval Wicker Yelmo Zafiro Ironbridge Foxglove Larkspur
    Millstone Pennywhistle`.split(/\s+/).map((b) => `Asesores ${b}`),
};

function thread(lang: Lang): { text: string; known: KnownValue[] } {
  const { first, last } = PEOPLE[lang];
  const people = first.map((f, i) => `${f} ${last[i] as string}`);
  const lines = people.map((p, i) => {
    const org = ORGS[lang][i % 30] as string;
    return lang === 'en' ? `${p} wrote on behalf of ${org} about the renewal.` : `${p} escribió en nombre de ${org} sobre la renovación.`;
  });
  return {
    text: lines.join('\n'),
    known: [...people.map((value) => ({ kind: 'person' as const, value })), ...ORGS[lang].map((value) => ({ kind: 'org' as const, value }))],
  };
}

describe('C38: fake pools', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`C38: a thread with 50 people and 30 companies gets ${lang} fakes from the lists, none invented from syllables`, () => {
      const { text, known } = thread(lang);
      expect(new Set(PEOPLE[lang].first).size).toBe(50);
      expect(new Set(PEOPLE[lang].last).size).toBe(50);
      expect(new Set(ORGS[lang]).size).toBe(30);
      const res = blind([text], { known, seed: `pools-${lang}`, now: NOW });
      const lists = FAKES[lang];
      const names = new Set([...lists.female, ...lists.male, ...lists.last]);
      const people = res.mapping.pairs.filter((p) => p.kind === 'person' && !p.real.includes(' '));
      expect(people.length).toBeGreaterThanOrEqual(100);
      for (const p of people) expect(names, `${p.real} -> ${p.fake}`).toContain(p.fake);
      const orgs = res.mapping.pairs.filter((p) => p.kind === 'org');
      expect(orgs.length).toBe(30);
      for (const o of orgs) {
        const words = o.fake.split(' ');
        expect(words.some((w) => lists.orgBases.includes(w)), o.fake).toBe(true);
        expect(words.every((w) => lists.orgBases.includes(w) || lists.orgNouns.includes(w)), o.fake).toBe(true);
      }
      expect(unblind(res.texts[0] as string, res.mapping).text).toBe(text);
    });
  }

  it('C38: past the lists, a fake joins two of their entries rather than inventing syllables', () => {
    const first = PEOPLE.en.first;
    const surnames = Array.from({ length: 160 }, (_, i) => `${PEOPLE.en.last[i % 50] as string}${['', 'son', 'ham', 'ley'][Math.floor(i / 50)] as string}`);
    const people = surnames.map((l, i) => `${first[i % 50] as string} ${l}`);
    const res = blind([people.join(', ')], { known: people.map((value) => ({ kind: 'person' as const, value })), seed: 'overflow', now: NOW });
    const last = new Set(FAKES.en.last);
    const fakes = res.mapping.pairs.filter((p) => p.kind === 'person' && surnames.includes(p.real)).map((p) => p.fake);
    expect(new Set(fakes).size).toBe(160);
    expect(fakes.some((f) => f.includes('-'))).toBe(true);
    for (const f of fakes) for (const part of f.split('-')) expect(last, f).toContain(part);
  });
});
