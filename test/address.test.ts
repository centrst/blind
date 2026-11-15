import { describe, expect, it } from 'vitest';
import { detectAddresses } from '../src/address.js';
import { blind, unblind } from '../src/index.js';
import type { Detector, ReplaceWith } from '../src/types.js';

// Synthetic text. Every name, street, town and postal code is invented.
const NOW = new Date('2026-06-01T00:00:00Z');
const MODES: ReplaceWith[] = ['fake', 'placeholder', 'random'];

/** The receipt from issue #52. */
const RECEIPT = `Hello Jordan Pemberton,

You sent a payment of $47.88 USD to Example Indexer LLC on Mar 3, 2026.

Shipping address
Jordan Pemberton
4417 Larkspur Hollow Rd Apt 2B
Brookhaven, OR 97399
United States

Transaction ID: 7XK29384LM102938P`;

const places = (text: string): string[] => detectAddresses(text).places.map(([s, e]) => text.slice(s, e));

describe('postal addresses', () => {
  it('C59: the receipt of issue #52 comes out with its street and locality replaced in placeholder mode, the country kept, and round trips', () => {
    const r = blind([RECEIPT], { replaceWith: 'placeholder', known: [], seed: 'receipt', now: NOW });
    const out = r.texts[0] as string;
    expect(out).toContain('Shipping address\n[REDACTED_PERSON_1]\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]\nUnited States\n');
    for (const v of ['4417', 'Larkspur', 'Hollow', 'Brookhaven', '97399', 'Pemberton']) expect(out, v).not.toContain(v);
    expect(r.replaced.place).toBe(2);
    expect(r.leaks.ok).toBe(true);
    expect(unblind(out, r.mapping).text).toBe(RECEIPT);
  });

  it('C59: in fake mode an address keeps its shape: a new number, a fake street name, the suffix, unit word and region kept', () => {
    const r = blind([RECEIPT], { known: [], seed: 'receipt', now: NOW });
    const out = r.texts[0] as string;
    const block = out.split('Shipping address\n')[1]!.split('\n');
    expect(block[1]).toMatch(/^\d{4} \p{Lu}\p{Ll}+ Rd Apt \d[A-Z]$/u);
    expect(block[2]).toMatch(/^\p{Lu}\p{Ll}+, OR \d{5}$/u);
    expect(block[3]).toBe('United States');
    for (const v of ['4417', 'Larkspur', 'Hollow', 'Brookhaven', '97399']) expect(out, v).not.toContain(v);
    expect(r.leaks.ok).toBe(true);
    expect(unblind(out, r.mapping).text).toBe(RECEIPT);
    expect(blind([RECEIPT], { known: [], seed: 'receipt', now: NOW }).texts).toEqual(r.texts);
  });

  it('C59: in random mode an address becomes a town with no number or layout kept', () => {
    const r = blind([RECEIPT], { known: [], seed: 'receipt', now: NOW, replaceWith: 'random' });
    const block = (r.texts[0] as string).split('Shipping address\n')[1]!.split('\n');
    expect(block[1]).toMatch(/^\p{Lu}[\p{L} ]+$/u);
    expect(block[2]).toMatch(/^\p{Lu}[\p{L} ]+$/u);
    expect(unblind(r.texts[0] as string, r.mapping).text).toBe(RECEIPT);
  });

  const FORMATS: Array<{ title: string; text: string; secrets: string[] }> = [
    { title: 'a US street and locality in a sentence', text: 'Please send it to 4417 Larkspur Hollow Rd, Brookhaven, OR 97399 by Friday.', secrets: ['4417', 'Larkspur', 'Brookhaven', '97399'] },
    { title: 'a UK flat, street, town and postcode', text: 'Deliver to Flat 3, 12 Quillon Road, Ashcombe Vale ZZ1 4QX.', secrets: ['Quillon', 'Ashcombe', 'ZZ1 4QX'] },
    { title: 'a UK address on its own lines', text: 'Send it to:\n12 Quillon Road\nAshcombe Vale\nZZ1 4QX', secrets: ['Quillon', 'Ashcombe', 'ZZ1 4QX'] },
    { title: 'a Spanish street with floor, door and postal code', text: 'Dirección: Calle de los Tilos Altos 14, 3º B, 52990 Torrebruna.', secrets: ['Tilos', '52990', 'Torrebruna'] },
    { title: 'a Spanish street in lower case after a town', text: 'Te esperamos en el local de Torrebruna, calle del Olmo, 14.', secrets: ['Olmo'] },
    { title: 'a Canadian street and locality', text: 'Mail to: 88 Maple Crescent, Ottawa, ON K1A 0B9', secrets: ['88 Maple', 'Ottawa', 'K1A 0B9'] },
    { title: 'a box number and locality in a billing block', text: 'Billing address\nPO Box 4417\nBrookhaven, OR 97399', secrets: ['4417', 'Brookhaven', '97399'] },
    { title: 'a ship-to line with the name before the street', text: 'Ship to: Jordan Pemberton, 4417 Larkspur Hollow Rd, Brookhaven, OR 97399, United States', secrets: ['Pemberton', 'Larkspur', 'Brookhaven', '97399'] },
    { title: 'a company above the street in a bill-to block', text: 'Bill to\nOrvane Kettleworks\n4417 Larkspur Hollow Rd\nBrookhaven, OR 97399', secrets: ['Orvane', 'Kettleworks', 'Larkspur', '97399'] },
    { title: 'the name alone under a ship-to label', text: 'Ship to\nOdalys Brenwick\n\nThank you for your order.', secrets: ['Odalys', 'Brenwick'] },
    { title: 'a postcode after its label', text: 'Postcode: ZZ1 4QX', secrets: ['ZZ1 4QX'] },
    { title: 'a ZIP code after its label', text: 'ZIP code: 97399', secrets: ['97399'] },
  ];
  for (const f of FORMATS) {
    it(`C59: ${f.title} is replaced in every mode and round trips`, () => {
      for (const replaceWith of MODES) {
        const r = blind([f.text], { seed: 'formats', now: NOW, replaceWith });
        const out = r.texts[0] as string;
        for (const s of f.secrets) expect(out, `${replaceWith}: ${s}`).not.toContain(s);
        expect(r.leaks.ok, replaceWith).toBe(true);
        expect(unblind(out, r.mapping).text, replaceWith).toBe(f.text);
      }
    });
  }

  it('C59: every block label the README names reads the lines under it, and every postal label the code after it', () => {
    const labels = ['Shipping address', 'Billing address', 'Delivery address', 'Ship to', 'Bill to', 'Dirección de envío', 'Domicilio'];
    for (const label of labels) {
      const text = `${label}\nOdalys Brenwick\nC/ Mayor 3\n52990 Torrebruna\nEspaña`;
      const r = blind([text], { seed: 'labels', now: NOW, replaceWith: 'placeholder' });
      expect(r.texts[0], label).toBe(`${label}\n[REDACTED_PERSON_1]\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]\nEspaña`);
    }
    for (const label of ['Postcode:', 'ZIP code:', 'Código postal:']) {
      expect(places(`${label} 52990`), label).toEqual(['52990']);
    }
  });

  it('C59: the line above the street in a labelled block is a company when it has a company word, a person otherwise', () => {
    const company = blind(['Bill to\nExample Indexer LLC\n4417 Larkspur Hollow Rd\nBrookhaven, OR 97399'], { seed: 'kind', now: NOW, replaceWith: 'placeholder' });
    expect(company.texts[0]).toBe('Bill to\n[REDACTED_ORG_1]\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]');
    const person = blind(['Ship to\nOdalys Brenwick\n4417 Larkspur Hollow Rd'], { seed: 'kind', now: NOW, replaceWith: 'placeholder' });
    expect(person.texts[0]).toBe('Ship to\n[REDACTED_PERSON_1]\n[REDACTED_PLACE_1]');
  });

  it('C59: prose with numbers before capitalised words, amounts, dates and versions holds no address', () => {
    const prose = [
      'We covered 3 Main points in the meeting.',
      'Upgrade to v2.3 Release Notes Way soon.',
      'It cost $47.88 Main Street prices.',
      'The server has 2 Hard Drive bays.',
      'Share the 3 Google Drive folders.',
      'On Mar 3, 2026 we met at 10.',
      'Release 2.14.3 Way is out.',
      'Top 10 Golf Courses in the area.',
      'In 2025 the team grew.',
      'Address Book\nOdalys Brenwick',
      'Address the issue with Odalys first.',
      'Ship to the customer tomorrow.',
      'Vivo en la calle desde hace 3 años.',
      'Room 4 is free after 3 pm.',
    ];
    for (const t of prose) {
      expect(places(t), t).toEqual([]);
      expect(blind([t], { seed: 'prose', now: NOW }).replaced.place, t).toBeUndefined();
    }
  });

  it('C59: a one-character line under a label is no address, so the next turn can carry the mapping', () => {
    const first = blind(['Shipping address\n3'], { seed: 'one', now: NOW, replaceWith: 'placeholder' });
    expect(first.texts[0]).toBe('Shipping address\n3');
    expect(first.mapping.pairs.some((p) => p.kind === 'place')).toBe(false);
    expect(() => blind(['Is 3 still right?'], { mapping: first.mapping, now: NOW })).not.toThrow();
  });

  it('C59: a ZIP+4 code is part of its locality, not a phone number', () => {
    const text = '4417 Larkspur Hollow Rd\nBrookhaven, OR 97399-1234';
    const r = blind([text], { seed: 'zip4', now: NOW, replaceWith: 'placeholder' });
    expect(r.texts[0]).toBe('[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]');
    expect(r.replaced.phone).toBeUndefined();
    // Many ZIP+4 codes cost linear time: each is looked up once, not searched for among all the others.
    const many = '4417 Larkspur Hollow Rd, Brookhaven, OR 97399-1234\n'.repeat(8000);
    const start = performance.now();
    blind([many], { seed: 'zip4', now: NOW, replaceWith: 'placeholder' });
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('C59: a care-of line in a block names who it goes to, and the block goes on below it', () => {
    const cases: Array<[string, string]> = [
      ['Shipping address\nc/o Jordan Pemberton\n4417 larkspur hollow rd\nbrookhaven, OR 97399', 'Shipping address\nc/o [REDACTED_PERSON_1]\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]'],
      ['Ship to:\nAttn: Odalys Brenwick\n4417 Larkspur Hollow Rd\nBrookhaven, OR 97399', 'Ship to:\nAttn: [REDACTED_PERSON_1]\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]'],
      ['Dirección de envío\nA/A Odalys Brenwick\nC/ Mayor 3\n52990 Torrebruna', 'Dirección de envío\nA/A [REDACTED_PERSON_1]\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]'],
    ];
    for (const [text, want] of cases) {
      const r = blind([text], { seed: 'care', now: NOW, replaceWith: 'placeholder' });
      expect(r.texts[0], text).toBe(want);
      expect(unblind(r.texts[0] as string, r.mapping).text).toBe(text);
    }
  });

  it('C59: block and box labels match in any letter case, particles included', () => {
    const cases: Array<[string, string]> = [
      ['DIRECCIÓN DE ENVÍO\n4417 larkspur hollow rd\nbrookhaven, OR 97399', 'DIRECCIÓN DE ENVÍO\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]'],
      ['ENVIAR A:\nC/ Mayor 3\n52990 Torrebruna', 'ENVIAR A:\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]'],
      ['Billing address\nAPARTADO DE CORREOS 4417\n52990 Torrebruna', 'Billing address\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]'],
    ];
    for (const [text, want] of cases) expect(blind([text], { seed: 'caps', now: NOW, replaceWith: 'placeholder' }).texts[0], text).toBe(want);
  });

  it('C59: an address that ends a label line goes on to the lines below, and text after it on the line ends the block', () => {
    const below = 'Ship to: Jordan Pemberton, 4417 Larkspur Hollow Rd\nbrookhaven, OR 97399';
    const r = blind([below], { seed: 'inline', now: NOW, replaceWith: 'placeholder' });
    expect(r.texts[0]).toBe('Ship to: [REDACTED_PERSON_1], [REDACTED_PLACE_1]\n[REDACTED_PLACE_2]');
    expect(unblind(r.texts[0] as string, r.mapping).text).toBe(below);
    expect(places('Dirección: Paseo Marítimo 8, Cabo Redondo. Teléfono +34 756 555 902.\nbrookhaven, OR 97399')).toEqual(['Paseo Marítimo 8, Cabo Redondo']);
  });

  it('C59: a block passes over up to two short notes above the street, and ends at a sentence below it', () => {
    const notes = 'Ship to\nOdalys Brenwick\ndelivery instructions\nLeave at the door\n4417 larkspur hollow rd\nbrookhaven, OR 97399';
    expect(blind([notes], { seed: 'notes', now: NOW, replaceWith: 'placeholder' }).texts[0]).toBe('Ship to\n[REDACTED_PERSON_1]\ndelivery instructions\nLeave at the door\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]');
    // A third note, or a long one, ends the block before the street.
    expect(places('Ship to\nnote one\nnote two\nnote three\n4417 larkspur hollow rd')).toEqual([]);
    // A sentence below the address with a number inside it is not an address line.
    const after = 'Shipping address\n4417 Larkspur Hollow Rd\nBrookhaven, OR 97399\nYour order ships in 3 days';
    expect(blind([after], { seed: 'notes', now: NOW, replaceWith: 'placeholder' }).texts[0]).toBe('Shipping address\n[REDACTED_PLACE_1]\n[REDACTED_PLACE_2]\nYour order ships in 3 days');
  });

  it('C59: a labelled block is read to its end, however many lines it has', () => {
    const text = 'Shipping address\nOdalys Brenwick\nOrvane Kettleworks\nc/o Jordan Pemberton\nBuilding 4\nPO Box 4417\n4417 Larkspur Hollow Rd\nApt 2B\nBrookhaven, OR 97399\nUnited States';
    const r = blind([text], { seed: 'long', now: NOW, replaceWith: 'placeholder' });
    const out = r.texts[0] as string;
    for (const v of ['Odalys', 'Orvane', 'Pemberton', '4417', 'Larkspur', '2B', 'Brookhaven', '97399']) expect(out, v).not.toContain(v);
    expect(out.endsWith('\nUnited States')).toBe(true);
    expect(unblind(out, r.mapping).text).toBe(text);
  });

  it('C59: a phone line in a labelled address block stays a phone, so keep phone keeps it', () => {
    const text = 'Shipping address\n4417 Larkspur Hollow Rd\n+44 7700 900123';
    expect(blind([text], { seed: 'tel', now: NOW, replaceWith: 'placeholder' }).texts[0]).toBe('Shipping address\n[REDACTED_PLACE_1]\n[REDACTED_PHONE_1]');
    const keptResult = blind([text], { seed: 'tel', now: NOW, keep: ['phone'] });
    const kept = keptResult.texts[0] as string;
    expect(kept).toContain('\n+44 7700 900123');
    expect(kept).not.toContain('Larkspur');
    // The kept phone is written as it stands, which is not an address left behind.
    expect(keptResult.leaks.ok).toBe(true);
  });

  it('C59: in a labelled block a line with a digit is the address in any letter case, and its words get fakes', () => {
    const text = 'Shipping address\n4417 larkspur hollow rd\nbrookhaven, OR 97399';
    const r = blind([text], { seed: 'lower', now: NOW });
    const out = r.texts[0] as string;
    for (const v of ['4417', 'larkspur', 'hollow', 'brookhaven', '97399']) expect(out, v).not.toContain(v);
    expect(out).toMatch(/^Shipping address\n\d{4} \p{Ll}+ rd\n\p{Ll}+, OR \d{5}$/u);
    expect(unblind(out, r.mapping).text).toBe(text);
  });

  it('C59: a comma after a street takes a town only up to a comma, a stop or the end of the line, not the sentence after it', () => {
    expect(places('4417 Larkspur Hollow Rd, Please call tomorrow.')).toEqual(['4417 Larkspur Hollow Rd']);
    expect(places('4417 Larkspur Hollow Rd, Brookhaven.')).toEqual(['4417 Larkspur Hollow Rd, Brookhaven']);
  });

  it('C59: input built to make the address patterns backtrack is read in linear time', () => {
    const inputs = [
      'Calle ' + 'De '.repeat(3000) + '!',
      'Calle ' + 'de '.repeat(3000) + '!',
      '12 ' + 'Rd '.repeat(3000) + '!',
      '12 ' + 'North '.repeat(3000) + '!',
      'Flat 3, '.repeat(3000),
      '12 Oak Rd' + ', Brookhaven'.repeat(3000),
      '12 Quillon Road; '.repeat(8000) + '\n',
      'Shipping address\n' + '1 x\n'.repeat(3000),
      'Calle' + ' '.repeat(30000) + 'Mayor 3',
      'Shipping address\n' + ','.repeat(80000) + 'x',
      'Ship to\n'.repeat(20000),
      'Shipping address\nab ' + '1'.repeat(80000) + 'x yz',
      'Shipping address\n' + 'Odalys Brenwick\n'.repeat(20000),
    ];
    for (const t of inputs) {
      const start = performance.now();
      detectAddresses(t);
      // Each takes a few milliseconds. Before the particles were made lower case only, 300 characters of `Calle De De ...` took seconds.
      expect(performance.now() - start, t.slice(0, 30)).toBeLessThan(1000);
    }
  });

  it('C59: a known town inside an address does not leave the rest of the address behind', () => {
    const text = 'Please send it to 4417 Larkspur Hollow Rd, Brookhaven, OR 97399 by Friday.';
    const r = blind([text], { seed: 'known', now: NOW, known: [{ kind: 'place', value: 'Brookhaven' }], replaceWith: 'placeholder' });
    expect(r.texts[0]).toBe('Please send it to [REDACTED_PLACE_1] by Friday.');
    expect(unblind(r.texts[0] as string, r.mapping).text).toBe(text);
  });

  it('C59: an address keeps its fake in the next turn of a conversation', () => {
    const first = blind([RECEIPT], { seed: 'turns', now: NOW });
    const street = (first.texts[0] as string).split('Shipping address\n')[1]!.split('\n')[1] as string;
    const next = blind(['Is 4417 Larkspur Hollow Rd Apt 2B still right?'], { mapping: first.mapping, now: NOW });
    expect(next.texts[0]).toBe(`Is ${street} still right?`);
    expect(unblind(next.texts[0] as string, next.mapping).text).toBe('Is 4417 Larkspur Hollow Rd Apt 2B still right?');
  });

  it('C59: with keep place an address is written as it stands and is not a leak', () => {
    const r = blind([RECEIPT], { seed: 'keep', now: NOW, keep: ['place'] });
    expect(r.texts[0]).toContain('4417 Larkspur Hollow Rd Apt 2B\nBrookhaven, OR 97399');
    expect(r.replaced.place).toBeUndefined();
    expect(r.leaks.ok).toBe(true);
  });

  it('C59: an address left in the blind text, with its house number outside what blind wrote, is a place hit by offset, never by value', () => {
    // A caller's detector that claims the unit at a higher priority, so the address span loses the overlap.
    const unit: Detector = {
      name: 'unit',
      detect: (text) => {
        const at = text.indexOf('2B');
        return at < 0 ? [] : [{ start: at, end: at + 2, kind: 'id', priority: 99 }];
      },
    };
    const r = blind([RECEIPT], { seed: 'left', now: NOW, detectors: [unit] });
    const out = r.texts[0] as string;
    expect(out).toContain('4417 Larkspur Hollow Rd Apt');
    expect(r.leaks.ok).toBe(false);
    const hit = r.leaks.hits.find((h) => h.kind === 'place');
    expect(hit).toEqual({ kind: 'place', textIndex: 0, offset: out.indexOf('4417') });
    expect(JSON.stringify(r.leaks)).not.toContain('Larkspur');
  });

  it('C59: a kept span is not an address left behind, but the street around it still is', () => {
    const unit: Detector = {
      name: 'unit',
      detect: (text) => {
        const at = text.indexOf('Apt 2B');
        return at < 0 ? [] : [{ start: at, end: at + 6, kind: 'id', priority: 99 }];
      },
    };
    const r = blind(['Send it to 4417 Larkspur Hollow Rd Apt 2B.'], { seed: 'kept', now: NOW, detectors: [unit], keep: ['id'] });
    expect(r.texts[0]).toBe('Send it to 4417 Larkspur Hollow Rd Apt 2B.');
    expect(r.leaks.hits).toEqual([{ kind: 'place', textIndex: 0, offset: 11 }]);
  });

  it('C59: an address left with a full-width house number is a place hit too, as detection reads the folded text', () => {
    const unit: Detector = {
      name: 'unit',
      detect: (text) => {
        const at = text.indexOf('Apt 2B');
        return at < 0 ? [] : [{ start: at, end: at + 6, kind: 'id', priority: 99 }];
      },
    };
    const r = blind(['Send it to ４４１７ Larkspur Hollow Rd Apt 2B.'], { seed: 'wide', now: NOW, detectors: [unit] });
    const out = r.texts[0] as string;
    expect(out).toContain('４４１７ Larkspur Hollow Rd');
    expect(r.leaks.ok).toBe(false);
    expect(r.leaks.hits).toContainEqual({ kind: 'place', textIndex: 0, offset: out.indexOf('４４１７') });
  });
});
