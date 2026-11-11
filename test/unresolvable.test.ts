/**
 * C58: a fake address or phone number reaches no one. The inputs here are
 * live-range numbers and ownable mailboxes on purpose, since the point is
 * that their fakes are not. Only a prefix or a list name is written in the
 * source; the rest is drawn at run time, and the checks are booleans so a
 * failure prints neither the input nor its fake.
 */
import { describe, expect, it } from 'vitest';
import { blind, createUnblinder, unblind } from '../src/index.js';
import { FAKES, unownableMailbox } from '../src/names.js';
import { Rng } from '../src/prng.js';
import type { Mapping } from '../src/types.js';
import { NANP_FICTION, UK_DRAMA } from './support/values.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const rng = new Rng('C58 live inputs');
const digits = (n: number): string => Array.from({ length: n }, () => rng.int(10)).join('');

/** The fake `blind` gives `value` in `text`, found through its pair. */
function fakeOf(text: string, value: string, kind: 'phone' | 'email', known = false): { fake: string; mapping: Mapping; blindText: string } {
  const res = blind([text], { seed: 'C58', now: NOW, known: known ? [{ kind, value }] : [] });
  const fake = res.mapping.pairs.find((p) => p.kind === kind && p.real === value)?.fake;
  expect(fake !== undefined, `the ${kind} got a pair`).toBe(true);
  expect(unblind(res.texts[0] as string, res.mapping).text === text, 'the text round trips').toBe(true);
  return { fake: fake as string, mapping: res.mapping, blindText: res.texts[0] as string };
}

/** The national digits of a UK number written with +44, 0044, +44 (0) or 0. */
const ukNational = (p: string): string => p.replace(/\D/g, '').replace(/^(?:0044|44)0?|^0/, '');

describe('C58: phone fakes', () => {
  // Leading digits of live UK lines, and the drama range each must land in.
  const uk: Array<[string, string]> = [
    ['203', '2079460'], ['207', '2079460'], ['113', '1134960'], ['118', '1184960'], ['121', '1214960'], ['161', '1614960'],
    ['191', '1914980'], ['292', '2920180'], ['1225', '1632960'], ['1632', '1632960'], ['289', '1632960'], ['300', '3069990'],
    ['800', '8081570'], ['808', '8081570'], ['845', '1632960'], ['909', '9098790'], ['7911', '7700900'], ['7700', '7700900'],
  ];

  it('C58/unit: every UK number becomes a number in the Ofcom drama range of its kind of line, in each layout', () => {
    for (const [lead, range] of uk) {
      const n = lead + digits(10 - lead.length);
      const layouts = [`+44 ${n.slice(0, 4)} ${n.slice(4)}`, `+44${n}`, `0044 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`, `+44 (0) ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`, `0${n.slice(0, 4)} ${n.slice(4)}`];
      for (const phone of layouts) {
        // A UK landline written with a 0 is not found on its own, so it is passed in `known`.
        const { fake } = fakeOf(`Please call ${phone} after lunch.`, phone, 'phone', phone.startsWith('0') && !phone.startsWith('0044'));
        const nat = ukNational(fake);
        expect(UK_DRAMA.test(nat) && nat.startsWith(range), `a UK ${lead} number lands in its drama range`).toBe(true);
        expect(fake.replace(/\d/g, '9').startsWith(phone.replace(/\d/g, '9')), 'the layout stays').toBe(true);
      }
    }
  });

  it('C58/unit: a nine-digit UK number gets a ten-digit drama number, and a second turn gives it the same fake', () => {
    const phone = `+44 800 ${digits(6)}`;
    const text = `Freephone ${phone} today.`;
    const { fake, mapping } = fakeOf(text, phone, 'phone');
    expect(/^\+44 808 157\d{4}$/.test(fake), 'it becomes 0808 157 0xxx').toBe(true);
    expect(UK_DRAMA.test(ukNational(fake)), 'the fake is in the drama range').toBe(true);
    const next = blind([`${text} Again: ${phone}.`], { mapping });
    expect(next.mapping.pairs.find((p) => p.kind === 'phone' && p.real === phone)?.fake === fake, 'the second turn keeps the fake').toBe(true);
    expect(unblind(next.texts[0] as string, next.mapping).text === `${text} Again: ${phone}.`, 'the second turn round trips').toBe(true);
  });

  it('C58/unit: a nine-digit UK number written with its 0 gets an eleven-digit drama number', () => {
    const phone = `0800 ${digits(6)}`;
    const { fake } = fakeOf(`Freephone ${phone} today.`, phone, 'phone', true);
    expect(/^0808 157\d{4}$/.test(fake), 'it becomes 0808 157 0xxx').toBe(true);
  });

  it('C58/unit: the same digits after another country code keep their own country\'s fake, in either order and across turns', () => {
    const d = digits(6);
    const [ukNum, esNum] = [`+44 800 ${d}`, `+34 800 ${d}`];
    for (const [a, b] of [[ukNum, esNum], [esNum, ukNum]] as const) {
      const first = fakeOf(`Call ${a}.`, a, 'phone');
      const next = blind([`Call ${a} or ${b}.`], { mapping: first.mapping });
      const fake = (real: string): string => next.mapping.pairs.find((p) => p.kind === 'phone' && p.real === real)?.fake ?? '';
      expect(UK_DRAMA.test(ukNational(fake(ukNum))), 'the UK number is in its drama range').toBe(true);
      expect(fake(esNum).replace(/\D/g, '').length === esNum.replace(/\D/g, '').length, 'the Spanish number keeps its length').toBe(true);
      expect(unblind(next.texts[0] as string, next.mapping).text === `Call ${a} or ${b}.`, 'the later turn round trips').toBe(true);
    }
  });

  it('C58/unit: every ten-digit North American number becomes NXX-555-01XX, in each layout', () => {
    for (const area of ['212', '415', '800', '155']) {
      const n = `${area}${String(2 + rng.int(8))}${digits(6)}`;
      for (const phone of [`(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`, `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`, `+1 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`, `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`]) {
        const { fake } = fakeOf(`Call ${phone} now.`, phone, 'phone');
        expect(NANP_FICTION.test(fake.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')), `a ${area} number becomes 555-01XX`).toBe(true);
      }
    }
  });
});

describe('C58: address fakes', () => {
  const words = (lang: 'en' | 'es'): [string, string] => {
    const f = FAKES[lang];
    const plain = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    return [plain(f.female[rng.int(f.female.length)] as string), plain(f.last[rng.int(f.last.length)] as string)];
  };

  it('C58/unit: a fake mailbox at a public provider goes to the provider\'s name under .example, in English and Spanish text', () => {
    const cases: Array<[string, string, string]> = [
      ['en', 'gmail.com', 'Please write to {} today.'], ['en', 'outlook.com', 'Please write to {} today.'], ['en', 'icloud.com', 'Please write to {} today.'],
      ['es', 'gmail.com', 'Escríbeme a {} hoy.'], ['es', 'hotmail.com', 'Escríbeme a {} hoy.'], ['es', 'yahoo.com', 'Escríbeme a {} hoy.'],
    ];
    for (const [lang, host, frame] of cases) {
      const [first, last] = words(lang as 'en' | 'es');
      for (const local of [`${first}.${last}`, `${first}${last}`, `${first[0]}${last}`]) {
        const email = `${local}@${host}`;
        const { fake } = fakeOf(frame.replace('{}', email), email, 'email');
        const at = fake.lastIndexOf('@');
        expect(fake.slice(at + 1) === `${host.split('.')[0] as string}.example`, `a ${lang} address at ${host} goes under .example`).toBe(true);
        expect(unownableMailbox(fake.slice(0, at), fake.slice(at + 1)), 'no one can own the fake').toBe(true);
      }
    }
  });

  it('C58/unit: a public provider stays when the address stays or the provider can never issue the fake, and a private host goes under .example', () => {
    // A role word stays as written, so the address is the real one and keeps its host. It is built here so no literal names a mailbox someone could own.
    const role = ['info', 'gmail.com'].join('@');
    expect(fakeOf(`Write to ${role} today.`, role, 'email', true).fake === role, 'a role address stays').toBe(true);
    // Gmail never issues an underscore, so the fake of `ana_ruiz` stays at gmail.com.
    const kept = fakeOf('Escribe a ana_ruiz@gmail.com hoy.', 'ana_ruiz@gmail.com', 'email').fake;
    expect(/^[a-z]+_[a-z]+@gmail\.com$/.test(kept), 'an underscore keeps gmail.com').toBe(true);
    for (const host of ['ward-bookkeeping.example', 'lumen-taller.example']) {
      const [first, last] = words(host.startsWith('lumen') ? 'es' : 'en');
      const email = `${first}.${last}@${host}`;
      const fake = fakeOf(`Write to ${email} today.`, email, 'email').fake;
      expect(/@[a-z]+-[a-z]+\.example$/.test(fake) && !fake.endsWith(`@${host}`), 'a private host gets a fake under .example').toBe(true);
    }
  });

  it('C58/unit: an address in a link goes under .example too, and a reply that writes its fake in capitals comes back, one-shot and streamed', () => {
    const [first, last] = words('en');
    const email = `${first}.${last}@gmail.com`;
    const text = `Open https://booking.ward-bookkeeping.example/x?to=${email} or write to ${email}.`;
    const res = blind([text], { seed: 'C58', now: NOW });
    expect(res.texts[0]!.includes('@gmail.com'), 'no fake mailbox at gmail.com').toBe(false);
    expect((res.texts[0]!.match(/@gmail\.example/g) ?? []).length === 2, 'both addresses go under gmail.example').toBe(true);
    const fake = res.mapping.pairs.find((p) => p.kind === 'email' && p.real === email)?.fake as string;
    const reply = `Sure, I wrote to ${fake.toUpperCase()} and to ${fake}.`;
    // An address comes back as it was written, whatever case the reply gives its fake.
    expect(unblind(reply, res.mapping).text === `Sure, I wrote to ${email} and to ${email}.`, 'the reply comes back in either case').toBe(true);
    const u = createUnblinder(res.mapping);
    let streamed = '';
    for (let i = 0; i < reply.length; i += 3) streamed += u.push(reply.slice(i, i + 3));
    expect(streamed + u.end().text === unblind(reply, res.mapping).text, 'streamed unblind matches').toBe(true);
  });
});

describe('C58: a mapping from 0.2.0', () => {
  it('C58/unit: pairs whose fakes were made before this rule keep their fakes in a later turn and come back, and new values get unresolvable fakes', () => {
    const [first, last] = [FAKES.en.female[0] as string, FAKES.en.last[0] as string].map((s) => s.toLowerCase()) as [string, string];
    const email = `${first}.${last}@gmail.com`;
    const phone = `+44 20 3${digits(7)}`;
    const text = `Write to ${email} or call ${phone}.`;
    const res = blind([text], { seed: 'C58 old', now: NOW });
    // Rewrite the pairs the way 0.2.0 made them: the provider kept, a London number with live digits.
    const oldEmail = `${FAKES.en.male[0]!.toLowerCase()}.${FAKES.en.last[1]!.toLowerCase()}@gmail.com`;
    const oldPhone = `+44 20 7${digits(7)}`;
    const old: Mapping = {
      ...res.mapping,
      pairs: res.mapping.pairs.map((p) => (p.kind === 'email' ? { ...p, fake: oldEmail } : p.kind === 'phone' ? { ...p, fake: oldPhone } : p)),
    };
    const oldText = (res.texts[0] as string).replace(res.mapping.pairs.find((p) => p.kind === 'email')!.fake, oldEmail).replace(res.mapping.pairs.find((p) => p.kind === 'phone')!.fake, oldPhone);
    expect(unblind(oldText, old).text === text, 'the old blind text comes back').toBe(true);
    const newPhone = `+44 161 ${digits(7)}`;
    const next = blind([`${text} Or ${newPhone}.`], { mapping: old });
    const fakeOfReal = (real: string): string | undefined => next.mapping.pairs.find((p) => p.real === real)?.fake;
    expect(fakeOfReal(email) === oldEmail && fakeOfReal(phone) === oldPhone, 'the old pairs keep their fakes').toBe(true);
    expect(UK_DRAMA.test(ukNational(fakeOfReal(newPhone) ?? '')), 'a new number gets a drama-range fake').toBe(true);
    expect(unblind(next.texts[0] as string, next.mapping).text === `${text} Or ${newPhone}.`, 'the later turn round trips').toBe(true);
  });
});
