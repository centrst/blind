import { describe, expect, it } from 'vitest';
import { blind, unblind, type Detector, type KnownValue, type Mapping } from '../src/index.js';
import { checkLeaks, type LeakInput, type Original } from '../src/leaks.js';

const NOW = new Date('2026-06-01T00:00:00Z');

/** A later turn of the conversation `first` started, on a copy of its mapping. */
const later = (texts: string[], mapping: Mapping, known?: KnownValue[]) => blind(texts, { now: NOW, mapping: structuredClone(mapping), ...(known ? { known } : {}) });
const restored = (texts: string[], mapping: Mapping): string[] => texts.map((t) => unblind(t, mapping).text);

describe('a name from an earlier turn, written later in lower case', () => {
  // Senders whose display names are made of words every text uses.
  const HEADERS = ['"Work From Home" <jobs@offers.example>', '"Will Harrow" <will@harbor-mail.example>', '"Priya Raman" <priya@lakeshore.example>'];
  const first = blind(HEADERS, { seed: 'ordinary-words', now: NOW });

  it('C21: the first turn learns every word of the display names', () => {
    expect(first.leaks.ok).toBe(true);
    expect(first.mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.real)).toEqual(['Work', 'From', 'Home', 'Will', 'Harrow', 'Priya', 'Raman']);
  });

  it('C21: the same words in lower case are ordinary words in a later turn: left as written, unreported, with no new pair', () => {
    const src = ['in ten seconds from now you will work at home', 'it will work from here, thanks priya'];
    const next = later(src, first.mapping);
    expect(next.texts).toEqual(src);
    expect(next.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(next.mapping.pairs).toEqual(first.mapping.pairs);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });

  it('C21: written with a capital they are replaced in a later turn, with the fakes of the first, and round trip', () => {
    const src = ['Will called about Harrow. WILL HARROW wrote.'];
    const next = later(src, first.mapping);
    const fake = (real: string): string => first.mapping.pairs.find((p) => p.real === real)!.fake;
    expect(next.texts[0]).toBe(`${fake('Will')} called about ${fake('Harrow')}. ${fake('Will').toUpperCase()} ${fake('Harrow').toUpperCase()} wrote.`);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });

  it('C21: a capital and a lower-case copy in one later text: only the capital one is replaced, and the text round trips', () => {
    const src = ['Will it work? It will, said Will.'];
    const next = later(src, first.mapping);
    const fake = first.mapping.pairs.find((p) => p.real === 'Will')!.fake;
    expect(next.texts[0]).toBe(`${fake} it work? It will, said ${fake}.`);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });

  it('C21: a name the owner lists in known is replaced in lower case in a later turn', () => {
    const src = ['thanks, will'];
    const next = later(src, first.mapping, [{ kind: 'person', value: 'Will Harrow' }]);
    expect(next.texts[0]).not.toMatch(/will/i);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });

  it('C21: a name the later turn writes with its own header counts in lower case there, as in a call with no mapping', () => {
    const src = ['"Will Harrow" <will@harbor-mail.example>', 'thanks, will'];
    const fresh = blind(src, { seed: 'ordinary-words', now: NOW });
    const next = later(src, first.mapping);
    expect(fresh.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 1, offset: 8 }], unenforced: [] });
    expect(next.leaks).toEqual(fresh.leaks);
  });

  it('C21: a name the later turn greets counts in lower case in its other texts too', () => {
    const next = later(['thanks, priya', 'Hi Priya,\n\nsee you there.'], first.mapping);
    expect(next.texts[1]).not.toContain('Priya');
    expect(next.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 8 }], unenforced: [] });
  });

  it('C21: inside a link the words of an earlier name are replaced in lower case, as before', () => {
    const src = ['see https://tools.example/people/priya-raman for more'];
    const next = later(src, first.mapping);
    expect(next.texts[0]).not.toMatch(/priya|raman/i);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });
});

describe('a name from an earlier turn that an address of the later turn gives away', () => {
  const first = blind(['"Priya Raman" <priya@lakeshore.example>', '"Finchley Dental" <office@finchley-mail.example>'], { seed: 'given-away', now: NOW });

  it('C21: the name written with a capital is this turn\'s own find, so its lower-case copy is reported as in a call with no mapping', () => {
    const src = ['priya@newhost.example', 'Priya called.', 'thanks, priya'];
    const fresh = blind(src, { seed: 'given-away', now: NOW });
    const next = later(src, first.mapping);
    expect(next.texts[1]).not.toContain('Priya');
    expect(fresh.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 2, offset: 8 }], unenforced: [] });
    expect(next.leaks).toEqual(fresh.leaks);
  });

  it('C21: without a copy with a capital the address alone reports nothing, with or without the mapping', () => {
    const src = ['priya@newhost.example', 'thanks, priya'];
    expect(blind(src, { seed: 'given-away', now: NOW }).leaks.ok).toBe(true);
    expect(later(src, first.mapping).leaks.ok).toBe(true);
  });

  it('C21: a company its host gives away counts in lower case too, as in a call with no mapping', () => {
    const src = ['Write to office@finchley-dental.example', 'Finchley Dental called.', 'the finchley dental people'];
    const fresh = blind(src, { seed: 'given-away', now: NOW });
    const next = later(src, first.mapping);
    expect(next.texts[1]).not.toContain('Finchley');
    expect(fresh.leaks).toEqual({ ok: false, hits: [{ kind: 'org', textIndex: 2, offset: 4 }], unenforced: [] });
    expect(next.leaks).toEqual(fresh.leaks);
  });
});

describe('a full name from an earlier turn in placeholder mode', () => {
  it('C21: its two-letter parts are found again with a capital, and in lower case only when the name is in known', () => {
    const first = blind(['"Li Na" <lina@harbor-mail.example>'], { seed: 'parts', now: NOW, replaceWith: 'placeholder' });
    expect(first.mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.real)).toEqual(['Li Na']);
    const src = ['li and na went. Li and Na went.'];
    const next = later(src, first.mapping);
    expect(next.texts[0]).toMatch(/^li and na went\. \[REDACTED_PERSON_\d\] and \[REDACTED_PERSON_\d\] went\.$/);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);

    const listed = later(src, first.mapping, [{ kind: 'person', value: 'Li Na' }]);
    expect(listed.texts[0]).not.toMatch(/\b(li|na)\b/i);
    expect(restored(listed.texts, listed.mapping)).toEqual(src);
  });

  it('C21: joined to a name an address of the later turn gives away, the joined name is this turn\'s own find', () => {
    const first = blind(['"Priya Raman" <priya@lakeshore.example>'], { seed: 'join', now: NOW, replaceWith: 'placeholder' });
    const next = later(['okafor@newhost.example', 'Priya Okafor called.', 'thanks, okafor'], first.mapping);
    expect(next.texts[1]).toMatch(/^\[REDACTED_PERSON_\d\] called\.$/);
    expect(next.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 2, offset: 8 }], unenforced: [] });
  });

  it('C21: it is leak-checked word by word, so one word of it with a capital in a link kept as written is reported', () => {
    const first = blind(['"Priya Raman" <priya@lakeshore.example>'], { seed: 'words', now: NOW, replaceWith: 'placeholder', keep: ['url'] });
    expect(first.mapping.pairs.filter((p) => p.kind === 'person').map((p) => p.real)).toEqual(['Priya Raman']);
    const next = later(['see https://lakeshore.example/Raman and raman'], first.mapping);
    expect(next.texts[0]).toBe('see https://lakeshore.example/Raman and raman');
    expect(next.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 30 }], unenforced: [] });
  });
});

describe('a company from an earlier turn, written later in lower case', () => {
  const first = blind(['"Northwind Ltd" <billing@northwind-mail.example>'], { seed: 'ordinary-company', now: NOW });

  it('C21: it is replaced with a capital and in capitals, and left as written in lower case, alone and inside a longer word', () => {
    const src = ['Northwind and NORTHWIND wrote. A northwind blew over northwindlabs.'];
    const next = later(src, first.mapping);
    expect(next.texts[0]).toMatch(/^\S+ and \S+ wrote\. A northwind blew over northwindlabs\.$/);
    expect(next.texts[0]).not.toMatch(/Northwind|NORTHWIND/);
    expect(next.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });

  it('C21: its address and host are found in any letter case, as before', () => {
    const src = ['Write to BILLING@NORTHWIND-MAIL.EXAMPLE or see Northwind-Mail.example.'];
    const next = later(src, first.mapping);
    expect(next.texts[0]).not.toMatch(/northwind/i);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });
});

describe('a name from an earlier turn in other scripts', () => {
  const first = blind(['"דוד לוי" <david@levi.example>', '"Иван Петров" <ivan@petrov.example>', '"王伟" <wang@huaxing.example>'], { seed: 'scripts', now: NOW });

  it('C21: a script without letter case is found again as written, and a Cyrillic name with a capital but not in lower case', () => {
    const src = ['דוד וגם Иван и иван, 王伟在'];
    const next = later(src, first.mapping);
    expect(next.texts[0]).toMatch(/^\S+ וגם \S+ и иван, \S+在$/);
    expect(next.texts[0]).not.toMatch(/דוד|Иван|王伟/);
    expect(next.leaks.ok).toBe(true);
    expect(restored(next.texts, next.mapping)).toEqual(src);
  });
});

describe('a fake from an earlier turn that spells a name a later turn finds', () => {
  const first = blind(['"Priya Raman" <priya@lakeshore.example>'], { seed: 'spell', now: NOW });
  const fake = first.mapping.pairs.find((p) => p.real === 'Priya')!.fake;

  it('C21: the later name gets a fake of its own, the earlier fake stands for the earlier name, nothing is reported and both come back', () => {
    const src = [`"${fake} Ostrander" <post@elmfield.example>`, `Priya wrote to ${fake} today.`];
    const next = later(src, first.mapping);
    const second = next.mapping.pairs.find((p) => p.kind === 'person' && p.real === fake)!.fake;
    expect(second).not.toBe(fake);
    expect(next.texts[1]).toBe(`${fake} wrote to ${second} today.`);
    expect(next.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(restored(next.texts, next.mapping)).toEqual(src);

    // One turn on, the later name is only in the mapping, and the earlier fake still stands for the earlier name.
    const third = later([`Priya wrote to ${fake} today.`], next.mapping);
    expect(third.texts[0]).toBe(`${fake} wrote to ${second} today.`);
    expect(third.leaks.ok).toBe(true);
  });

  it('C21: the later name left as written beside the fake is reported', () => {
    // A lower-case copy is not replaced, and the header of this turn makes the name one this turn found.
    const next = later([`"${fake} Ostrander" <post@elmfield.example>`, `Priya wrote to ${fake.toLowerCase()} today.`], first.mapping);
    expect(next.texts[1]).toBe(`${fake} wrote to ${fake.toLowerCase()} today.`);
    expect(next.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 1, offset: `${fake} wrote to `.length }], unenforced: [] });
  });
});

describe('a company inside a link that goes out as written', () => {
  it('C2: the link is a value blind wrote, over text that holds the company, so the copy is reported', () => {
    const res = blind(['"Northwind Ltd" <billing@northwind-mail.example>', 'see https://github.com/northwindlabs for docs'], { seed: 'link', now: NOW });
    expect(res.texts[1]).toBe('see https://github.com/northwindlabs for docs');
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'org', textIndex: 1, offset: 23 }], unenforced: [] });
  });
});

describe('the leak check, on a name inside a value the engine wrote', () => {
  const input = (output: string, range: [number, number], over: string | undefined, originals: Original[]): LeakInput => ({
    outputs: [output], replaced: [[range]], ...(over === undefined ? {} : { written: [[over]] }), originals, deny: [], amountKeys: new Set<string>(), dateKeys: new Set<string>(), dateOrder: 'dmy',
  });
  const found: Original[] = [{ kind: 'person', value: 'Bethany' }];
  const hit = { ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 0 }], unenforced: [] };
  const clean = { ok: true, hits: [], unenforced: [] };

  it('C2: a found name spelled by a fake written over another value is no hit', () => {
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'Priya', found))).toEqual(clean);
    expect(checkLeaks(input('bethany@ashby-works.example wrote.', [0, 27], 'priya@lakeshore.example', found))).toEqual(clean);
  });

  it('C2: it is a hit when the value written over holds the name, in any letter case or with an accent', () => {
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'Bethany', found))).toEqual(hit);
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'BETHÁNY CALDWELL', found))).toEqual(hit);
  });

  it('C2: it is a hit outside what the engine wrote, across the edge of it, and when the engine does not say what it wrote over', () => {
    expect(checkLeaks(input('Bethany wrote.', [8, 13], 'Priya', found))).toEqual(hit);
    expect(checkLeaks(input('Bethany wrote.', [0, 4], 'Priya', found))).toEqual(hit);
    expect(checkLeaks(input('Bethany wrote.', [3, 7], 'Priya', found))).toEqual(hit);
    expect(checkLeaks(input('Bethany wrote.', [0, 7], undefined, found))).toEqual(hit);
  });

  it('C2: the second of two values the engine wrote is read against what that one was written over', () => {
    const both = (second: string): LeakInput => ({ ...input('Carla met Bethany.', [0, 5], 'Priya', found), replaced: [[[0, 5], [10, 17]]], written: [['Priya', second]] });
    expect(checkLeaks(both('Ines'))).toEqual(clean);
    expect(checkLeaks(both('Bethany'))).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 10 }], unenforced: [] });
  });

  it('C3: a known value spelled by a fake written over another value is a hit', () => {
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'Priya', [{ kind: 'person', value: 'Bethany', known: true, listed: true }]))).toEqual(hit);
    // The words of a known full name are checked one by one, and found by the text as well.
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'Priya', [...found, { kind: 'person', value: 'Bethany', listed: true }]))).toEqual(hit);
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'Priya', [{ kind: 'person', value: 'Bethany', listed: true }, ...found]))).toEqual(hit);
    expect(checkLeaks(input('Bethany wrote.', [0, 7], 'Priya', [...found, { kind: 'person', value: 'Bethany', known: true, listed: true }]))).toEqual(hit);
  });

  it('C2: an address, host or id spelled inside a value the engine wrote is a hit as before', () => {
    expect(checkLeaks(input('see ashby-works.example now', [4, 23], 'lakeshore.example', [{ kind: 'domain', value: 'ashby-works.example' }]))).toEqual({ ok: false, hits: [{ kind: 'domain', textIndex: 0, offset: 4 }], unenforced: [] });
  });
});

describe('the leak check, on a name carried from an earlier turn', () => {
  const input = (output: string, originals: Original[]): LeakInput => ({
    outputs: [output], replaced: [[]], originals, deny: [], amountKeys: new Set<string>(), dateKeys: new Set<string>(), dateOrder: 'dmy',
  });
  const carried: Original[] = [{ kind: 'person', value: 'Will', cased: true }, { kind: 'org', value: 'Northwind', cased: true }];

  it('C21: a copy all in lower case is no hit, alone or inside a longer word', () => {
    expect(checkLeaks(input('it will work with a northwind over northwindlabs', carried))).toEqual({ ok: true, hits: [], unenforced: [] });
  });

  it('C21: a copy with a capital anywhere in it is a hit', () => {
    expect(checkLeaks(input('Will, WILL and wilL met NorthWind.', carried)).hits).toEqual([
      { kind: 'person', textIndex: 0, offset: 0 }, { kind: 'person', textIndex: 0, offset: 6 }, { kind: 'person', textIndex: 0, offset: 15 }, { kind: 'org', textIndex: 0, offset: 24 },
    ]);
  });

  it('C21: the same name found in the call counts in lower case too, and each copy is one hit', () => {
    const both: Original[] = [...carried, { kind: 'person', value: 'Will' }];
    expect(checkLeaks(input('Will and will met.', both)).hits).toEqual([{ kind: 'person', textIndex: 0, offset: 0 }, { kind: 'person', textIndex: 0, offset: 9 }]);
    expect(checkLeaks(input('Will and will met.', [...both].reverse())).hits).toEqual([{ kind: 'person', textIndex: 0, offset: 0 }, { kind: 'person', textIndex: 0, offset: 9 }]);
  });

  it('C21: a two-letter name carried and found in the call is one hit with a capital and none in lower case', () => {
    const mo: Original[] = [{ kind: 'person', value: 'Mo', cased: true }, { kind: 'person', value: 'Mo' }];
    expect(checkLeaks(input('Mo and mo', mo)).hits).toEqual([{ kind: 'person', textIndex: 0, offset: 0 }]);
    expect(checkLeaks(input('Mo and mo', [...mo].reverse())).hits).toEqual([{ kind: 'person', textIndex: 0, offset: 0 }]);
  });

  it('C21: a name in a script without letter case is a hit as written', () => {
    expect(checkLeaks(input('שלום דוד', [{ kind: 'person', value: 'דוד', cased: true }])).hits).toEqual([{ kind: 'person', textIndex: 0, offset: 5 }]);
  });
});

describe('a pair blind wrote and cannot look for again', () => {
  const NAME: KnownValue[] = [{ kind: 'person', value: 'Dana J. Mercer' }];
  const SRC = 'Dana J. Mercer signed the lease.';
  /** A caller's detector that marks `value` wherever it stands. */
  const marks = (value: string, kind: 'person' | 'id'): Detector => ({ name: 'marks', detect: (text) => {
    const at = text.indexOf(value);
    return at < 0 ? [] : [{ start: at, end: at + value.length, kind }];
  } });

  it.each(['fake', 'random'] as const)('C21: a name given with an initial leaves a one-letter pair in %s mode, and the next turn takes the mapping', (replaceWith) => {
    const first = blind([SRC], { seed: 'initial', now: NOW, replaceWith, known: NAME });
    expect(first.mapping.pairs.map((p) => p.real)).toContain('J');
    const next = later(['The lease starts in June. Dana Mercer has the keys.'], first.mapping);
    expect(next.leaks.ok).toBe(true);
    expect(next.texts[0]).not.toMatch(/Dana|Mercer/);
    expect(next.texts[0]).toContain('The lease starts in June.');
    expect(next.mapping.pairs).toEqual(first.mapping.pairs);
    expect(restored(next.texts, next.mapping)).toEqual(['The lease starts in June. Dana Mercer has the keys.']);
  });

  it('C21: the initial is not looked for alone in a later turn, and is replaced again with the name in known', () => {
    const first = blind([SRC], { seed: 'initial', now: NOW, known: NAME });
    const alone = later(['Plan J is ready.'], first.mapping);
    expect(alone.texts).toEqual(['Plan J is ready.']);
    expect(alone.leaks.ok).toBe(true);
    const again = later([SRC], first.mapping, NAME);
    expect(again.texts).toEqual(first.texts);
    expect(again.mapping.pairs).toEqual(first.mapping.pairs);
    expect(restored(again.texts, again.mapping)).toEqual([SRC]);
  });

  it.each([
    ['one letter', 'Q', 'person', 'placeholder'],
    ['an id with no ASCII letter or digit', '※※※', 'id', 'placeholder'],
    ['an id with no ASCII letter or digit', '※※※', 'id', 'random'],
  ] as const)("C21: %s a caller's detector marked is kept in the mapping and the next turn takes it (%s as %s, %s mode)", (_what, value, kind, replaceWith) => {
    const src = `Ref ${value} is ready.`;
    const first = blind([src], { seed: 'marked', now: NOW, replaceWith, detectors: [marks(value, kind)] });
    expect(first.mapping.pairs.map((p) => p.real)).toEqual([value]);
    const next = later(['Another text.'], first.mapping);
    expect(next.texts).toEqual(['Another text.']);
    expect(next.mapping.pairs).toEqual(first.mapping.pairs);
    expect(restored(first.texts, next.mapping)).toEqual([src]);
  });
});

describe('a word that joins a name', () => {
  const HEADER = '"Anna from Harborview" <anna@harborview-mail.example>';
  const BODY = 'A note from the office: it came from Leeds.';

  it.each(['fake', 'placeholder', 'random'] as const)('C2: the lower-case word between two capitalised words of a name is no hit where another text of the call writes it (%s mode)', (replaceWith) => {
    const out = blind([HEADER, BODY], { seed: 'joining', now: NOW, replaceWith });
    expect(out.texts[0]).not.toMatch(/Anna|Harborview/);
    expect(out.texts[1]).toBe(BODY);
    expect(out.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(restored(out.texts, out.mapping)).toEqual([HEADER, BODY]);
  });

  it('C2: nor is it one for a name given in known, or for a name from an earlier turn', () => {
    const listed = blind([`Anna from Harborview wrote. ${BODY}`], { seed: 'joining', now: NOW, known: [{ kind: 'person', value: 'Anna from Harborview' }] });
    expect(listed.texts[0]).toContain(BODY);
    expect(listed.leaks.ok).toBe(true);
    const first = blind([HEADER], { seed: 'joining', now: NOW, replaceWith: 'placeholder' });
    const next = later([`From Anna: ${BODY}`], first.mapping);
    expect(next.texts[0]).toContain(BODY);
    expect(next.texts[0]).not.toContain('Anna');
    expect(next.leaks.ok).toBe(true);
  });

  it('C2: the other words of that name are still hits where a text leaves them in lower case', () => {
    const body = 'thanks anna, greetings from harborview';
    const out = blind([HEADER, body], { seed: 'joining', now: NOW });
    expect(out.texts[1]).toBe(body);
    expect(out.leaks.hits).toEqual([
      { kind: 'person', textIndex: 1, offset: body.indexOf('anna') },
      { kind: 'person', textIndex: 1, offset: body.indexOf('harborview') },
    ]);
  });

  it.each([
    ['all in lower case', '"dana mercer" <dm@harbor-mail.example>', 'thanks dana, said mercer.', 2],
    ['with a lower-case last word', '"Dana mercer" <dm@harbor-mail.example>', 'so said mercer.', 1],
    ['with a lower-case first word', '"dana Mercer" <dm@harbor-mail.example>', 'thanks dana.', 1],
    ['with a capitalised middle word', '"Dana Quill Mercer" <dm@harbor-mail.example>', 'so said quill.', 1],
  ] as const)('C2: a name written %s keeps its words: a lower-case copy in another text is a hit', (_how, header, body, hits) => {
    const out = blind([header, body], { seed: 'joining', now: NOW });
    expect(out.leaks.ok).toBe(false);
    expect(out.leaks.hits.filter((h) => h.textIndex === 1)).toHaveLength(hits);
  });
});
