import { describe, expect, it } from 'vitest';
import { detectAmounts } from '../src/amounts.js';
import { detectDates } from '../src/dates.js';
import { assertNoLeaks, blind, BlindError, checkMapping, createUnblinder, LeakError, prepareUnblinder, unblind, type Detector, type Kind, type KnownValue, type Mapping } from '../src/index.js';
import { foldLookalikes } from '../src/fold.js';
import { checkLeaks } from '../src/leaks.js';
import { FEMALE_FIRST, LAST_NAMES } from '../src/names.js';

const NOW = new Date('2026-06-01T00:00:00Z');

const known: KnownValue[] = [
  { kind: 'person', value: 'Ana Ruiz' },
  { kind: 'person', value: 'Pedro Lamas' },
  { kind: 'org', value: 'Gestoría Norte S.L.' },
  { kind: 'place', value: 'Valencia' },
  { kind: 'domain', value: 'gestoria-norte.example' },
];

// Synthetic thread: every name, company, amount and number below is invented.
const thread = [
  [
    'From: Ana Ruiz <ana.ruiz@gestoria-norte.example>',
    'To: Pedro Lamas <pedro@lamas-studio.example>',
    '',
    'Hola Pedro, la cuota de Gestoría Norte S.L. es 206,50 € + 20 % de recargo = 247,80 €.',
    'Plazo de 15 días desde el 3 de marzo, es decir hasta el 18 de marzo.',
    'Llámame al +34 791 345 678. Expediente EXP-2026-0412, ref 20481735.',
  ].join('\n'),
  [
    'From: Pedro Lamas <pedro@lamas-studio.example>',
    'To: Ana Ruiz <ana.ruiz@gestoria-norte.example>',
    '',
    'Gracias Ana. Transferiré 247,80 € a ES91 2100 0418 4502 0005 1332 antes del 2026-03-18.',
    'Documentos en https://portal.gestoria-norte.example/case/CASE884201?user=pedro%40lamas-studio.example&p=2',
    'La oficina de Valencia confirma la cita del 7 de abril de 2026 a las 10:30.',
  ].join('\n'),
  [
    'From: Ana Ruiz <ana.ruiz@gestoria-norte.example>',
    '',
    'Perfecto Pedro. Si prefieres pagar en dos partes: 100,00 € y 147,80 €. Mi móvil: 791 345 678.',
    'Saludos, Ana Ruiz',
  ].join('\n'),
];

const sensitive = [
  'Ana', 'Ruiz', 'Pedro', 'Lamas', 'gestoria-norte', 'lamas-studio', 'Valencia', '791 345 678', '20481735',
  'EXP-2026-0412', 'CASE884201', 'ES91 2100', '206,50', '247,80', '147,80',
];

const amounts = (t: string): number[] => detectAmounts(t).map((a) => a.minor);

describe('round trip', () => {
  it('restores originals across a three-message thread', () => {
    const res = blind(thread, { known, seed: 'thread', now: NOW });
    expect(res.leaks.ok).toBe(true);
    expect(res.texts).toHaveLength(3);
    for (const s of sensitive) for (const t of res.texts) expect(t).not.toContain(s);

    const mapping = JSON.parse(JSON.stringify(res.mapping)); // survives serialization
    res.texts.forEach((t, i) => {
      const back = unblind(t, mapping);
      expect(back.text).toBe(thread[i]);
      expect(back.invented).toEqual([]);
    });
  });

  it('holds for many seeds', () => {
    for (let i = 0; i < 80; i++) {
      const res = blind(thread, { known, seed: `fuzz-${i}`, now: NOW });
      expect(res.leaks.ok, `seed ${i}`).toBe(true);
      res.texts.forEach((t, k) => {
        const back = unblind(t, res.mapping);
        expect(back.text, `seed ${i} text ${k}`).toBe(thread[k]);
        expect(back.invented, `seed ${i} text ${k}`).toEqual([]);
      });
    }
  });

  it('uses one fake per real value across messages', () => {
    const res = blind(thread, { known, seed: 'thread', now: NOW });
    const from = (t: string): string => /^From: (.+?) </.exec(t)![1]!;
    expect(from(res.texts[0]!)).toBe(from(res.texts[2]!));
    expect(from(res.texts[0]!)).not.toBe(from(res.texts[1]!));
    // The same amount in messages 1 and 2 stays the same amount.
    expect(amounts(res.texts[0]!)[1]).toBe(amounts(res.texts[1]!)[0]);
  });

  it('keeps the email local part tied to the fake name', () => {
    const res = blind(thread, { known, seed: 'thread', now: NOW });
    const m = /^From: (\S+) (\S+) <(\S+)@/.exec(res.texts[0]!)!;
    expect(m[3]!.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')).toContain(
      m[1]!.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''),
    );
  });
});

describe('amounts', () => {
  it('scales a base plus a 20% surcharge so it still sums, for any seed', () => {
    let naiveBreaks = 0;
    for (let i = 0; i < 60; i++) {
      const res = blind(['Base 206,50 € más 20 % de recargo: 247,80 €.'], { seed: `s${i}`, now: NOW });
      const [a, c] = amounts(res.texts[0]!);
      expect(c).toBe(Math.round((a! * 120) / 100));
      expect(res.mapping.factor).toBeGreaterThanOrEqual(0.6);
      expect(res.mapping.factor).toBeLessThanOrEqual(1.6);
      if (Math.round(24780 * res.mapping.factor) !== c) naiveBreaks++;
    }
    // Scaling the total on its own would have been off in some of these runs.
    expect(naiveBreaks).toBeGreaterThan(0);
  });

  it('recomputes base + VAT line = total from scaled operands', () => {
    for (let i = 0; i < 40; i++) {
      const res = blind(['Base 206,50 €. IVA 20 %: 41,30 €. Total 247,80 €.'], { seed: `v${i}`, now: NOW });
      const [a, v, c] = amounts(res.texts[0]!);
      expect(v).toBe(Math.round(a! / 5));
      expect(c).toBe(a! + v!);
    }
  });

  it('C4: an amount that is a 4 % surcharge on one base and 4 % of another keeps both relations to the cent', () => {
    // 10,03 × 1,04 = 10,4312 and 260,63 × 0,04 = 10,4252 both round to 10,43.
    // Seed 1 draws a first factor that rounds them to different cents; the plan draws again.
    const text = 'Base 10,03 € + 4 % = 10,43 €\nEl 4 % de 260,63 € son 10,43 €';
    const res = blind([text], { seed: '1', now: NOW });
    const [surcharge, share] = res.texts[0]!.split('\n').map((line) => amounts(line.replace(/\d+\s?%/g, '')));
    const [base, total] = surcharge!;
    const [whole, part] = share!;
    expect(Math.abs(total! * 100 - base! * 104)).toBeLessThanOrEqual(50);
    expect(Math.abs(part! * 100 - whole! * 4)).toBeLessThanOrEqual(50);
    expect(total).toBe(part);
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(text);
  });

  it('keeps a plain sum a + b = c exact in US format', () => {
    for (let i = 0; i < 40; i++) {
      const res = blind(['Items: $19.99 + $5.01 = $25.00'], { seed: `u${i}`, now: NOW });
      const [a, b, c] = amounts(res.texts[0]!);
      expect(c).toBe(a! + b!);
    }
  });

  it('keeps EU and US formats and the currency position', () => {
    const src = 'A 1.234,56 € B 214,38 € C $1,234.56 D USD 12.00 E 15 euros F £7.50';
    for (let i = 0; i < 10; i++) {
      const out = blind([src], { seed: `f${i}`, now: NOW }).texts[0]!;
      expect(out).toMatch(
        /^A \d{1,3}(?:\.\d{3})*,\d{2} € B \d{1,3}(?:\.\d{3})*,\d{2} € C \$\d{1,3}(?:,\d{3})*\.\d{2} D USD \d+\.\d{2} E \d+ euros F £\d+\.\d{2}$/,
      );
    }
  });

  it('uses one factor for all amounts in the call', () => {
    const res = blind(['Uno 100,00 €', 'Dos 40,00 €', 'Tres 250,00 €'], { seed: 'one', now: NOW });
    const f = res.mapping.factor;
    const [x, y, z] = res.texts.map((t) => amounts(t)[0]!);
    expect(Math.abs(x! - 10000 * f)).toBeLessThanOrEqual(1);
    expect(Math.abs(y! - 4000 * f)).toBeLessThanOrEqual(1);
    expect(Math.abs(z! - 25000 * f)).toBeLessThanOrEqual(1);
  });

  it('leaves bare numbers and percentages alone', () => {
    const out = blind(['15 días, 3 adultos, 20 % de descuento'], { seed: 'bare', now: NOW }).texts[0];
    expect(out).toBe('15 días, 3 adultos, 20 % de descuento');
  });
});

describe('dates', () => {
  const dayMs = 86400000;
  const utc = (o: { y: number | null; m: number; d: number }, year: number): number => Date.UTC(o.y ?? year, o.m - 1, o.d);

  it('C1/unit: two spellings of one date that shift onto one string get two fakes and each comes back as written', () => {
    const src = '1 Jun 2026 and 1 June 2026';
    // Seed chosen so both spellings shift onto one string, which is the case under test.
    const res = blind([src], { seed: '24', now: NOW });
    expect(res.texts[0]).toBe('11 May 2026 and 11th May 2026');
    expect(res.collisions).toEqual([]);
    const back = unblind(res.texts[0] as string, res.mapping);
    expect(back).toEqual({ text: src, invented: [], collisions: [] });
  });

  it('C1/unit: two different dates that shift onto one numeric string get two fakes, and the shift stays the same', () => {
    const src = '27/09/2026 and 06/30/2026';
    const res = blind([src], { seed: '1', now: NOW });
    const fakes = res.mapping.pairs.filter((p) => p.kind === 'date').map((p) => p.fake);
    expect(new Set(fakes).size).toBe(2);
    for (const [real, fake] of res.mapping.pairs.filter((p) => p.kind === 'date').map((p) => [p.real, p.fake] as const)) {
      const r = detectDates(real, 'dmy')[0]!.occ;
      const f = detectDates(fake, 'dmy')[0]!.occ;
      expect((utc(f, 2026) - utc(r, 2026)) / dayMs).toBe(res.mapping.dayShift);
    }
    expect(unblind(res.texts[0] as string, res.mapping).text).toBe(src);
  });

  it('C1/unit: a date written in capitals and as a title comes back in each case', () => {
    const src = '1 JUN 2026 and 1 Jun 2026';
    const res = blind([src], { seed: '1', now: NOW });
    expect(unblind(res.texts[0] as string, res.mapping).text).toBe(src);
  });

  it('C1/unit: a date pair whose fake an earlier pair holds is reported by kind and index, never by value', () => {
    const res = blind(['1 Jun 2026'], { seed: '1', now: NOW });
    const first = res.mapping.pairs.find((p) => p.kind === 'date')!;
    const mapping: Mapping = { ...res.mapping, pairs: [...res.mapping.pairs, { kind: 'date', real: '1 June 2026', fake: first.fake }] };
    const back = unblind(first.fake, mapping);
    expect(back.collisions).toEqual([{ kind: 'date', index: mapping.pairs.length - 1 }]);
    expect(JSON.stringify(back.collisions)).not.toContain('June');
    const u = createUnblinder(mapping);
    u.push(first.fake);
    expect(u.end().collisions).toEqual(back.collisions);
    expect(blind(['1 June 2026'], { mapping }).collisions).toEqual([{ kind: 'date', index: mapping.pairs.length - 1 }]);
  });

  it('shifts "15 días desde el 3 de marzo" to the same weekday with the interval intact', () => {
    const src = 'Plazo de 15 días desde el 3 de marzo, vence el 18 de marzo.';
    for (let i = 0; i < 25; i++) {
      const res = blind([src], { seed: `d${i}`, now: NOW });
      const { dayShift, refYear } = res.mapping;
      expect(Math.abs(dayShift % 7)).toBe(0);
      expect(dayShift).not.toBe(0);
      expect(Math.abs(dayShift)).toBeLessThanOrEqual(70);
      const orig = detectDates(src, 'dmy').map((d) => utc(d.occ, refYear));
      // A date written without a year can land in the neighbouring year; pick the year that fits.
      const out = detectDates(res.texts[0]!, 'dmy').map((d, k) =>
        [refYear - 1, refYear, refYear + 1].map((y) => utc(d.occ, y)).find((t) => t - orig[k]! === dayShift * dayMs)!,
      );
      expect(out.every((t) => t !== undefined)).toBe(true);
      expect(out[0]! - orig[0]!).toBe(dayShift * dayMs);
      expect(new Date(out[0]!).getUTCDay()).toBe(new Date(orig[0]!).getUTCDay());
      expect(out[1]! - out[0]!).toBe(15 * dayMs);
      expect(res.texts[0]).toContain('Plazo de 15 días desde el');
    }
  });

  it('keeps every format and language, and leaves times alone', () => {
    const src = [
      '2026-04-07T10:30:00Z', 'April 7, 2026', '7 April 2026', '9 de abril de 2026', '07/04/2026', '6 de octubre',
      'a las 10:30',
    ].join(' | ');
    const out = blind([src], { seed: 'fmt', now: NOW }).texts[0]!;
    const parts = out.split(' | ');
    expect(parts[0]).toMatch(/^\d{4}-\d{2}-\d{2}T10:30:00Z$/);
    expect(parts[1]).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    expect(parts[2]).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(parts[3]).toMatch(/^\d{1,2} de [a-zñ]+ de \d{4}$/);
    expect(parts[4]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(parts[5]).toMatch(/^\d{1,2} de [a-zñ]+$/);
    expect(parts[6]).toBe('a las 10:30');
  });

  it('reads slash dates by owner locale', () => {
    const dmy = blind(['04/07/2026'], { seed: 'o', now: NOW, dateOrder: 'dmy' });
    const mdy = blind(['04/07/2026'], { seed: 'o', now: NOW, dateOrder: 'mdy' });
    expect(unblind(dmy.texts[0]!, dmy.mapping).text).toBe('04/07/2026');
    expect(unblind(mdy.texts[0]!, mdy.mapping).text).toBe('04/07/2026');
    expect(dmy.texts[0]).not.toBe(mdy.texts[0]);
  });
});

describe('leak check', () => {
  it('catches a deny-list hit that detection did not replace', () => {
    const res = blind(['Seguimiento del Proyecto Falcon para el cliente.'], {
      deny: ['proyecto falcon'], seed: 'deny', now: NOW,
    });
    expect(res.leaks.ok).toBe(false);
    expect(res.leaks.hits).toEqual([{ kind: 'deny', textIndex: 0, offset: expect.any(Number) }]);
  });

  it('catches a known value the whole-word pass missed, and never prints it', () => {
    const res = blind(['Pedido de Contosofoods recibido.'], {
      known: [{ kind: 'org', value: 'Contoso' }], seed: 'miss', now: NOW,
    });
    expect(res.leaks.ok).toBe(false);
    expect(res.leaks.hits[0]).toMatchObject({ kind: 'org', textIndex: 0 });
    expect(() => assertNoLeaks(res)).toThrow(LeakError);
    try {
      assertNoLeaks(res);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/contoso/i);
      expect(JSON.stringify(res.leaks)).not.toMatch(/contoso/i);
    }
  });

  it('passes clean output, and assertNoLeaks stays quiet', () => {
    const res = blind(thread, { known, deny: ['*@gestoria-norte.example', 'Ana Ruiz'], seed: 'clean', now: NOW });
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(() => assertNoLeaks(res)).not.toThrow();
  });

  it('matches *@domain deny entries, and a deny wildcard beats the public-domain allowlist', () => {
    const kept = blind(['Escribe a ana_ruiz@gmail.com'], { seed: 'g', now: NOW });
    expect(kept.texts[0]).toMatch(/@gmail\.com$/);
    const denied = blind(['Escribe a ana_ruiz@gmail.com'], { deny: ['*@gmail.com'], seed: 'g', now: NOW });
    expect(denied.texts[0]).not.toContain('gmail.com');
    expect(denied.leaks.ok).toBe(true);
  });

  it('flags a real amount or date left outside the replaced ranges, but not a coincidence inside one', () => {
    const base = {
      originals: [], deny: [], amountKeys: new Set(['2:5000']), dateKeys: new Set(['2026-3-3']), dateOrder: 'dmy' as const,
    };
    const out = 'Total 50,00 € el 3 de marzo de 2026';
    const bare = checkLeaks({ ...base, outputs: [out], replaced: [[]] });
    expect(bare.hits.map((h) => h.kind).sort()).toEqual(['amount', 'date']);
    const masked = checkLeaks({ ...base, outputs: [out], replaced: [[[6, 11], [18, out.length]]] });
    expect(masked.ok).toBe(true);
  });
});

describe('unblind', () => {
  it('divides amounts back and shifts dates back, and flags them as invented', () => {
    const res = blind(['Importe 100,00 € el 3 de marzo de 2026.'], { seed: 'inv', now: NOW });
    const [fakeAmount] = detectAmounts(res.texts[0]!);
    const sum = ((fakeAmount!.minor * 2) / 100).toFixed(2).replace('.', ',');
    const answer = `Total ${sum} € y una fecha nueva el 20 de mayo de 2031.`;
    const back = unblind(answer, res.mapping);
    expect(back.invented).toContain(`${sum} €`);
    expect(back.invented).toContain('20 de mayo de 2031');
    const realBack = detectAmounts(back.text)[0]!;
    expect(Math.abs(realBack.minor - 20000)).toBeLessThanOrEqual(2);
  });

  it('flags an amount the thread never had', () => {
    const res = blind(['Cuota 80,00 €'], { seed: 'inv2', now: NOW });
    const back = unblind('Debes pagar 999,99 € mañana.', res.mapping);
    expect(back.invented).toEqual(['999,99 €']);
  });

  it('flags invented emails and names but not mapped ones', () => {
    const res = blind(thread, { known, seed: 'thread', now: NOW });
    const mapped = res.mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.fake);
    const first = FEMALE_FIRST.find((n) => !mapped.includes(n))!;
    const last = LAST_NAMES.find((n) => !mapped.includes(n))!;
    const mappedFrom = /^From: (.+?) </.exec(res.texts[0]!)![1]!;
    const answer = `Contacta con ${first} ${last} (otro@elsewhere.example). ${mappedFrom} lo sabe.`;
    const back = unblind(answer, res.mapping);
    expect(back.invented).toEqual(expect.arrayContaining([`${first} ${last}`, 'otro@elsewhere.example']));
    expect(back.invented).not.toContain(mappedFrom);
    expect(back.text).toContain('Ana Ruiz');
  });

  it('restores a shuffled amount format by value', () => {
    const res = blind(['Cuota 247,80 €'], { seed: 'fmt2', now: NOW });
    const [a] = detectAmounts(res.texts[0]!);
    const fakeUs = `$${(a!.minor / 100).toFixed(2)}`;
    const back = unblind(`Pay ${fakeUs}`, res.mapping);
    expect(back.text).toContain('247,80');
    expect(back.invented).toEqual([]);
  });
});

describe('determinism', () => {
  it('gives identical output for the same seed and input', () => {
    const a = blind(thread, { known, seed: 'same', now: NOW });
    const b = blind(thread, { known, seed: 'same', now: NOW });
    expect(b).toEqual(a);
  });

  it('gives different surrogates for different seeds', () => {
    const a = blind(thread, { known, seed: 'one', now: NOW });
    const b = blind(thread, { known, seed: 'two', now: NOW });
    expect(a.texts).not.toEqual(b.texts);
    const names = (r: typeof a): string => r.mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.fake).join();
    expect(names(a)).not.toBe(names(b));
    expect(a.mapping.factor).not.toBe(b.mapping.factor);
  });

  it('draws a random seed when none is given', () => {
    const a = blind(['Ana Ruiz'], { known });
    const b = blind(['Ana Ruiz'], { known });
    expect(a.mapping.seed).not.toBe(b.mapping.seed);
  });
});

describe('shapes', () => {
  it('keeps phone, IBAN and ID shapes and gives a valid IBAN check', () => {
    const src = 'Tel +34 791 345 678 / (415) 555-0123, IBAN ES91 2100 0418 4502 0005 1332, ref ABC-2026-0412';
    const out = blind([src], { seed: 'shape', now: NOW }).texts[0]!;
    expect(out).toMatch(/^Tel \+34 [6-9]\d\d \d{3} \d{3} \/ \(\d{3}\) \d{3}-\d{4}, IBAN ES\d\d( \d{4}){5}, ref [A-Z]{3}-\d{4}-\d{4}$/);
    const iban = /IBAN (ES[\d ]+),/.exec(out)![1]!.replace(/ /g, '');
    const num = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    expect(BigInt(num) % 97n).toBe(1n);
  });

  it('rewrites URL hosts to .example, keeps path shape, scrubs ids and query emails', () => {
    const src = 'Ver https://portal.clientco.example/a/b/c?id=ABC123456&mail=jo%40clientco.example&x=1#top.';
    const out = blind([src], { seed: 'url', now: NOW }).texts[0]!;
    expect(out).toMatch(/^Ver https:\/\/portal\.[a-z-]+\.example\/a\/b\/c\?id=[A-Z]{3}\d{6}&mail=[a-z]+%40[a-z-]+\.example&x=1#top\.$/);
    expect(out).not.toContain('clientco');
    expect(out).not.toContain('ABC123456');
  });

  it('leaves public platform hosts alone but still scrubs their ids and names', () => {
    const src = 'https://calendly.com/ana-ruiz/30min?token=ZZ99887766 y ana_ruiz@gmail.com';
    const out = blind([src], { known: [{ kind: 'person', value: 'Ana Ruiz' }], seed: 'pub', now: NOW }).texts[0]!;
    expect(out).toContain('https://calendly.com/');
    expect(out).toContain('@gmail.com');
    // As a word: the fake of "Ana" may hold those letters ("Adriana"), the real name may not survive.
    expect(out).not.toMatch(/\bana\b|ruiz|ZZ99887766/i);
  });

  it('turns "Name <addr>" headers into a fake name and fake address', () => {
    const out = blind(['Cc: Marcos Villar <m.villar@tallerzeta.example>'], { seed: 'hdr', now: NOW }).texts[0]!;
    expect(out).toMatch(/^Cc: [A-ZÁ-Ú][\p{L}]+ [A-ZÁ-Ú][\p{L}]+ <[a-z.]+@[a-z-]+\.example>$/u);
    expect(out).not.toMatch(/Marcos|Villar|tallerzeta/);
  });

  it('accepts a custom detector', () => {
    const t = 'Nos vemos en la Plaza Mayor mañana.';
    const start = t.indexOf('Plaza Mayor');
    const res = blind([t], {
      seed: 'plug', now: NOW,
      detectors: [{ name: 'ner', detect: () => [{ start, end: start + 'Plaza Mayor'.length, kind: 'place' }] }],
    });
    expect(res.texts[0]).not.toContain('Plaza Mayor');
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(t);
  });
});

describe('streaming unblind', () => {
  const real = 'From: Ana Ruiz <ana@gestoria.example>\nTotal: 247,80 € antes del 3 de marzo de 2026.';
  const { texts, mapping } = blind([real], { seed: 'stream' });
  const fake = texts[0] as string;
  const filler = 'Here is a long explanation that goes on for a while so the stream has room to let text out early. ';

  it('C22: lets text out before the end and restores a value split across chunks', () => {
    const answer = `${filler.repeat(4)}${fake}\n${filler.repeat(4)}`;
    const u = createUnblinder(mapping);
    const pieces: string[] = [];
    for (let i = 0; i < answer.length; i += 3) pieces.push(u.push(answer.slice(i, i + 3)));
    const early = pieces.join('');
    expect(early.length).toBeGreaterThan(filler.length * 6);
    const all = early + u.end().text;
    expect(all).toBe(unblind(answer, mapping).text);
    expect(all).toContain(real);
  });

  it('C22: holds back the tail until end and refuses use after end', () => {
    const u = createUnblinder(mapping);
    expect(u.push(fake.slice(0, 60))).toBe('');
    const r = u.push(fake.slice(60)) + u.end().text;
    expect(r).toBe(real);
    expect(() => u.push('x')).toThrow(/after end/);
    expect(() => u.end()).toThrow(/twice/);
    const v = createUnblinder(mapping);
    v.push('Pagamos 999,99 € y escribimos a otra@persona.example.');
    expect(v.end().invented).toEqual(['999,99 €', 'otra@persona.example']);
  });

  it('C22: never cuts inside an amount whose currency comes after a space', () => {
    const answer = `${filler.repeat(3)}Pagado 1.234,56 € hoy. ${filler.repeat(3)}`;
    const u = createUnblinder(mapping);
    let out = '';
    for (let i = 0; i < answer.length; i++) out += u.push(answer[i] as string);
    out += u.end().text;
    expect(out).toBe(unblind(answer, mapping).text);
  });
});

describe('continuing a mapping', () => {
  const good = blind(['Ana Ruiz pagó 247,80 € el 3 de marzo de 2026.'], { seed: 'm' }).mapping;

  it('C21: accepts a mapping blind made and refuses one that breaks its invariants, naming only the field', () => {
    expect(() => checkMapping(good)).not.toThrow();
    const cases: Array<[unknown, string]> = [
      [null, 'shape'], [{ ...good, version: 2 }, 'version'], [{ ...good, seed: '' }, 'seed'],
      [{ ...good, factor: 1 }, 'factor'], [{ ...good, factor: 1.02 }, 'factor'], [{ ...good, factor: 2 }, 'factor'], [{ ...good, factor: '1.2' }, 'factor'],
      [{ ...good, dayShift: 0 }, 'dayShift'], [{ ...good, dayShift: 3 }, 'dayShift'], [{ ...good, dayShift: 77 }, 'dayShift'], [{ ...good, dayShift: 7.5 }, 'dayShift'],
      [{ ...good, dateOrder: 'ymd' }, 'dateOrder'], [{ ...good, refYear: 'x' }, 'refYear'], [{ ...good, pairs: {} }, 'pairs'],
      [{ ...good, pairs: [{ kind: 'secret', real: 'a', fake: 'b' }] }, 'pairs[0]'],
      [{ ...good, pairs: [{ kind: 'person', real: '', fake: 'b' }] }, 'pairs[0]'],
      [{ ...good, pairs: [...good.pairs, { kind: 'person', real: 'Ana', fake: 'ANA' }] }, `pairs[${good.pairs.length}]`],
    ];
    for (const [m, field] of cases) {
      expect(() => blind(['x'], { mapping: m as Mapping }), field).toThrow(`blind: the mapping is not valid (${field})`);
    }
    // A public address can legitimately keep its fake equal to the real value.
    expect(() => checkMapping({ ...good, pairs: [{ kind: 'email', real: 'no-reply@gmail.com', fake: 'no-reply@gmail.com' }] })).not.toThrow();
  });

  it('C22: a date whose year arrives after a long gap is not cut early when streaming', () => {
    const { mapping } = blind(['Cita el 3 de marzo de 2026.'], { seed: 'x' });
    const answer = `Vence el 3 March${' '.repeat(150)}2026 y nada más.`;
    const u = createUnblinder(mapping);
    let out = u.push(answer.slice(0, 160));
    out += u.push(answer.slice(160)) + u.end().text;
    expect(out).toBe(unblind(answer, mapping).text);
  });
});

describe('amount spellings', () => {
  const texts = [
    'Total 1.234,56 € and １.２３４,５６ € and 1234,56 €.',
    'Pay $1,234.56 or $１,２３４.５６ by Friday.',
    'Fee £１20.00 then £120.00 again.',
    'Total 1 240,80 € and 1.240,80 € and 1\u202f240,80 € and 1\u00a0240,80 €.',
  ];
  it.each(texts)('C43: each spelling of one amount gets its own fake and comes back as written: %s', (text) => {
    for (const seed of ['c43-a', 'c43-b', 'c43-c']) {
      const res = blind([text], { seed, now: NOW });
      expect(res.collisions).toEqual([]);
      const fakes = res.mapping.pairs.filter((p) => p.kind === 'amount').map((p) => p.fake);
      expect(new Set(fakes).size).toBe(fakes.length);
      const back = unblind(res.texts[0] as string, JSON.parse(JSON.stringify(res.mapping)) as Mapping);
      expect(back.text).toBe(text);
      expect(back.collisions).toEqual([]);
    }
  });

  it('C4: an amount grouped with spaces is scaled whole, keeps its separator, and its sum still adds up', () => {
    const value = (t: string): number => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
    let grown = 0;
    for (let i = 0; i < 40; i++) {
      for (const sp of [' ', '\u00a0', '\u202f', '\u2009']) {
        const text = `Base 3${sp}250,00 € plus 1${sp}000,50 € makes 4${sp}250,50 €.`;
        const res = blind([text], { seed: `c4-space-${i}`, now: NOW });
        const out = res.texts[0] as string;
        const [a, b, c] = [...out.matchAll(/(\d[\d \u00a0\u202f\u2009]*,\d\d) €/g)].map((m) => value(m[1] as string)) as [number, number, number];
        // The whole number moved by the factor, not only its last group.
        expect(Math.abs(a - 3250 * res.mapping.factor), out).toBeLessThanOrEqual(0.02);
        expect(Math.round((a + b) * 100), out).toBe(Math.round(c * 100));
        expect(out).not.toMatch(/\b[134] (?:250|000),/);
        if (c >= 1000) {
          expect(out, 'the separator the text groups with').toContain(`${Math.floor(c / 1000)}${sp}`);
          grown++;
        }
        expect(unblind(out, res.mapping).text).toBe(text);
      }
    }
    expect(grown).toBeGreaterThan(0);
  });

  it('C1: the largest amount blind scales comes back when its fake is a digit longer, in every spelling', () => {
    for (const text of ['Fondo 999 999 999 999 999 € hoy.', 'Fondo 999.999.999.999.999 € hoy.', 'Fondo 999999999999999 € hoy.', 'Fondo 9 999 999 999 999,99 € hoy.']) {
      let grew = 0;
      for (let i = 0; i < 12; i++) {
        const res = blind([text], { seed: `c1-digits-${i}`, now: NOW });
        if (res.mapping.factor > 1) grew++;
        expect(res.replaced).toEqual({ amount: 1 });
        expect(unblind(res.texts[0] as string, res.mapping).text, `${text} ${res.mapping.factor}`).toBe(text);
      }
      expect(grew).toBeGreaterThan(0);
    }
    // One digit more is not an amount blind scales: its fake could not be an exact number.
    expect(blind(['Fondo 9999999999999999 € hoy.'], { seed: 'c1-digits', now: NOW }).replaced.amount).toBeUndefined();
    // Digits an amount holds are not a phone number, however they are grouped.
    for (const text of ['Son 650.000.000 € en total.', 'Son 850 000 000 EUR en total.']) expect(blind([text], { seed: 'c1-digits', now: NOW }).replaced).toEqual({ amount: 1 });
  });

  it('C4: a four-digit number before a spaced amount is not taken as its thousands', () => {
    expect(detectAmounts('Factura 2026 500 € y 12 34 €').map((a) => a.raw)).toEqual(['500', '34']);
    expect(detectAmounts('USD 1 234.56 o 1 240 800 EUR').map((a) => [a.raw, a.minor, a.decimals])).toEqual([['1 234.56', 123456, 2], ['1 240 800', 1240800, 0]]);
  });

  it('C43: spellings that would scale to one string get the same value written another way', () => {
    const text = 'Rent 1.234 € and 1234 €, then 1.234,50 € and 1234,50 €.';
    let checked = 0;
    for (let i = 0; i < 200 && checked < 3; i++) {
      const res = blind([text], { seed: `c43-low-${i}`, now: NOW });
      if (res.mapping.factor >= 0.8) continue;
      checked++;
      const folded = detectAmounts(foldLookalikes(res.texts[0] as string));
      // Below 1,000 the separator is gone, so one fake per value is written another way, same value.
      const values = folded.map((a) => a.minor / 10 ** a.decimals);
      expect(values).toEqual([values[0], values[0], values[2], values[2]]);
      expect(new Set(res.mapping.pairs.filter((p) => p.kind === 'amount').map((p) => p.fake)).size).toBe(4);
      expect(res.collisions).toEqual([]);
      expect(unblind(res.texts[0] as string, res.mapping).text).toBe(text);
    }
    expect(checked).toBe(3);
  });

  it('C43: amount pairs that share a fake are listed in collisions by both blind and unblind', () => {
    const res = blind(['Fee £120.00 today.'], { seed: 'c43-edit', now: NOW });
    const pair = res.mapping.pairs.find((p) => p.kind === 'amount')!;
    const edited: Mapping = { ...res.mapping, pairs: [...res.mapping.pairs, { kind: 'amount', real: '１20.00', fake: pair.fake }] };
    const index = edited.pairs.length - 1;
    expect(unblind(res.texts[0] as string, edited).collisions).toEqual([{ kind: 'amount', index }]);
    expect(blind(['Again £１20.00.'], { mapping: edited, now: NOW }).collisions).toContainEqual({ kind: 'amount', index });
  });
});

describe('mapping checks at the edges', () => {
  const base: Mapping = { version: 1, seed: 's', replaceWith: 'fake', factor: 1.2, dayShift: 14, dateOrder: 'dmy', refYear: 2026, pairs: [] };
  const field = (m: unknown): string => {
    try {
      checkMapping(m);
    } catch (e) {
      return /\(([^)]+)\)$/.exec((e as Error).message)?.[1] ?? (e as Error).message;
    }
    return 'ok';
  };

  it('takes a factor from 0.6 to 1.6 at least 0.05 away from 1, and a nonzero whole-week shift of up to ten weeks', () => {
    for (const factor of [0.6, 1.6, 0.95, 1.05]) expect(field({ ...base, factor }), String(factor)).toBe('ok');
    for (const factor of [0.59, 1.61, 1.04, 0.96, 1, '1.2']) expect(field({ ...base, factor }), String(factor)).toBe('factor');
    for (const dayShift of [70, -70, 7, -7]) expect(field({ ...base, dayShift }), String(dayShift)).toBe('ok');
    for (const dayShift of [77, 0, 3, 7.5, '14', null]) expect(field({ ...base, dayShift }), String(dayShift)).toBe('dayShift');
  });

  it('refuses a mapping of the wrong shape, version, seed, date order or reference year, naming the field', () => {
    expect(field(null)).toBe('shape');
    expect(field('mapping')).toBe('shape');
    expect(field({ ...base, version: 2 })).toBe('version');
    expect(field({ ...base, seed: '' })).toBe('seed');
    expect(field({ ...base, seed: 7 })).toBe('seed');
    expect(field({ ...base, dateOrder: 'mdy' })).toBe('ok');
    expect(field({ ...base, dateOrder: 'ymd' })).toBe('dateOrder');
    expect(field({ ...base, refYear: 2026.5 })).toBe('refYear');
    expect(field({ ...base, refYear: '2026' })).toBe('refYear');
    expect(field({ ...base, pairs: {} })).toBe('pairs');
  });

  it('takes literals only in placeholder mode and only as whole placeholders', () => {
    const ph = { ...base, replaceWith: 'placeholder', factor: 1, dayShift: 0 };
    expect(field({ ...ph, literals: ['[REDACTED_PERSON_1]', '[REDACTED_ID_12]'] })).toBe('ok');
    for (const literals of [['[REDACTED_PERSON_1]', 5], ['x[REDACTED_PERSON_1]'], ['[REDACTED_PERSON_1]x'], ['[REDACTED_PERSON_1a]'], 'x']) {
      expect(field({ ...ph, literals }), JSON.stringify(literals)).toBe('literals');
    }
  });

  it('refuses a pair that is not one, or whose fake equals its real value where blind always changes it', () => {
    const pair = (p: unknown, over: Partial<Mapping> = {}): string => field({ ...base, ...over, pairs: [{ kind: 'email', real: 'a@x.example', fake: 'b@x.example' }, p] });
    expect(pair({ kind: 'person', real: 'Ana', fake: 'Lucía' })).toBe('ok');
    for (const p of [null, { kind: 'iban2', real: 'a', fake: 'b' }, { kind: 'person', real: 5, fake: 'b' }, { kind: 'person', real: 'a', fake: 5 }, { kind: 'person', real: '', fake: 'b' }]) {
      expect(pair(p), JSON.stringify(p)).toBe('pairs[1]');
    }
    expect(pair({ kind: 'person', real: 'Ana', fake: 'ANA' })).toBe('pairs[1]');
    expect(pair({ kind: 'email', real: 'a@x.example', fake: 'A@x.example' })).toBe('ok');
    expect(pair({ kind: 'amount', real: '12,00', fake: '12,00' })).toBe('ok');
    expect(pair({ kind: 'amount', real: '12,00', fake: '12,00' }, { replaceWith: 'random', factor: 1, dayShift: 0 })).toBe('pairs[1]');
  });
});

describe('a name after a title', () => {
  const surnames = new Set(LAST_NAMES.map((n) => n.toLowerCase()));
  const fakeOf = (text: string, real: string, seed: string): string => blind([text], { seed, now: NOW }).mapping.pairs.find((p) => p.real === real)!.fake;

  it('one word after a title that takes a surname gets a surname, wherever the text first writes it', () => {
    for (const seed of ['t1', 't2', 't3', 't4']) {
      expect(surnames.has(fakeOf('Mr Holloway and Mrs. Raman met Ms Okafor.', 'Holloway', seed).toLowerCase())).toBe(true);
      expect(surnames.has(fakeOf('Mr Holloway and Mrs. Raman met Ms Okafor.', 'Raman', seed).toLowerCase())).toBe(true);
      expect(surnames.has(fakeOf('Holloway called. Then Mr Holloway wrote.', 'Holloway', seed).toLowerCase())).toBe(true);
      // A known value found after a title is a surname too.
      const known = blind(['Mr Holloway wrote. Holloway agreed.'], { seed, now: NOW, known: [{ kind: 'person', value: 'Holloway' }] });
      expect(surnames.has(known.mapping.pairs.find((p) => p.real === 'Holloway')!.fake.toLowerCase())).toBe(true);
      expect(surnames.has(fakeOf('La Sra. Quintela llamó.', 'Quintela', seed).toLowerCase())).toBe(true);
      // After a title a given name follows, and for a word on the first-name lists, the fake is a first name.
      expect(surnames.has(fakeOf('Hablé con Don Evaristo ayer.', 'Evaristo', seed).toLowerCase())).toBe(false);
      expect(surnames.has(fakeOf('La Sra. Lucía llamó.', 'Lucía', seed).toLowerCase())).toBe(false);
    }
  });

  it('ends at a full stop after a word, and keeps an initial', () => {
    const spans = (text: string): string[] => {
      const res = blind([text], { seed: 't', now: NOW, replaceWith: 'placeholder' });
      return res.mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.real);
    };
    expect(spans('We met Dr. Okafor. Thanks for coming.')).toEqual(['Okafor']);
    expect(spans('We met Dr. J. Orvane yesterday.')).toEqual(['J. Orvane']);
  });
});

/** The kind and message of the error `fn` throws, or `ok`. */
function kindOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return `${(e as { kind: string }).kind}: ${(e as Error).message}`;
  }
  return 'ok';
}

describe('a call blind cannot read as meant', () => {
  const secret = 'Orvane Kelpstrom';
  const options = 'known, deny, seed, now, dateOrder, allowDomains, detectors, paranoid, allow, replaceWith, mapping, maxTextLength';

  it('refuses texts that are not an array of strings, naming the index and never the text', () => {
    expect(kindOf(() => blind(secret as unknown as string[]))).toBe('invalid-option: blind: texts must be an array of strings; pass one text as [text]');
    expect(kindOf(() => blind(undefined as unknown as string[]))).toBe('invalid-option: blind: texts must be an array of strings');
    expect(kindOf(() => blind({ 0: secret } as unknown as string[]))).toBe('invalid-option: blind: texts must be an array of strings');
    expect(kindOf(() => blind(['Hola', [secret]] as unknown as string[]))).toBe('invalid-option: blind: text 1 is not a string');
    expect(kindOf(() => blind([]))).toBe('ok');
  });

  it('refuses an option it does not know, so a misspelt known list is never ignored, and never quotes the key', () => {
    const typo = { knwon: [{ kind: 'person', value: secret }] } as never;
    const message = kindOf(() => blind([`Hello ${secret}`], typo));
    expect(message).toBe(`invalid-option: blind: options has a key blind does not know; the options are ${options}`);
    expect(message).not.toContain('knwon');
    expect(kindOf(() => blind(['x'], { [secret]: true } as never))).not.toContain(secret);
    expect(kindOf(() => blind(['x'], null as never))).toBe('invalid-option: blind: options must be an object');
    expect(kindOf(() => blind(['x'], [] as never))).toBe('invalid-option: blind: options must be an object');
    expect(kindOf(() => blind(['x'], undefined))).toBe('ok');
  });

  it('refuses a list option of the wrong type, naming the option and the index and never the entry', () => {
    expect(kindOf(() => blind(['x'], { known: { kind: 'person', value: secret } as never }))).toBe('invalid-known: blind: known must be an array of { kind, value }');
    expect(kindOf(() => blind(['x'], { deny: secret as never }))).toBe('invalid-option: blind: deny must be an array of strings');
    expect(kindOf(() => blind(['x'], { deny: ['a', 7] as never }))).toBe('invalid-option: blind: deny entry 1 is not a string');
    expect(kindOf(() => blind(['x'], { allowDomains: secret as never }))).toBe('invalid-option: blind: allowDomains must be an array of strings');
    expect(kindOf(() => blind(['x'], { detectors: {} as never }))).toBe('invalid-option: blind: detectors must be an array');
  });

  it('refuses a seed, date order or now that would make a mapping unblind and the next turn cannot read', () => {
    for (const seed of [7, '', null, {}]) expect(kindOf(() => blind(['x'], { seed: seed as never })), String(seed)).toBe('invalid-option: blind: seed must be a string that is not empty');
    expect(kindOf(() => blind(['x'], { dateOrder: 'ymd' as never }))).toBe('invalid-option: blind: dateOrder must be dmy or mdy');
    for (const now of [new Date(Number.NaN), '2026-03-03', 0]) expect(kindOf(() => blind(['x'], { now: now as never })), String(now)).toBe('invalid-option: blind: now must be a valid Date');
    const r = blind(['Paga 1.240,50 € a marta@brisanorte.example'], { seed: '7', dateOrder: 'mdy', now: new Date('2026-03-03T00:00:00Z') });
    expect(() => checkMapping(r.mapping)).not.toThrow();
  });
});

describe('text size limit', () => {
  it('accepts a text at the limit and refuses one past it, and refuses a limit that is not a positive number', () => {
    expect(kindOf(() => blind(['abcd'], { seed: 's', maxTextLength: 4 }))).toBe('ok');
    expect(kindOf(() => blind(['abcd'], { seed: 's', maxTextLength: 3 }))).toMatch(/^input-too-large: /);
    for (const maxTextLength of [0, -1, Number.NaN, '10' as unknown as number]) {
      expect(kindOf(() => blind(['abcd'], { seed: 's', maxTextLength })), String(maxTextLength)).toBe('invalid-option: blind: maxTextLength must be a positive number');
    }
    expect(kindOf(() => blind(['x'], { replaceWith: 'mask' as never }))).toBe('invalid-option: blind: replaceWith must be one of fake, placeholder, random');
  });
});

describe('placeholders for a name found again word by word', () => {
  const ph = (text: string): string => blind([text], { seed: 'p', replaceWith: 'placeholder' }).texts[0] as string;

  it('joins words of one name across spaces, tabs and particles in any case, never across another word or another kind', () => {
    expect(ph('From: Lucía de la Fuente <lucia@fuente.example>\nHola Lucía de la Fuente, y Lucía\tFuente, Lucía  Fuente.'))
      .toBe('From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>\nHola [REDACTED_PERSON_1], y [REDACTED_PERSON_2], [REDACTED_PERSON_3].');
    expect(ph('From: Ana Ruiz <ana@ruiz.example>\nAna Ruiz y Ana come Ruiz; Ana van Ruiz; Ana DE Ruiz.'))
      .toBe('From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>\n[REDACTED_PERSON_1] y [REDACTED_PERSON_2] come [REDACTED_PERSON_3]; [REDACTED_PERSON_4]; [REDACTED_PERSON_5].');
    expect(ph('From: Ana Ruiz <ana@ruiz.example>\nAna Ruiz ana@ruiz.example Ana'))
      .toBe('From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>\n[REDACTED_PERSON_1] [REDACTED_EMAIL_1] [REDACTED_PERSON_2]');
  });
});

describe('what the leak check is told to look for', () => {
  // A caller's detector that finds only the first copy, so the second is left for the leak check.
  const firstOnly = (kind: Kind, value: string): Detector => ({
    name: 'first',
    detect: (t) => {
      const i = t.indexOf(value);
      return i < 0 ? [] : [{ start: i, end: i + value.length, kind }];
    },
  });
  const leftOver = (kind: Kind, value: string, later: string): Array<[string, number]> =>
    blind([`Ref ${value} hoy. Luego ${later} otra vez.`], { seed: 'k', detectors: [firstOnly(kind, value)] }).leaks.hits.map((h) => [h.kind, h.offset]);

  it('a copy left of an org, place, domain or id is reported under its kind, an org also without its legal suffix', () => {
    expect(leftOver('org', 'Xq7 Holdings S.L.', 'XQ7 HOLDINGS')).toEqual([['org', 38]]);
    expect(leftOver('place', 'Villaquemada', 'VILLAQUEMADA')).toEqual([['place', 23]]);
    expect(leftOver('domain', 'zqholdings', 'ZQHOLDINGS')).toEqual([['domain', 36]]);
    expect(leftOver('id', 'QX-77341', 'qx 77341')).toEqual([['id', 24]]);
    // A public platform stays as written and is not looked for.
    expect(leftOver('domain', 'gmail.com', 'GMAIL.COM')).toEqual([]);
  });

  it('the host of an email in any escaped form, or of a URL with or without its scheme, is looked for as a domain', () => {
    expect(leftOver('email', 'ana%40zqhost', 'ANA%40ZQHOST')).toEqual([['email', 44], ['domain', 50]]);
    expect(leftOver('email', 'ana&#64;zqhosta', 'ZQHOSTA')).toEqual([['domain', 46]]);
    expect(leftOver('email', 'ana&#x40;zqhostb', 'ZQHOSTB')).toEqual([['domain', 47]]);
    expect(leftOver('email', 'ana&#0064;zqhostc', 'ZQHOSTC')).toEqual([['domain', 48]]);
    expect(leftOver('url', 'http://zqweb/a', 'ZQWEB')).toEqual([['domain', 45]]);
    expect(leftOver('url', 'zqsite/b', 'ZQSITE')).toEqual([['domain', 38]]);
    expect(leftOver('url', 'https://zqsecure/c', 'ZQSECURE')).toEqual([['domain', 46]]);
  });
});

describe('random mode by kind', () => {
  it('an IBAN from any country becomes a Spanish-length random one, and an IP address a documentation address', () => {
    const out = blind(['IBAN DE89 3704 0044 0532 0130 00 y servidor 2001:db8:85a3::8a2e:370:7334.'], { seed: 'r', replaceWith: 'random' }).texts[0] as string;
    expect(out).toMatch(/^IBAN ES\d{2}( \d{4}){5} y servidor 2001:db8:[0-9a-f:]+\.$/);
  });
});

describe('unblind against a hand-made mapping', () => {
  const m: Mapping = {
    version: 1, seed: 's', replaceWith: 'fake', factor: 1.2, dayShift: 14, dateOrder: 'dmy', refYear: 2026, pairs: [
      { kind: 'amount', real: '100,00', fake: '120,00' }, { kind: 'date', real: '3 de marzo de 2026', fake: '17 de marzo de 2026' },
      { kind: 'person', real: 'Ana', fake: 'Lucía' }, { kind: 'person', real: 'Ruiz', fake: 'Vidal' },
    ],
  };

  it('names come back word by word in the case written, and a first name with no fake behind every word is invented', () => {
    expect(unblind('Lucía Vidal y LUCÍA VIDAL y Lucía Marta. Marta Ruiz habló con Lucía.', m)).toEqual({
      text: 'Ana Ruiz y ANA RUIZ y Ana Marta. Marta Ruiz habló con Ana.', invented: ['Lucía Marta', 'Marta Ruiz'], collisions: [],
    });
  });

  it('a fake amount comes back however its decimals are written, and an unknown amount or date is scaled or shifted back and listed', () => {
    expect(unblind('Son 120 € y 120,0 € y 36,00 € el 17 DE MARZO DE 2026 y el 31 de marzo de 2026.', m)).toEqual({
      text: 'Son 100,00 € y 100,00 € y 30,00 € el 3 de marzo de 2026 y el 17 de marzo de 2026.', invented: ['36,00 €', '31 de marzo de 2026'], collisions: [],
    });
  });

  it('in random mode an unknown amount or date stays as written', () => {
    const rnd: Mapping = { ...m, replaceWith: 'random', factor: 1, dayShift: 0 };
    expect(unblind('Son 120,00 € y 36,00 € el 17 de marzo de 2026 y el 31 de marzo de 2026.', rnd).text).toBe('Son 100,00 € y 36,00 € el 3 de marzo de 2026 y el 31 de marzo de 2026.');
  });

  it('a mapping that is not valid is refused as invalid-mapping with the field, one-shot, prepared and streaming', () => {
    const cases: Array<[unknown, string]> = [
      [null, 'shape'],
      [{ pairs: null }, 'version'],
      [{ ...m, pairs: null }, 'pairs'],
      // A factor of 0 would write `Infinity` into the answer, and a shift that is not a number an invalid date.
      [{ ...m, factor: 0 }, 'factor'],
      [{ ...m, dayShift: Number.NaN }, 'dayShift'],
      [{ ...m, pairs: [{ kind: 'person', real: 'Ana', fake: 7 }] }, 'pairs[0]'],
    ];
    for (const [bad, field] of cases) {
      for (const fn of [() => unblind('Son 120,00 €', bad as Mapping), () => createUnblinder(bad as Mapping), () => prepareUnblinder(bad as Mapping)]) {
        expect(kindOf(fn), field).toBe(`invalid-mapping: blind: the mapping is not valid (${field})`);
      }
    }
  });

  it('a phone, card, IBAN or id fake the model writes in another layout comes back in that layout, one-shot and streamed', () => {
    const text = 'Call +44 7700 900123. Card 4111 1111 1111 1111. IBAN ES91 2100 0418 4502 0005 1332. SSN 536-90-4399.';
    const res = blind([text], { seed: 'layout', now: NOW });
    const fake = (real: string): string => res.mapping.pairs.find((p) => p.real === real)!.fake;
    const [phone, card, iban, ssn] = ['+44 7700 900123', '4111 1111 1111 1111', 'ES91 2100 0418 4502 0005 1332', '536-90-4399'].map(fake) as [string, string, string, string];
    const answer = `Phone ${phone.replace(/ /g, '')} or ${phone.replace(/ /g, '-')}. Card ${card.replace(/ /g, '-')} / ${card.replace(/ /g, '')}. IBAN ${iban.replace(/ /g, '')}. SSN ${ssn.replace(/-/g, ' ')}.`;
    const want = 'Phone +447700900123 or +44-7700-900123. Card 4111-1111-1111-1111 / 4111111111111111. IBAN ES9121000418450200051332. SSN 536 90 4399.';
    expect(unblind(answer, res.mapping)).toEqual({ text: want, invented: [], collisions: [] });
    for (const size of [1, 3, 7, 50]) {
      const u = createUnblinder(res.mapping);
      let out = '';
      for (let i = 0; i < answer.length; i += size) out += u.push(answer.slice(i, i + size));
      expect(out + u.end().text, `chunks of ${size}`).toBe(want);
    }
    // Inside a longer number, or with other digits glued on, it is another number and stays.
    const glued = `x${card.replace(/ /g, '')}9 and ${card.replace(/ /g, '')}00 and 1 ${card}`;
    expect(unblind(glued, res.mapping).text).toBe(`x${card.replace(/ /g, '')}9 and ${card.replace(/ /g, '')}00 and 1 4111 1111 1111 1111`);
    // A fake under eight letters and digits is matched only as written: `12.03.26` is not the id 120326.
    const six: Mapping = { ...m, pairs: [...m.pairs, { kind: 'id', real: '654321', fake: '120326' }] };
    expect(unblind('El 12.03.26 y 12 03 26, ref 120326.', six).text).toBe('El 12.03.26 y 12 03 26, ref 654321.');
    // An IP address keeps its dots: another grouping of its digits is another address.
    const ip: Mapping = { ...m, pairs: [...m.pairs, { kind: 'id', real: '10.23.45.67', fake: '192.0.2.123' }] };
    expect(unblind('Hosts 192.0.2.123 and 192.0.21.23.', ip).text).toBe('Hosts 10.23.45.67 and 192.0.21.23.');
    // A full-width digit glued on makes it a longer number, and two values that share letters and digits are matched only as written.
    const wide: Mapping = { ...m, pairs: [...m.pairs, { kind: 'id', real: '65432109', fake: '12345678' }] };
    expect(unblind('９12-34-56-78９ and 12-34-56-78', wide).text).toBe('９12-34-56-78９ and 65-43-21-09');
    const twins: Mapping = { ...m, pairs: [...m.pairs, { kind: 'id', real: '65432109', fake: '12345678' }, { kind: 'id', real: '9988-7766', fake: '1234-5678' }] };
    expect(unblind('12 34 56 78, 12345678, 1234-5678', twins).text).toBe('12 34 56 78, 65432109, 9988-7766');
  });

  it('an answer or chunk that is not a string is refused by name', () => {
    const message = 'invalid-option: unblind: the text must be a string';
    expect(kindOf(() => unblind(7 as unknown as string, m))).toBe(message);
    expect(kindOf(() => prepareUnblinder(m).unblind(undefined as unknown as string))).toBe(message);
    expect(kindOf(() => createUnblinder(m).push(null as unknown as string))).toBe(message);
  });

  it('checks the answer length, one-shot and over every chunk of a stream, and refuses a limit that is not a positive number', () => {
    expect(unblind('Lucía', m, { maxTextLength: 5 }).text).toBe('Ana');
    expect(() => unblind('Lucía', m, { maxTextLength: 4 })).toThrow('unblind: input-too-large (text 0 is 5 UTF-16 units, the limit is 4)');
    for (const maxTextLength of [0, -1, Number.NaN, '10' as unknown as number]) {
      expect(() => unblind('x', m, { maxTextLength }), String(maxTextLength)).toThrow(/^unblind: maxTextLength must be a positive number$/);
      expect(() => createUnblinder(m, { maxTextLength }), String(maxTextLength)).toThrow(/^unblind: maxTextLength must be a positive number$/);
    }
    const u = createUnblinder(m, { maxTextLength: 10 });
    expect(u.push('Marta ') + u.push('Ruiz')).toBe('');
    expect(() => u.push('!')).toThrow('unblind: input-too-large (text 0 is 11 UTF-16 units, the limit is 10)');
  });

  it('a stream reports the names invented across chunks, and refuses a push or an end after the end', () => {
    const u = createUnblinder(m);
    const out = u.push('Marta ') + u.push('Ruiz y Lucía.');
    const last = u.end();
    expect(out + last.text).toBe('Marta Ruiz y Ana.');
    expect(last.invented).toEqual(['Marta Ruiz']);
    expect(() => u.push('x')).toThrow(/^unblind: push after end$/);
    expect(() => u.end()).toThrow(/^unblind: end called twice$/);
    let kind = '';
    try {
      u.end();
    } catch (e) {
      kind = (e as BlindError).kind;
    }
    expect(kind).toBe('stream-closed');
  });
});
