import { describe, expect, it } from 'vitest';
import { detectAmounts, detectPercents, formatNumber, parseNumber } from '../src/amounts.js';
import { detectDates, renderDate } from '../src/dates.js';
import {
  amountDetector, bareMentions, contextDetector, dateDetector, detectSpans, emailDetector, findSpans, ibanDetector, idDetector,
  knownDetector, knownPart, knownParts, nameTokens, personForms, shortNamePart, stopWordValue, writtenAs, phoneDetector, repeatedNames, resolveSpans, urlDetector, builtinDetectors,
} from '../src/detect.js';
import {
  cifControl, detectIds, dniLetter, luhnDigit, luhnValid, parseIpv4, parseIpv6, renderLike, validCard, validCif, validDni, validId, validNie, validSsn, validVat,
} from '../src/ids.js';
import type { DetectContext, Detector, Kind, KnownValue, Span } from '../src/types.js';
import { BlindError } from '../src/errors.js';
import { blind, unblind } from '../src/index.js';
import { Rng } from '../src/prng.js';
import { reservedPhone } from './support/values.js';

const ctx: DetectContext = { dateOrder: 'dmy', isAllowedHost: (h) => h === 'gmail.com' || h.endsWith('.google.com') };
/**
 * Live-range phone layouts, one per prefix P20 drew before. Each `x` is a digit
 * drawn from the seeded Rng at run time, so no complete live number is written
 * in the tree. The prefix is the fact under test.
 */
/** UK mobiles 071 to 075, 077 and 078, in each layout. */
const UK_LIVE_LAYOUTS = ['+44 71xx xxxxxx', '0044 72xx xxxxxx', '073xx xxxxxx', '+4474xx xxxxxx', '075xx xxx xxx', '077xxxxxxxx', '+44 78xx xxxxxx'];
/** Spanish mobiles 60 to 69 and 71 to 74, with +34, 0034 or no prefix. */
const ES_LIVE_LAYOUTS = [
  '+34 60x xxx xxx', '0034 61x xxx xxx', '62x xxx xxx', '+3463xxxxxxx', '003464xxxxxxx', '65xxxxxxx', '66x xx xx xx',
  '+34 67x xxx xxx', '0034 68x xxx xxx', '69x xxx xxx', '+34 71x xxx xxx', '003472xxxxxxx', '73x xx xx xx', '74xxxxxxx',
];
/** North American numbers in area codes 415 and 312 with an exchange other than 555, at both ends of the NXX range. */
const NA_LIVE_LAYOUTS = ['(415) 2xx-xxxx', '+1 312 9xx xxxx'];
/** A layout filled from the Rng. An exchange that comes out as N11 (a service code) is drawn again. */
const fillLayout = (rng: Rng, layout: string): string => {
  for (;;) {
    const v = layout.replace(/x/g, () => String(rng.int(10)));
    if (!/^(?:\+1 \d{3} |\(\d{3}\) )\d11/.test(v)) return v;
  }
};
const pick = (text: string, spans: { start: number; end: number }[]): string[] =>
  spans.map((s) => text.slice(s.start, s.end));

describe('amounts', () => {
  const nums = (t: string): string[] => detectAmounts(t).map((a) => a.raw);

  it('reads EU and US formats with currency on either side', () => {
    expect(nums('Total: 247,80 € (cuota 206,50 € + 20 %)')).toEqual(['247,80', '206,50']);
    expect(nums('Pagos de 1.234,56 € y 214,38 €.')).toEqual(['1.234,56', '214,38']);
    expect(nums('Invoice $1,234.56 and USD 12.00, also 12.00 USD.')).toEqual(['1,234.56', '12.00', '12.00']);
    expect(nums('€ 99,90 o EUR 5')).toEqual(['99,90', '5']);
  });

  it('finds amounts inside sentences and ignores bare numbers', () => {
    expect(nums('Te cobraremos 214,38 € el lunes, no 15 días antes.')).toEqual(['214,38']);
    expect(nums('Plazo de 15 días, pedido 2026, 3 adultos')).toEqual([]);
    expect(nums('Son 15 euros y 20 dólares')).toEqual(['15', '20']);
  });

  it('reports the full span with currency', () => {
    const t = 'pay USD 12.00 now';
    const [a] = detectAmounts(t);
    expect(t.slice(a!.fullStart, a!.fullEnd)).toBe('USD 12.00');
    expect(t.slice(a!.start, a!.end)).toBe('12.00');
  });

  it('parses separators by position and group size', () => {
    expect(parseNumber('1.234,56')).toMatchObject({ minor: 123456, decimals: 2, dec: ',', thou: '.' });
    expect(parseNumber('1,234.56')).toMatchObject({ minor: 123456, decimals: 2, dec: '.', thou: ',' });
    expect(parseNumber('1.234')).toMatchObject({ minor: 1234, decimals: 0, thou: '.' });
    expect(parseNumber('214,38')).toMatchObject({ minor: 21438, decimals: 2, dec: ',' });
    expect(parseNumber('0,500')).toMatchObject({ minor: 500, decimals: 3, dec: ',' });
    expect(parseNumber('12')).toMatchObject({ minor: 12, decimals: 0, dec: null });
  });

  it('formats back with the same separators', () => {
    expect(formatNumber(123456, 2, ',', '.')).toBe('1.234,56');
    expect(formatNumber(123456, 2, '.', ',')).toBe('1,234.56');
    expect(formatNumber(5, 2, ',', null)).toBe('0,05');
    expect(formatNumber(1200, 0, null, null)).toBe('1200');
  });

  it('finds percentages', () => {
    expect(detectPercents('IVA 21 % y 7,5% de recargo')).toEqual([21, 7.5]);
  });
});

describe('dates', () => {
  const same = (s: string, order: 'dmy' | 'mdy' = 'dmy'): void => {
    const [m] = detectDates(s, order);
    expect(m, s).toBeDefined();
    expect(renderDate(m!.occ), s).toBe(s);
  };

  it('renders what it parses, format for format', () => {
    for (const s of [
      '2026-04-07', 'April 7, 2026', 'April 7', '7 April 2026', '7 April', '9 de abril de 2026', '6 de octubre',
      '07/04/2026', '7/4/2026', '07.04.2026', '07-04-26', 'Apr 7, 2026', 'Sept. 3, 2026', '7th of April, 2026',
      'MARCH 3', 'march 3', '1 de enero del 2027', '1º de mayo',
    ]) same(s);
    same('04/07/2026', 'mdy');
  });

  it('honours dateOrder for slash dates', () => {
    expect(detectDates('04/07/2026', 'dmy')[0]!.occ).toMatchObject({ m: 7, d: 4, y: 2026 });
    expect(detectDates('04/07/2026', 'mdy')[0]!.occ).toMatchObject({ m: 4, d: 7, y: 2026 });
    expect(detectDates('13/07/2026', 'mdy')[0]!.occ).toMatchObject({ m: 7, d: 13 });
  });

  it('rejects impossible dates and lowercase short months', () => {
    expect(detectDates('31 de abril de 2026', 'dmy')).toEqual([]);
    expect(detectDates('2026-13-40', 'dmy')).toEqual([]);
    expect(detectDates('mar 5 items', 'dmy')).toEqual([]);
    expect(detectDates('May 2026', 'dmy')).toEqual([]);
  });

  it('keeps the time of day outside the span', () => {
    const t = 'at 2026-04-07T10:30:00Z';
    const [m] = detectDates(t, 'dmy');
    expect(t.slice(m!.start, m!.end)).toBe('2026-04-07');
  });
});

describe('pattern detectors', () => {
  it('finds emails in angle brackets and display names', () => {
    const t = 'From: Ana Ruiz <ana@gestoria.example>, "Ruiz, Pedro" <p.ruiz@corp.example>\nWrite to info@x.example.';
    const spans = emailDetector.detect(t, ctx);
    expect(pick(t, spans.filter((s) => s.kind === 'email'))).toEqual([
      'ana@gestoria.example', 'p.ruiz@corp.example', 'info@x.example',
    ]);
    expect(pick(t, spans.filter((s) => s.kind === 'person')).sort()).toEqual(['Ana Ruiz', 'Ruiz, Pedro']);
  });

  it('does not treat greeting words as part of a display name', () => {
    const t = 'Hola Ana Ruiz <ana@gestoria.example>';
    expect(pick(t, emailDetector.detect(t, ctx).filter((s) => s.kind === 'person'))).toEqual(['Ana Ruiz']);
  });

  it('skips display names on public platform domains', () => {
    const t = 'From: Booking Team <team_booking@gmail.com>';
    expect(emailDetector.detect(t, ctx).filter((s) => s.kind === 'person')).toEqual([]);
  });

  it('finds URLs with query strings and trims trailing punctuation', () => {
    const t = 'See https://shop.example/a/b?id=42&t=abc123xyz#top, or (www.site.example/x). Done';
    expect(pick(t, urlDetector.detect(t, ctx))).toEqual([
      'https://shop.example/a/b?id=42&t=abc123xyz#top', 'www.site.example/x',
    ]);
  });

  it('finds international, Spanish and US phones', () => {
    // A Spanish landline has no reserved range, so its digits after the 91 prefix are drawn at run time.
    const landline = fillLayout(new Rng('detect landline'), '91x xxx xxx');
    const t = `Call +34 791 345 678, ${landline}, 791-34-56-78, (415) 555-0123, +1 415 555 0199 or 00447700900123.`;
    const got = pick(t, phoneDetector.detect(t, ctx));
    expect(got).toEqual(expect.arrayContaining(['+34 791 345 678', '791-34-56-78', '(415) 555-0123', '+1 415 555 0199', '00447700900123']));
    expect(got.includes(landline), 'landline 91x xxx xxx').toBe(true);
  });

  it('C31/unit: a mobile in a live range is found whole and gets a mobile of its country in its reserved range, in the same layout', () => {
    // P20 draws from the reserved ranges only, so these keep the live prefixes covered. Three numbers per layout,
    // drawn at run time. A failure names the layout and the check, never the number or its fake.
    const uk = (f: string): string => f.replace(/\D/g, '').replace(/^(0044|44|0)/, '');
    const es = (f: string): string => f.replace(/\D/g, '').replace(/^(0034|34(?=\d{9}$))/, '');
    const na = (f: string): string => f.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
    const layouts: Array<[string, (f: string) => string, RegExp]> = [
      ...UK_LIVE_LAYOUTS.map((l): [string, (f: string) => string, RegExp] => [l, uk, /^7700900\d{3}$/]),
      ...ES_LIVE_LAYOUTS.map((l): [string, (f: string) => string, RegExp] => [l, es, /^7[5-9]\d{7}$/]),
      ...NA_LIVE_LAYOUTS.map((l): [string, (f: string) => string, RegExp] => [l, na, /^[2-9][0-8]\d55501\d{2}$/]),
    ];
    const rng = new Rng('C31/unit live prefixes');
    const failed: string[] = [];
    let ran = 0;
    for (const [layout, national, mobile] of layouts) {
      for (let i = 0; i < 3; i++) {
        const phone = fillLayout(rng, layout);
        const text = `Call me on ${phone} today.`;
        const res = blind([text], { seed: 'live', now: new Date('2026-06-01T00:00:00Z') });
        const fake = /^Call me on (.*) today\.$/.exec(res.texts[0] as string)?.[1] ?? '';
        const checks: Array<[string, boolean]> = [
          ['is in a live range', !reservedPhone(phone)],
          ['is found whole', pick(text, phoneDetector.detect(text, ctx)).includes(phone)],
          ['is replaced', fake !== phone],
          ['keeps its layout', fake.replace(/\d/g, '9') === phone.replace(/\d/g, '9')],
          ['keeps its national length', national(fake).length === national(phone).length],
          ['moves to the reserved range', mobile.test(national(fake))],
          ['round-trips', unblind(res.texts[0] as string, res.mapping).text === text],
        ];
        for (const [what, ok] of checks) if (!ok) failed.push(`${layout} #${i}: ${what}`);
        ran++;
      }
    }
    expect(ran).toBe(69);
    expect(failed).toEqual([]);
  });

  it('does not take amounts or short numbers for phones', () => {
    const t = 'Total 1.789.123.456,00 € y 12 345';
    expect(phoneDetector.detect(t, ctx)).toEqual([]);
  });

  it('finds IBANs with and without spaces and ignores trailing words', () => {
    const t = 'IBAN ES91 2100 0418 4502 0005 1332 BIC XYZ; DE89370400440532013000 ok';
    expect(pick(t, ibanDetector.detect(t, ctx))).toEqual(['ES91 2100 0418 4502 0005 1332', 'DE89370400440532013000']);
  });

  it('finds long digit IDs and alphanumeric case numbers, not quarters or short codes', () => {
    const t = 'Ref 12345678, case ABC-2026-0412, exp A12345, Q4-2026, 2FA, H2O, 12345';
    expect(pick(t, idDetector.detect(t, ctx))).toEqual(['12345678', 'ABC-2026-0412', 'A12345']);
  });

  it('resolves overlaps by priority so an email beats the ID inside it', () => {
    const t = 'user123456@host.example';
    const spans = detectSpans(t, ctx, builtinDetectors);
    expect(spans.map((s) => s.kind)).toEqual(['email']);
  });

  it('amount and date detectors attach their parsed payload', () => {
    const t = 'Total 5,00 € el 3 de marzo';
    expect(amountDetector.detect(t, ctx)[0]!.meta).toBeDefined();
    expect(dateDetector.detect(t, ctx)[0]!.meta).toBeDefined();
  });
});

describe('known values', () => {
  const spans = (t: string, v: Parameters<typeof knownDetector>[0]): string[] =>
    pick(t, knownDetector(v).detect(t, ctx));

  it('matches person names in full, first and last form, whole word, any case', () => {
    const t = 'Ana Ruiz wrote. Later ANA and ruiz replied, not Anabel or Ruizes.';
    expect(spans(t, [{ kind: 'person', value: 'Ana Ruiz' }])).toEqual(['Ana Ruiz', 'ANA', 'ruiz']);
  });

  it('handles particles in surnames', () => {
    const t = 'Mensaje de María de la Cruz y de Cruz.';
    const got = spans(t, [{ kind: 'person', value: 'María de la Cruz' }]);
    expect(got).toContain('María de la Cruz');
    expect(got).toContain('Cruz');
  });

  it('matches orgs with and without the legal suffix', () => {
    const t = 'Gestoría Norte S.L. says Gestoría Norte is closed';
    expect(spans(t, [{ kind: 'org', value: 'Gestoría Norte S.L.' }])).toEqual(['Gestoría Norte S.L.', 'Gestoría Norte']);
  });

  it('matches phones in other formats and a domain inside a subdomain', () => {
    expect(spans('tel 791 345 678 and +34791345678', [{ kind: 'phone', value: '+34 791 345 678' }])).toEqual([
      '791 345 678', '+34791345678',
    ]);
    expect(spans('mail.gestoria.example', [{ kind: 'domain', value: 'gestoria.example' }])).toEqual(['gestoria.example']);
  });
});

describe('typed ids', () => {
  const found = (t: string): Array<[string, string]> => detectIds(t).map((m) => [t.slice(m.start, m.end), m.scheme]);

  it('finds cards in any one separator style and checks Luhn and the network', () => {
    expect(found('Visa 4111 1111 1111 1111 y 4111-1111-1111-1111, plain 4111111111111111.')).toEqual([
      ['4111 1111 1111 1111', 'card'], ['4111-1111-1111-1111', 'card'], ['4111111111111111', 'card'],
    ]);
    expect(found('Amex 3782 822463 10005, MC 5555 5555 5555 4444, 2-series 2221 0000 0000 0009.')).toEqual([
      ['3782 822463 10005', 'card'], ['5555 5555 5555 4444', 'card'], ['2221 0000 0000 0009', 'card'],
    ]);
    expect(found('Bad Luhn 4111 1111 1111 1112, no network 9111 1111 1111 1113, mixed 4111 1111-1111 1111.')).toEqual([]);
  });

  it('finds dashed SSNs and refuses the reserved ranges', () => {
    expect(found('SSN 123-45-6789 and 078-05-1120.')).toEqual([['123-45-6789', 'ssn'], ['078-05-1120', 'ssn']]);
    // Built from area, group and serial: an area of 666 or 9xx in a number's layout would read as a live Spanish number.
    const ssn = (area: string, group: string, serial: string, sep = '-'): string => [area, group, serial].join(sep);
    const refused = [ssn('000', '12', '3456'), ssn('666', '12', '3456'), ssn('912', '12', '3456'), ssn('123', '00', '4567'), ssn('123', '45', '0000'), ssn('123', '45', '6789', ' ')];
    expect(found(refused.join(' '))).toEqual([]);
  });

  it('finds DNI, NIE and CIF only when the control character is right', () => {
    expect(found('DNI 12345678Z, 12.345.678-Z, NIE X1234567L, Y-1234567-X, CIF B12345674, Q2826000H.')).toEqual([
      ['12345678Z', 'es-dni'], ['12.345.678-Z', 'es-dni'], ['X1234567L', 'es-nie'], ['Y-1234567-X', 'es-nie'],
      ['B12345674', 'es-cif'], ['Q2826000H', 'es-cif'],
    ]);
    expect(found('12345678A X1234567A B12345675 Q28260008 pedido 12345678 z')).toEqual([]);
  });

  it('finds EU VAT numbers by country and keeps words after them out', () => {
    expect(found('VAT ESB12345674, ES 12345678Z, DE123456789 und IT12345678901, NL123456789B01.')).toEqual([
      ['ESB12345674', 'eu-vat'], ['ES 12345678Z', 'eu-vat'], ['DE123456789', 'eu-vat'], ['IT12345678901', 'eu-vat'],
      ['NL123456789B01', 'eu-vat'],
    ]);
    expect(found('DE12345 FR1234 ESB12345675 SE123456789099')).toEqual([]);
  });

  it('finds IPv4 and IPv6 addresses but not times, code or version tags', () => {
    expect(found('From 81.44.217.9, 2a02:9130:8f41::7c:1d2e and 2001:db8:0:0:1:0:0:1.')).toEqual([
      ['81.44.217.9', 'ipv4'], ['2a02:9130:8f41::7c:1d2e', 'ipv6'], ['2001:db8:0:0:1:0:0:1', 'ipv6'],
    ]);
    expect(found('at 12:30:45, std::vector, v1.2.3.4, 256.1.1.1, 01.2.3.4, 1.2.3.4.5, a::b, 00:1A:2B:3C:4D:5E')).toEqual([]);
  });

  it('validates and builds check characters', () => {
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398710')).toBe(false);
    expect(luhnValid('7992a')).toBe(false);
    expect(luhnDigit('7992739871')).toBe('3');
    expect(dniLetter(12345678)).toBe('Z');
    expect(cifControl('1234567')).toBe(4);
    expect(parseIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6('1:2:3:4:5:6:7')).toBeNull();
    expect(parseIpv6('1:2:3:4::5:6:7:8')).toBeNull();
    expect(parseIpv4('1.2.3')).toBeNull();
    for (const [raw, scheme] of [['4111 1111 1111 1111', 'card'], ['078-05-1120', 'ssn'], ['12345678Z', 'es-dni'],
      ['X1234567L', 'es-nie'], ['B12345674', 'es-cif'], ['ESB12345674', 'eu-vat'], ['10.0.0.1', 'ipv4'], ['::1', 'ipv6']] as const) {
      expect(validId(raw, scheme), raw).toBe(true);
    }
    expect(validId('B12345675', 'es-cif')).toBe(false);
    expect(validCif('A1234567D')).toBe(false); // A takes a digit
    expect(validCif('P1234567D')).toBe(true); // P takes a letter
    expect(validCif('C1234567D')).toBe(true); // C takes either
    expect(validCif('C12345674')).toBe(true);
  });

  it('renders a fake in the layout of the original, keeping lower case', () => {
    expect(renderLike('12.345.678-z', '87654321X')).toBe('87.654.321-x');
    expect(renderLike('AB', 'C')).toBe('CB');
  });

  it('gives the typed detector a higher priority than phones and the generic id', () => {
    const spans = detectSpans('Tel 600-12-3456, id 12345678Z.', ctx, builtinDetectors);
    expect(spans.map((s) => [ 'Tel 600-12-3456, id 12345678Z.'.slice(s.start, s.end), s.kind, (s.meta as { scheme?: string } | undefined)?.scheme ])).toEqual([
      ['600-12-3456', 'id', 'ssn'], ['12345678Z', 'id', 'es-dni'],
    ]);
  });
});

describe('context words', () => {
  const people = (t: string): string[] => pick(t, contextDetector.detect(t, ctx).filter((s) => s.kind === 'person'));
  const ids = (t: string): string[] => pick(t, contextDetector.detect(t, ctx).filter((s) => s.kind === 'id'));

  it('reads the name after a title, in Spanish and English', () => {
    expect(people('Firmado por Dr. Pablo Mena y la Sra. Ruiz de la Fuente.')).toEqual(['Pablo Mena', 'Ruiz de la Fuente']);
    expect(people('Dear Mrs Okafor, D. Luis García and Doña Inés wrote.')).toEqual(['Okafor', 'Luis García', 'Inés']);
    expect(people('Sr. de la')).toEqual([]);
    expect(people('Mr. smith and Dra. ')).toEqual([]);
  });

  it('takes the value after an id label when it holds three digits or more', () => {
    expect(ids('Póliza nº 88-2231-A, NHC: 4512 337, pasaporte PAB123456, SSN 123 45 6789.')).toEqual([
      '88-2231-A', '4512 337', 'PAB123456', '123 45 6789',
    ]);
    expect(ids('Historia clínica NHC: 4512 337')).toEqual(['4512 337']);
    expect(ids('DNI del titular, policy number 12, member id: AB-1 x')).toEqual([]);
    // Two groups of four in a phone's shape; written as groups so the code lint does not read a phone.
    const customer = ['0042', '1187'].join(' ');
    expect(ids(`customer no. ${customer} en curso`)).toEqual([customer]);
  });
});

describe('names found once, found again', () => {
  const find = (texts: string[]): string[][] =>
    findSpans(texts, ctx, builtinDetectors).map((spans, i) => spans.filter((s) => s.kind === 'person' || s.kind === 'org').map((s) => `${s.kind}:${(texts[i] as string).slice(s.start, s.end)}`));

  it('carries a header name to its bare mentions in every text of the call', () => {
    expect(find(['From: Pilar Gómez <pilar@estudio.example>\n\nHola Pilar.', 'Pilar y Gómez firmaron.'])).toEqual([
      ['person:Pilar Gómez', 'person:Pilar'], ['person:Pilar', 'person:Gómez'],
    ]);
  });

  it('leaves a name the text also writes as an ordinary lower-case word', () => {
    expect(find(['From: Rosa Paz <rosa@x.example>\n\nHola Rosa, la casa rosa.'])).toEqual([['person:Rosa Paz']]);
    // Lower case inside an address does not count.
    expect(find(['From: Rosa Paz <rosa@x.example>\n\nHola Rosa.'])).toEqual([['person:Rosa Paz', 'person:Rosa']]);
  });

  it('skips short tokens, particles and greetings', () => {
    expect(nameTokens(['Ana de la Fuente', 'Hola Li', 'Dear Smith-Jones,'])).toEqual(['Ana', 'Fuente', 'Smith-Jones']);
    expect(bareMentions('ÍSTANBUL İstanbul', ['Ana'], [], 40)).toEqual([]); // lowering changes the length
    expect(bareMentions('Ana y Ana', [], [], 40)).toEqual([]);
  });

  it('reads a sender with company words as an org and finds it again by its full name', () => {
    expect(find(['From: Clínica Foxglove <info@foxglove.example>\n\nGracias por elegir Clínica Foxglove. Foxglove abre a las 9.'])).toEqual([
      ['org:Clínica Foxglove', 'org:Clínica Foxglove'],
    ]);
    expect(find(['From: Equipo Soporte <help@x.example>', 'From: Lucía Prado <lucia@x.example>'])).toEqual([
      ['org:Equipo Soporte'], ['person:Lucía Prado'],
    ]);
    expect(repeatedNames('Acme y Acmeco', ['Acme'], [], 40).map((s) => s.start)).toEqual([0]);
    expect(repeatedNames('Acme', [], [], 40)).toEqual([]);
  });
});

describe('known values made of stop words and short parts', () => {
  const people = (texts: string[], known: KnownValue[], kind: 'person' | 'id' = 'person'): Array<Array<[string, number]>> => {
    const c: DetectContext = { ...ctx, known };
    return findSpans(texts, c, [...builtinDetectors, knownDetector(known)]).map((spans, i) =>
      spans.filter((s) => s.kind === kind).map((s) => [(texts[i] as string).slice(s.start, s.end), s.start] as [string, number]));
  };

  it('a known value of stop words is found as written or in capitals, hidden characters ignored, never in lower case', () => {
    expect(people(['Al dijo que fue al banco. AL lo sabe. A​l también.'], [{ kind: 'person', value: 'Al' }]))
      .toEqual([[['Al', 0], ['AL', 26], ['A​l', 38]]]);
    expect(people(['ref SE, se fue, Se ve.'], [{ kind: 'id', value: 'SE' }], 'id')).toEqual([[['SE', 4]]]);
  });

  it('a two-letter part of a known name is found again bare, and in lower case only where the language there does not write it as a word', () => {
    expect(people(['Al Brenner llamó. Fue al banco. AL lo sabe, Al también.'], [{ kind: 'person', value: 'Al Brenner' }]))
      .toEqual([[['Al Brenner', 0], ['AL', 32], ['Al', 44]]]);
    expect(people(['Al Brenner called. Then we spoke to al about it and he said the order is fine.'], [{ kind: 'person', value: 'Al Brenner' }]))
      .toEqual([[['Al Brenner', 0], ['al', 36]]]);
    expect(people(['Li Na firmó. Luego li dijo que sí, y LI también.'], [{ kind: 'person', value: 'Li Na' }]))
      .toEqual([[['Li Na', 0], ['li', 19], ['LI', 37]]]);
    expect(people(['Do Van called. Then we spoke to do about it and he said the order is fine.'], [{ kind: 'person', value: 'Do Van' }]))
      .toEqual([[['Do Van', 0]]]);
  });

  it('a known Korean name written as separate jamo is found whole, every jamo included', () => {
    const jamo = '김민준'.normalize('NFD');
    const text = `안녕하세요 ${jamo}님, 김민준님.`;
    expect(people([text], [{ kind: 'person', value: '김민준' }])).toEqual([[[jamo, 6], ['김민준', 18]]]);
  });

  it('a known entry whose value is not a string is refused, naming its index and kind only', () => {
    expect(() => knownDetector([{ kind: 'person', value: 42 as unknown as string }])).toThrow(/^blind: known entry 0 \(person\) has a value that is not a string$/);
    let err: unknown;
    try {
      knownDetector([{ kind: 'org', value: 'Norte' }, { kind: 'person', value: null as unknown as string }]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BlindError);
    expect((err as BlindError).kind).toBe('invalid-known');
    expect((err as BlindError).message).toBe('blind: known entry 1 (person) has a value that is not a string');
  });
});

describe('forms and parts of known names', () => {
  const at = (text: string, spans: Array<{ start: number; end: number }>): Array<[string, number]> => spans.map((s) => [text.slice(s.start, s.end), s.start]);

  it('a known name is found by its parts of three letters or more, never by a particle or a lone stop word at either end', () => {
    expect(personForms('Juan de la Cruz')).toEqual(['Juan de la Cruz', 'Juan', 'Cruz']);
    expect(personForms('Juan DE LA Cruz')).toEqual(['Juan DE LA Cruz', 'Juan', 'Cruz']);
    expect(personForms('Ana Rosa')).toEqual(['Ana Rosa', 'Ana', 'Rosa']);
    expect(personForms('Li Na')).toEqual(['Li Na']);
    expect(personForms('Hola Smith')).toEqual(['Hola Smith', 'Smith']);
    expect(personForms('Wang 李明')).toEqual(['Wang 李明', 'Wang', '李明']);
    expect(personForms('Al')).toEqual(['Al']);
    expect(personForms('A B C D E F G H')[0]).toBe('A B C D E F');
  });

  it('the bare parts of a known full name are its two-letter tokens and capitalised stop words, punctuation trimmed', () => {
    expect(knownParts([
      { kind: 'person', value: 'Li Na' }, { kind: 'person', value: 'Al Brenner' }, { kind: 'person', value: 'Ana de la Cruz' },
      { kind: 'org', value: 'Li Co' }, { kind: 'person', value: 'Wu' }, { kind: 'person', value: '(Mo) Farah' },
      { kind: 'person', value: 'De La Vega' }, { kind: 'person', value: 'Del Toro' }, { kind: 'person', value: 5 as unknown as string },
    ])).toEqual(['Li', 'Na', 'Al', 'Mo', 'De', 'La', 'Del']);
  });

  it('a known org is also found without its legal suffix when three letters or more remain', () => {
    const find = (value: string, text: string): Array<[string, number]> => at(text, knownDetector([{ kind: 'org', value }]).detect(text, ctx));
    expect(find('AB S.L.', 'AB y AB S.L.')).toEqual([['AB S.L.', 5]]);
    expect(find('ABC S.L.', 'ABC y ABC S.L.')).toEqual([['ABC', 0], ['ABC S.L.', 6]]);
    expect(find('Gestoría Norte S.L.', 'Gestoría Norte firmó')).toEqual([['Gestoría Norte', 0]]);
  });

  it('bare mentions prefer the longest token, skip empty tokens and a word the text writes in lower case, and ignore copies inside addresses', () => {
    const t = 'Hola Ana María, la rosa roja, Rosa y Pilar.';
    expect(at(t, bareMentions(t, ['Ana', 'Ana María', '​', 'Rosa', 'Pilar'], [], 50))).toEqual([['Ana María', 5], ['Pilar', 37]]);
    const u = 'Hola Pilar, mira https://x.example/pilar o pilar@x.example';
    expect(at(u, bareMentions(u, ['Pilar'], [{ start: 17, end: 40, kind: 'url' }, { start: 43, end: 58, kind: 'email' }], 50))).toEqual([['Pilar', 5]]);
    expect(at(u, bareMentions(u, ['Pilar'], [{ start: 17, end: 40, kind: 'org' }, { start: 43, end: 58, kind: 'email' }], 50))).toEqual([]);
    const jamo = '김민준'.normalize('NFD');
    // Hangul has no capitals, so a Korean token is taken as written; the jamo after its start belong to it.
    expect(at(`${jamo} \uc528`, bareMentions(`${jamo} \uc528`, ['\uae40\ubbfc\uc900'], [], 50, true))).toEqual([[jamo, 0]]);
  });

  it('a repeated name is matched longest first and never inside a span already taken', () => {
    const r = 'Ana Ruiz y Norte S.L. y Norte S.L.';
    expect(at(r, repeatedNames(r, ['Ana', 'Ana Ruiz', 'Norte S.L.'], [{ start: 11, end: 21, kind: 'org' }], 50))).toEqual([['Ana Ruiz', 0], ['Norte S.L.', 24]]);
    expect(repeatedNames(r, [], [], 50)).toEqual([]);
  });
});

describe('resolving overlapping spans', () => {
  const s = (start: number, end: number, priority?: number): Span => ({ start, end, kind: 'person', ...(priority === undefined ? {} : { priority }) });

  it('keeps the higher priority, then the longer span, then the earlier one, and leaves the input as it was', () => {
    const input = [s(0, 5, 50), s(2, 4, 90)];
    expect(resolveSpans(input)).toEqual([s(2, 4, 90)]);
    expect(input).toEqual([s(0, 5, 50), s(2, 4, 90)]);
    expect(resolveSpans([s(0, 3, 50), s(1, 6, 50)])).toEqual([s(1, 6, 50)]);
    expect(resolveSpans([s(2, 5, 50), s(0, 3, 50)])).toEqual([s(0, 3, 50)]);
    // No priority counts as 70.
    expect(resolveSpans([s(1, 3, 60), s(0, 4)])).toEqual([s(0, 4)]);
    expect(resolveSpans([s(0, 4), s(1, 3, 80)])).toEqual([s(1, 3, 80)]);
    expect(resolveSpans([s(0, 2, 10), s(5, 9, 20), s(3, 3, 99)])).toEqual([s(0, 2, 10), s(5, 9, 20)]);
  });

  it('drops a detector span outside the text, and an amount or a date without its parsed value', () => {
    const odd: Detector = {
      name: 'odd',
      detect: () => [
        { start: -1, end: 2, kind: 'person' }, { start: 3, end: 99, kind: 'person' }, { start: 0, end: 1, kind: 'amount' },
        { start: 2, end: 3, kind: 'date' }, { start: 4, end: 8, kind: 'org' },
      ],
    };
    expect(findSpans(['abc defgh'], ctx, [odd])).toEqual([[{ start: 4, end: 8, kind: 'org' }]]);
  });
});

describe('known entries the matcher cannot use', () => {
  const refused = (known: unknown[]): string => {
    try {
      knownDetector(known as KnownValue[]);
    } catch (e) {
      expect((e as BlindError).kind).toBe('invalid-known');
      return (e as Error).message;
    }
    return 'accepted';
  };

  it('names the index and lists the kinds when the kind is not one blind knows, quoting neither the value nor the kind', () => {
    const kinds = 'person, org, email, domain, phone, place, id';
    expect(refused([{ kind: 'iban', value: 'Ana' }])).toBe(`blind: known entry 0 has a kind blind does not know; use one of ${kinds}`);
    expect(refused([{ kind: 'person', value: 'Ana' }, null])).toBe(`blind: known entry 1 has a kind blind does not know; use one of ${kinds}`);
    expect(refused([{ kind: 7, value: 'Ana' }])).toBe(`blind: known entry 0 has a kind blind does not know; use one of ${kinds}`);
  });

  it('refuses an empty value, one character of a spaced script and a phone of one digit, and takes two characters or two digits', () => {
    expect(refused([{ kind: 'org', value: ' ​ ' }])).toBe('blind: known entry 0 (org) is empty or only spaces; give the value to find');
    expect(refused([{ kind: 'person', value: 'Ana' }, { kind: 'person', value: 'Q' }])).toBe('blind: known entry 1 (person) is too short to find or check; give at least two characters');
    expect(refused([{ kind: 'phone', value: 'tel 1' }])).toBe('blind: known entry 0 (phone) is too short to find or check; give at least two characters');
    expect(refused([{ kind: 'phone', value: '12' }, { kind: 'id', value: 'Q1' }, { kind: 'person', value: '李' }])).toBe('accepted');
  });
});

describe('small rules behind known names', () => {
  it('a value is made of stop words only when it has words and every one is a particle or stop word', () => {
    expect(stopWordValue('Al')).toBe(true);
    expect(stopWordValue('De La')).toBe(true);
    expect(stopWordValue('Al Brenner')).toBe(false);
    expect(stopWordValue(' ')).toBe(false);
  });

  it('a stop-word value is written as given or in capitals, spaces collapsed, never run together or in lower case', () => {
    expect(writtenAs('De  La', 'De La')).toBe(true);
    expect(writtenAs('DE LA', 'De La')).toBe(true);
    expect(writtenAs('DeLa', 'De La')).toBe(false);
    expect(writtenAs('de la', 'De La')).toBe(false);
  });

  it('a two-letter name part is capitalised and not a stop word; a bare part must start with a capital', () => {
    expect(shortNamePart('Li')).toBe(true);
    expect(shortNamePart('De')).toBe(false);
    expect(shortNamePart('Al')).toBe(false);
    expect(knownPart('Li')).toBe(true);
    expect(knownPart('Del')).toBe(true);
    expect(knownPart('dE')).toBe(false);
  });

  it('a known name is found by a middle run of its words that holds a particle', () => {
    expect(personForms('Ana van Dijk Ruiz')).toContain('Ana van Dijk');
    expect(personForms('Wang \u674e')).toEqual(['Wang \u674e', 'Wang']);
  });

  it('a known org given with spaces around it is still found without its legal suffix', () => {
    const text = 'Norte Asesores firma.';
    expect(knownDetector([{ kind: 'org', value: ' Norte Asesores S.L. ' }]).detect(text, ctx).map((sp) => text.slice(sp.start, sp.end))).toEqual(['Norte Asesores']);
  });

  it('a three-letter stop word of a known name is not taken in lower case', () => {
    const known: KnownValue[] = [{ kind: 'person', value: 'Del Toro' }];
    const text = 'Del Toro vino. La casa del pueblo. DEL lo sabe.';
    const spans = findSpans([text], { ...ctx, known }, [...builtinDetectors, knownDetector(known)])[0] as Span[];
    expect(spans.filter((sp) => sp.kind === 'person').map((sp) => text.slice(sp.start, sp.end))).toEqual(['Del Toro', 'DEL']);
  });

  it('an org found once is found again where it is written the same way, if it has four characters and a capital', () => {
    const firstOnly = (kind: Kind, value: string): Detector => ({
      name: 'first',
      detect: (t) => {
        const i = t.indexOf(value);
        return i < 0 ? [] : [{ start: i, end: i + value.length, kind }];
      },
    });
    const orgs = (kind: Kind, value: string): string[] => {
      const text = `${value} firma. Luego ${value.trim()} paga.`;
      return (findSpans([text], ctx, [firstOnly(kind, value)])[0] as Span[]).map((sp) => `${sp.kind}:${text.slice(sp.start, sp.end).trim()}`);
    };
    expect(orgs('org', 'Norte Asesores')).toEqual(['org:Norte Asesores', 'org:Norte Asesores']);
    expect(orgs('org', ' Zeds')).toEqual(['org:Zeds', 'org:Zeds']);
    expect(orgs('org', 'Zed')).toEqual(['org:Zed']);
    expect(orgs('org', 'acme corp')).toEqual(['org:acme corp']);
    expect(orgs('place', 'Villa Rosa')).toEqual(['place:Villa Rosa']);
  });
});

describe('id validators at their edges', () => {
  it('a card, SSN, DNI or NIE is valid only as the whole string', () => {
    expect(validCard('4111111111111111')).toBe(true);
    expect(validCard('x4111111111111111')).toBe(false);
    expect(validCard('4111111111111111x')).toBe(false);
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('79927398710')).toBe(false);
    expect(luhnValid('x79927398713')).toBe(false);
    expect(luhnValid('7992739871x')).toBe(false);
    expect(validSsn('789123456')).toBe(true);
    expect(validSsn('1234567890')).toBe(false);
    expect(validSsn('x123456789')).toBe(false);
    expect(validDni('12345678Z')).toBe(true);
    expect(validDni('12345678Zx')).toBe(false);
    expect(validDni('x12345678Z')).toBe(false);
    expect(validNie('X1234567L')).toBe(true);
    expect(validNie('X1234567Lx')).toBe(false);
    expect(validNie('AX1234567L')).toBe(false);
    expect(validCif('B12345674')).toBe(true);
    expect(validCif('B12345674x')).toBe(false);
    expect(validCif('xB12345674')).toBe(false);
  });

  it('a VAT number is checked by its country, Spain against NIF, NIE and CIF, an unknown prefix never', () => {
    expect(validVat('DE123456789')).toBe(true);
    expect(validVat('XX123456789')).toBe(false);
    expect(validVat('ESB12345674')).toBe(true);
    expect(validVat('ES12345678Z')).toBe(true);
    expect(validVat('ESX1234567L')).toBe(true);
    expect(validVat('ESX1234567A')).toBe(false);
  });

  it('IP addresses parse at their limits: 255 in a v4 part, seven groups beside a v6 gap', () => {
    expect(parseIpv4('255.0.0.1')).toEqual([255, 0, 0, 1]);
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv6('1:2:3:4:5:6:7::')).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
    expect(parseIpv6('1:2:3:4:5:6:7:8::')).toBeNull();
    expect(parseIpv6('2001:db8::1x')).toBeNull();
    expect(parseIpv6('x2001:db8::1')).toBeNull();
    expect(parseIpv6('12345::1')).toBeNull();
    expect(parseIpv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
