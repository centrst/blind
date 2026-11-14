import { describe, expect, it } from 'vitest';
import { builtinDetectors, findSpans } from '../src/detect.js';
import { blind } from '../src/index.js';
import type { DetectContext } from '../src/types.js';

// Every name, company and address is invented.
const ctx: DetectContext = { dateOrder: 'dmy', isAllowedHost: (h) => h === 'gmail.com' || h.endsWith('.gmail.com') };
const find = (...texts: string[]): string[][] =>
  findSpans(texts, ctx, builtinDetectors).map((spans, i) =>
    spans.filter((s) => s.kind === 'person' || s.kind === 'org').map((s) => `${s.kind}:${(texts[i] as string).slice(s.start, s.end)}`),
  );

const EMAIL = [
  'Dear Margaret,',
  '',
  'Thanks for the call. Please send the contract to margaret.holloway@finchley-dental.example.',
  '',
  'Kind regards,',
  'Priya Raman',
  'Finchley Dental Ltd',
  '14 Orchard Lane, Wexcombe WX4 2BN',
].join('\n');

describe('names where ordinary mail puts them', () => {
  it('C54: an email with nothing in known loses its greeting, sign-off and company, and the leak check holds them', () => {
    const res = blind([EMAIL], { seed: 's1' });
    const out = res.texts[0] as string;
    for (const real of ['Margaret', 'Holloway', 'Priya', 'Raman', 'Finchley', 'finchley']) expect(out).not.toContain(real);
    expect(res.leaks.ok).toBe(true);
    expect(find(EMAIL)).toEqual([['person:Margaret', 'person:Priya Raman', 'org:Finchley Dental Ltd']]);
  });

  it('C54: a greeting at the start of a line names one to three capitalised words, several people included, quoted lines too', () => {
    expect(find('Hi Ana,\nHello Tobias Wren, thanks.\nHola Belén:\nEstimado/a Cayetano,\nBuenos días, Isidro.\nQuerida Remedios,\n> > Dear Odette Rivas,')).toEqual([[
      'person:Ana', 'person:Tobias Wren', 'person:Belén', 'person:Cayetano', 'person:Isidro', 'person:Remedios', 'person:Odette Rivas',
    ]]);
    expect(find('Hi Ana, Luis and Marta,\nDear Margaret Holloway and Priya Raman,')).toEqual([[
      'person:Ana', 'person:Luis', 'person:Marta', 'person:Margaret Holloway', 'person:Priya Raman',
    ]]);
    // A title opens a name the title rule reads.
    expect(find('Dear Dr. Tate,')).toEqual([['person:Tate']]);
  });

  it('C54: a greeting to a group, a role or nobody names no one', () => {
    const text = [
      'Hi all,', 'Hi there,', 'Hi everyone, quick update.', 'Hi Team,', 'Dear Sir or Madam,', 'Dear Customer,', 'Dear Valued Customer,',
      'Dear Hiring Manager,', 'Hey guys,', 'Good morning, everyone.', 'Hola a todos,', 'Hola equipo,', 'Estimado cliente,', 'Buenos días a todos,',
      'Hello World', 'Dear customer,', 'Hi Ana is here.',
    ].join('\n');
    expect(find(text)).toEqual([[]]);
  });

  it('C54: the line after a closing is a person, and the first company line under it an org', () => {
    expect(find('Best regards,\nOdette Ashworth\nRecepción\nDorsal Partners LLC\nTel: 0')).toEqual([['person:Odette Ashworth', 'org:Dorsal Partners LLC']]);
    expect(find('> > Saludos cordiales,\n> > Cayetano Zamora\n> > Accounts\n> > Ingeniería Pinar')).toEqual([['person:Cayetano Zamora', 'org:Ingeniería Pinar']]);
    expect(find('Un saludo, Wenceslao Tamames, Ayuntamiento de Valdecañas')).toEqual([['person:Wenceslao Tamames']]);
    expect(find('Thanks,\nJ. Orvane')).toEqual([['person:J. Orvane']]);
  });

  it('C54: a sign-off a blank line below its closing is a person, and the company line under it an org', () => {
    expect(find('Thanks for the call.\n\nKind regards,\n\nPriya Raman')).toEqual([['person:Priya Raman']]);
    expect(find('Best regards,\n\nOdette Ashworth\nDorsal Partners LLC')).toEqual([['person:Odette Ashworth', 'org:Dorsal Partners LLC']]);
    expect(find('Un saludo,\n\nMaría José Ferrán Gil')).toEqual([['person:María José Ferrán Gil']]);
    // One blank line only: two make the name line part of something else.
    expect(find('Kind regards,\n\n\nPriya Raman')).toEqual([[]]);
  });

  it('C54: a job title after a comma keeps the sign-off a person, and the company line under it an org', () => {
    expect(find('Regards,\nOdette Ashworth, CEO\nDorsal Partners')).toEqual([['person:Odette Ashworth', 'org:Dorsal Partners']]);
    expect(find('Thanks,\nTobias Wren, Head of Sales\nWren & Marlow Ltd')).toEqual([['person:Tobias Wren', 'org:Wren & Marlow Ltd']]);
    expect(find('Kind regards,\n\nPriya Raman, Practice Manager')).toEqual([['person:Priya Raman']]);
    expect(find('Atentamente,\nMaría José Ferrán Gil, Directora Financiera\nFerrán Asesores S.L.')).toEqual([['person:María José Ferrán Gil', 'org:Ferrán Asesores S.L.']]);
  });

  it('C54: a title line after a closing is no person, and lower case after the comma is a sentence', () => {
    for (const text of [
      'Regards,\nAccounts, Finchley', 'Thanks,\n\nThe Board', 'Kind regards,\nOdette Ashworth, thanks again for everything',
      'Thanks,\n\nI will call you tomorrow.', 'Gracias,\n\nEquipo de Soporte',
    ]) expect(find(text), text).toEqual([[]]);
  });

  it('C54: a closing before a role, a team, a phone signature or a sentence names no one', () => {
    for (const text of [
      'Thanks,\nSent from my iPhone', 'Best regards,\nThe Support Team\nCustomer Service', 'Kind regards,\nAccounts Department',
      'Regards,\nAccounts', 'Thanks!\nI will call you tomorrow.', 'Saludos,\nEquipo de Soporte', 'Best,\nDental Clinic',
      'Thanks, I will check.', 'Cheers,\nMonday works for me.',
    ]) expect(find(text), text).toEqual([[]]);
  });

  it('C54: a label before a name is a person, a company label an org, and an empty value nothing', () => {
    expect(find('Name: Margaret Holloway\nPatient: Priya Raman\nCompany: Finchley Dental Ltd\nNombre: Belén Ortuño\nEmpresa: Talleres Yelmo\nAttn: Tobias Wren')).toEqual([[
      'person:Margaret Holloway', 'person:Priya Raman', 'org:Finchley Dental Ltd', 'person:Belén Ortuño', 'org:Talleres Yelmo', 'person:Tobias Wren',
    ]]);
    expect(find('Name: N/A\nCustomer: Yes\nContact: Support\nClient: TBD\nCompany: Inc\nCustomer: Finchley Dental Ltd')).toEqual([['org:Finchley Dental Ltd']]);
  });

  it('C54: a capitalised run before a legal suffix is an org, without the words that open its sentence or another company', () => {
    expect(find('Regarding Montalbán Gráficas S.L., no arrears. We paid Priya Raman of Larkmoor Joinery Ltd. Total charged to Maddox Studio Ltd: EUR 318.40.')).toEqual([[
      'org:Montalbán Gráficas S.L.', 'org:Larkmoor Joinery Ltd.', 'org:Maddox Studio Ltd',
    ]]);
    expect(find('Hollin Corp and Brackwater LLC signed. Strand & Partners Ltd billed Ruiz y Asociados SL.')).toEqual([[
      'org:Hollin Corp', 'org:Brackwater LLC', 'org:Strand & Partners Ltd', 'org:Ruiz y Asociados SL',
    ]]);
    expect(find('Our company is a Ltd. The Ltd went bust.')).toEqual([[]]);
  });

  it('C54: the words of a private address name its person and company where the text writes them capitalised', () => {
    const text = 'Write to margaret.holloway@finchley-dental.example.\nHolloway agreed. The Finchley-Dental team and Finchley Dental Ltd. Margaret signed.';
    expect(find(text)).toEqual([['person:Holloway', 'org:Finchley-Dental', 'org:Finchley Dental Ltd.', 'person:Margaret']]);
    // Across the texts of a call, as a name found once is.
    expect(find('From: margaret.holloway@finchley-dental.example', 'Margaret will call.')).toEqual([[], ['person:Margaret']]);
    // Role words, host words and a public host say nothing; a word the text writes in lower case is an ordinary word.
    expect(find('Mail info@finchley-dental.example or sales.team@finchley-dental.example. Info and Sales replied.')).toEqual([[]]);
    expect(find('Mail rosa_paz@gmail.com. Rosa replied.')).toEqual([[]]);
    expect(find('Mail rosa@casa-verde.example. Rosa painted the wall rosa.')).toEqual([[]]);
    // One host word alone is not a company: `Dorsal` is an ordinary capitalised word as often as not.
    expect(find('Mail ana@dorsal.example. Dorsal fins.')).toEqual([[]]);
  });

  it('C54: a part of an address a caller\'s detector marked names nobody, so no copy of it is split and a host left behind', () => {
    const partial = { name: 'partial', detect: (t: string) => { const i = t.indexOf('ana%40zqh'); return i < 0 ? [] : [{ start: i, end: i + 9, kind: 'email' as const, priority: 99 }]; } };
    const res = blind(['Escribe a ana%40zqh y luego ANA%40ZQH otra vez.'], { seed: 's', replaceWith: 'placeholder', detectors: [partial] });
    expect(res.texts[0]).toBe('Escribe a [REDACTED_EMAIL_1] y luego ANA%40ZQH otra vez.');
    expect(res.leaks.ok).toBe(false);
  });

  it('C41/C54: thousands of private hosts with labels too long for one pattern finish quickly', () => {
    const long = Array.from({ length: 2000 }, (_, i) => `a${i}@${'q'.repeat(250)}-${'w'.repeat(10)}-n${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26) % 26)}.example`).join('\n');
    const started = performance.now();
    blind([long], { seed: 's' });
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it('C41/C54: the cues stay linear on inputs built to make them backtrack', () => {
    const inputs = [
      `Hi ${'Ab '.repeat(50_000)}x`,
      `Kind regards,\n${'Ab '.repeat(50_000)}`,
      `${'Ab '.repeat(50_000)}Ltd`,
      `${'Ab Ltd '.repeat(30_000)}`,
      `Name:${' '.repeat(200_000)}Ana`,
      `Hi${' '.repeat(200_000)}Ana,`,
      `x${' '.repeat(200_000)}Ltd`,
      `${'Regards,\nAb\n'.repeat(30_000)}`,
      `a@${'ab-'.repeat(30_000)}cd.example ${'Ab '.repeat(30_000)}`,
    ];
    for (const text of inputs) {
      const start = performance.now();
      findSpans([text], ctx, builtinDetectors);
      expect(performance.now() - start, text.slice(0, 12)).toBeLessThan(3000);
    }
  });
});
