import { describe, expect, it } from 'vitest';
import { assertNoLeaks, blind, BlindError, LeakError, unblind, type Kind, type KnownValue } from '../src/index.js';
import { checkLeaks } from '../src/leaks.js';

const NOW = new Date('2026-06-01T00:00:00Z');

const leakInput = (outputs: string[], originals: Array<{ kind: Kind; value: string; known?: boolean }>) => ({
  outputs, replaced: outputs.map(() => []), originals, deny: [], amountKeys: new Set<string>(), dateKeys: new Set<string>(), dateOrder: 'dmy' as const,
});

describe('known values in scripts without word spaces', () => {
  const known: KnownValue[] = [{ kind: 'person', value: '王伟' }, { kind: 'org', value: '华星科技' }];

  it('C40: a Chinese name and company glued to the text around them are replaced and round trip', () => {
    const src = '王伟在华星科技工作。华星科技的客户也认识王伟。';
    const res = blind([src], { known, seed: 'cjk', now: NOW });
    const out = res.texts[0]!;
    expect(out).not.toContain('王伟');
    expect(out).not.toContain('华星科技');
    expect(res.leaks.ok).toBe(true);
    expect(() => assertNoLeaks(res)).not.toThrow();
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a space-separated and a glued copy are both replaced', () => {
    const res = blind(['我们和 华星科技 合作，华星科技很好。'], { known, seed: 'cjk2', now: NOW });
    expect(res.texts[0]).not.toContain('华星科技');
  });

  it('C40: a Japanese name glued to its honorific is replaced', () => {
    const res = blind(['田中さんは来週来ます。'], { known: [{ kind: 'person', value: '田中' }], seed: 'ja', now: NOW });
    expect(res.texts[0]).not.toContain('田中');
    expect(res.texts[0]).toContain('さんは来週来ます。');
  });

  it('C40: one Chinese character given alone is matched as a substring', () => {
    const res = blind(['我在华工作。'], { known: [{ kind: 'place', value: '华' }], seed: 'one', now: NOW });
    expect(res.texts[0]).not.toContain('华');
  });

  for (const kind of ['person', 'org', 'place', 'domain'] as const) {
    it(`C40: one Chinese character given alone as a ${kind} is replaced at every occurrence, leak check clean, and round trips`, () => {
      const src = '我在华工作。华又来了。';
      for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
        const res = blind([src], { known: [{ kind, value: '华' }], seed: `one-${kind}`, now: NOW, replaceWith });
        const out = res.texts[0]!;
        expect(out, replaceWith).not.toContain('华');
        expect(out.startsWith('我在'), replaceWith).toBe(true);
        expect(out.endsWith('又来了。'), replaceWith).toBe(true);
        expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
        expect(unblind(out, res.mapping).text).toBe(src);
      }
    });
  }

  it('C40: a known name of two one-character words of a script without word spaces has both replaced, and its part left bare is reported once', () => {
    const src = '李 华来了。华也来了。';
    const res = blind([src], { known: [{ kind: 'person', value: '李 华' }], seed: 'one-two', now: NOW });
    const out = res.texts[0]!;
    expect(out).not.toContain('李');
    expect(out.endsWith('来了。华也来了。')).toBe(true);
    // A one-character part is not looked for bare, so the leak check holds it back.
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: out.indexOf('华') }], unenforced: [] });
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a Latin initial in a known name gets a fake with the rest of the name, and round trips', () => {
    const src = 'J. Orvane wrote.';
    const res = blind([src], { known: [{ kind: 'person', value: 'J. Orvane' }], seed: 'initial', now: NOW });
    expect(res.texts[0]).toMatch(/^\p{Lu}\p{Ll}+\. \p{Lu}\p{Ll}+ wrote\.$/u);
    expect(res.texts[0]).not.toMatch(/\bJ\b|Orvane/);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'one-letter-part' }] });
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
  });

  for (const kind of ['email', 'id'] as const) {
    it(`C40: one Chinese character given alone as an ${kind} makes blind throw invalid-known with its index and kind, never its value`, () => {
      let err: unknown;
      try {
        blind(['我在华工作。'], { known: [{ kind: 'org', value: '华星科技' }, { kind, value: '华' }], seed: 'one-refused', now: NOW });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(BlindError);
      expect((err as BlindError).kind).toBe('invalid-known');
      expect((err as BlindError).message).toBe(`blind: known entry 1 (${kind}) is one character, which has no ${kind} fake; give at least two characters`);
      expect((err as BlindError).message).not.toContain('华');
    });
  }

  it('C40: a one-character known value that survived is reported once per occurrence, also when the text found it too', () => {
    const report = checkLeaks(leakInput(['我在华工作。华又来了。'], [
      { kind: 'person', value: '华' },
      { kind: 'person', value: '华', known: true },
      { kind: 'place', value: '华', known: true },
    ]));
    expect(report).toEqual({ ok: false, hits: [
      { kind: 'person', textIndex: 0, offset: 2 },
      { kind: 'person', textIndex: 0, offset: 6 },
      { kind: 'place', textIndex: 0, offset: 2 },
      { kind: 'place', textIndex: 0, offset: 6 },
    ], unenforced: [] });
    expect(JSON.stringify(report)).not.toContain('华');
  });

  it('C40: a known id that survived and was also found in the text is reported once per occurrence', () => {
    const report = checkLeaks(leakInput(['ref 4417-2290 and 44172290'], [
      { kind: 'id', value: '44172290' },
      { kind: 'id', value: '4417-2290', known: true },
    ]));
    expect(report.hits).toEqual([
      { kind: 'id', textIndex: 0, offset: 4 },
      { kind: 'id', textIndex: 0, offset: 18 },
    ]);
  });

  it('C40: the leak check reports a glued Chinese value that survived, by kind and offset only', () => {
    const report = checkLeaks(leakInput(['他在华星科技工作，王伟说。'], [{ kind: 'org', value: '华星科技' }, { kind: 'person', value: '王伟' }]));
    expect(report.ok).toBe(false);
    expect(report.hits).toEqual([
      { kind: 'org', textIndex: 0, offset: 2 },
      { kind: 'person', textIndex: 0, offset: 9 },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/华|王/);
  });

  it('C40: a Latin value still needs a word edge', () => {
    const report = checkLeaks(leakInput(['Contosofoods'], [{ kind: 'person', value: 'Contoso' }]));
    expect(report.ok).toBe(true);
  });
});

describe('known values in Korean', () => {
  const minsu: KnownValue[] = [{ kind: 'person', value: '김민수' }];
  const run = (src: string, known: KnownValue[], seed: string) => {
    const res = blind([src], { known, seed, now: NOW });
    return { res, out: res.texts[0]!, back: unblind(res.texts[0]!, res.mapping).text };
  };

  it('C40: a known Korean name glued to the word after it is replaced, the particle kept, and round trips', () => {
    for (const [src, rest] of [['김민수회사', '회사'], ['김민수는 회사에서 일한다', '는 회사에서 일한다'], ['김민수.', '.']] as const) {
      const { res, out, back } = run(src, minsu, 'ko');
      expect(out).not.toContain('김민수');
      expect(out.endsWith(rest), out).toBe(true);
      expect(out.length).toBeGreaterThan(rest.length);
      expect(res.leaks.ok).toBe(true);
      expect(back).toBe(src);
    }
  });

  it('C40: a known Korean name of three syllables is replaced inside a longer word and round trips', () => {
    const src = '우리팀김민수님이 왔다.';
    const { out, back } = run(src, minsu, 'ko3');
    expect(out).not.toContain('김민수');
    expect(out.startsWith('우리팀')).toBe(true);
    expect(out.endsWith('님이 왔다.')).toBe(true);
    expect(back).toBe(src);
  });

  it('C40: a known Korean name of two syllables needs a word start, so an unrelated word containing it stays', () => {
    const known: KnownValue[] = [{ kind: 'person', value: '지원' }];
    const kept = run('고객지원팀에 연락했다.', known, 'ko2');
    expect(kept.out).toBe('고객지원팀에 연락했다.');
    expect(kept.res.leaks.ok).toBe(true);
    const src = '지원은 내일 온다. 고객지원팀도 안다.';
    const { out, back } = run(src, known, 'ko2');
    expect(out.startsWith('지원')).toBe(false);
    expect(out).toContain('고객지원팀도 안다.');
    expect(back).toBe(src);
  });

  const hangulInside = { kind: 'person', index: 0, reason: 'hangul-inside-word' } as const;
  const noHangul = (res: ReturnType<typeof blind>) => {
    expect(JSON.stringify(res.leaks)).not.toMatch(/\p{scx=Hangul}/u);
    expect(new LeakError(res.leaks).message).not.toMatch(/\p{scx=Hangul}/u);
  };

  it('C40: a known two-syllable Korean value inside a longer word stays and the entry is listed once as hangul-inside-word', () => {
    const res = blind(['우리팀지원님이 왔다.'], { seed: 's', known: [{ kind: 'person', value: '지원' }] });
    expect(res.texts).toEqual(['우리팀지원님이 왔다.']);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [hangulInside] });
    expect(() => assertNoLeaks(res)).not.toThrow();
    noHangul(res);
  });

  it('C40: a known three-syllable Korean value inside a longer word is replaced and the entry is not listed', () => {
    const res = blind(['우리팀김민수님이 왔다.'], { seed: 's', known: [{ kind: 'person', value: '김민수' }] });
    expect(res.texts[0]).not.toContain('김민수');
    expect(res.texts[0]!.startsWith('우리팀')).toBe(true);
    expect(res.texts[0]!.endsWith('님이 왔다.')).toBe(true);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(unblind(res.texts[0]!, res.mapping).text).toBe('우리팀김민수님이 왔다.');
  });

  it('C40: a known two-syllable Korean value is replaced where a word starts, kept inside a word, and listed once as hangul-inside-word', () => {
    const src = '지원님이 왔다. 우리팀지원님도.';
    const res = blind([src], { seed: 's', known: [{ kind: 'person', value: '지원' }] });
    const out = res.texts[0]!;
    expect(out.startsWith('지원')).toBe(false);
    expect(out).toMatch(/^\P{scx=Hangul}+님이 왔다\. 우리팀지원님도\.$/u);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [hangulInside] });
    expect(unblind(out, res.mapping).text).toBe(src);
    noHangul(res);
  });

  it('C40: a two-syllable Korean entry is listed as hangul-inside-word whether or not the text writes it, and LeakError names it by index and kind only', () => {
    const known: KnownValue[] = [{ kind: 'person', value: '김민수' }, { kind: 'org', value: '한빛' }];
    expect(blind(['Nothing here.'], { seed: 's', known }).leaks.unenforced).toEqual([{ kind: 'org', index: 1, reason: 'hangul-inside-word' }]);
    const report = { ok: false, hits: [{ kind: 'person' as const, textIndex: 0, offset: 0 }], unenforced: [{ kind: 'org' as const, index: 1, reason: 'hangul-inside-word' as const }] };
    expect(() => assertNoLeaks({ leaks: report })).toThrow('blind: 1 leak(s) in text 0 (kinds: person); two-syllable Korean known entries enforced only where a word starts: 1 (org)');
  });

  it('C40: Korean is compared by whole syllables, not by first jamo', () => {
    const src = '강민지는 회사에 있다.';
    expect(run(src, minsu, 'ko4').out).toBe(src);
    expect(checkLeaks(leakInput([src], [{ kind: 'person', value: '김민수' }])).ok).toBe(true);
  });

  it('C40: a known Korean name written as separate jamo is still replaced', () => {
    const src = '김민수는 왔다.'.normalize('NFD');
    const { out, back } = run(src, minsu, 'ko5');
    expect(out.normalize('NFC')).not.toContain('김민수');
    expect(out.endsWith('는 왔다.'.normalize('NFD'))).toBe(true);
    expect(back).toBe(src);
  });

  it('C40: the leak check reports a surviving Korean name with a particle or inside a word, by kind and offset only', () => {
    const report = checkLeaks(leakInput(['김민수는 왔다. 우리팀김민수님. 지원은 고객지원팀'], [{ kind: 'person', value: '김민수', known: true }, { kind: 'person', value: '지원', known: true }]));
    expect(report.hits).toEqual([
      { kind: 'person', textIndex: 0, offset: 0 },
      { kind: 'person', textIndex: 0, offset: 12 },
      { kind: 'person', textIndex: 0, offset: 18 },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/\p{scx=Hangul}/u);
  });

  it('C40: a known Korean value of one syllable is refused with its index and kind', () => {
    expect(() => blind(['김은 왔다.'], { known: [{ kind: 'person', value: '김민수' }, { kind: 'person', value: '김' }], now: NOW }))
      .toThrow(/known entry 1 \(person\) is too short/);
    try {
      blind(['김은 왔다.'], { known: [{ kind: 'person', value: '김' }], now: NOW });
    } catch (e) {
      expect(String(e)).not.toContain('김');
    }
  });
});

describe('two-letter parts of a known full name', () => {
  it('C40: "Li" and "Na" of a known "Li Na" are found bare later in the text, with the fakes of the full name', () => {
    const src = 'Li Na spoke. Li agreed. Na left.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Li Na' }], seed: 'lina', now: NOW });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/\bLi\b|\bNa\b/);
    const [first, last] = out.slice(0, out.indexOf(' spoke')).split(' ');
    expect(out).toBe(`${first} ${last} spoke. ${first} agreed. ${last} left.`);
    expect(res.leaks.ok).toBe(true);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a particle the full name writes in lower case is not matched bare', () => {
    const src = 'Ana de la Cruz spoke. De nada. La reunión es mañana.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Ana de la Cruz' }], seed: 'stop', now: NOW });
    expect(res.texts[0]).toContain(' spoke. De nada. La reunión es mañana.');
    expect(res.leaks.ok).toBe(true);
  });

  it('C40: a bare capitalised part is replaced even where the full name is written in lower case', () => {
    for (const [value, src] of [
      ['Mo Li', 'Mo said. mo li.'],
      ['Li Na', 'Li said. li na.'],
      ['Mo Li', 'Mo said yes. Then mo li left. MO called.'],
    ] as const) {
      const res = blind([src], { known: [{ kind: 'person', value }], seed: 'lower-full', now: NOW });
      const out = res.texts[0]!;
      const part = value.split(' ')[0]!;
      expect(out).not.toMatch(new RegExp(`\\b${part}\\b`, 'i'));
      expect(res.leaks.ok).toBe(true);
      expect(unblind(out, res.mapping).text).toBe(src);
    }
  });

  it('C40: a part the text also writes in lower case is replaced as written and in lower case, with the fake of the full name', () => {
    const src = 'Wu Li spoke. Li agreed. The li is a unit.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Wu Li' }], seed: 'lower', now: NOW });
    const out = res.texts[0]!;
    const last = out.slice(0, out.indexOf(' spoke')).split(' ')[1]!;
    expect(out).toMatch(new RegExp(`^\\S+ ${last} spoke\\. ${last} agreed\\. The ${last.toLowerCase()} is a unit\\.$`));
    expect(out).not.toMatch(/\bli\b/i);
    expect(res.leaks.ok).toBe(true);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: lower-case "li" and "na" of a known "Li Na" are replaced with the fakes of the full name, and round trip', () => {
    const src = 'Li Na met li and na.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Li Na' }], seed: 'lina-lower', now: NOW });
    const out = res.texts[0]!;
    const [first, last] = out.slice(0, out.indexOf(' met')).split(' ') as [string, string];
    expect(out).toBe(`${first} ${last} met ${first.toLowerCase()} and ${last.toLowerCase()}.`);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a lower-case two-letter part is replaced where the text\'s language does not write it as a word, and stays where it does', () => {
    const value = 'Al Brenner';
    const en = 'Al Brenner said it was fine, and then al left the room.';
    const enRes = blind([en], { known: [{ kind: 'person', value }], seed: 'al-lower-en', now: NOW });
    expect(enRes.texts[0]).not.toMatch(/\bal\b/i);
    expect(enRes.leaks.ok).toBe(true);
    expect(unblind(enRes.texts[0]!, enRes.mapping).text).toBe(en);
    const es = 'Fue al banco.';
    const esRes = blind([es], { known: [{ kind: 'person', value }], seed: 'al-lower-es', now: NOW });
    expect(esRes.texts[0]).toBe(es);
    expect(esRes.leaks.ok).toBe(true);
  });

  it('C40: the leak check reports a lower-case part unless it is a stop word in the language there, by kind and offset only', () => {
    const li = [{ kind: 'person' as const, value: 'Li', lowerCase: true }];
    expect(checkLeaks({ ...leakInput(['Then li left.'], []), originals: li }).hits).toEqual([{ kind: 'person', textIndex: 0, offset: 5 }]);
    const al = [{ kind: 'person' as const, value: 'Al', known: true, lowerCase: true }];
    expect(checkLeaks({ ...leakInput(['Fue al banco con ella.'], []), originals: al }).ok).toBe(true);
    const report = checkLeaks({ ...leakInput(['It was al, and the rest of them.'], []), originals: al });
    expect(report.hits).toEqual([{ kind: 'person', textIndex: 0, offset: 7 }]);
    expect(JSON.stringify(report)).not.toMatch(/\bal\b/i);
  });

  it('C40: blind reports a lower-case part that survived, by kind and offset only', () => {
    const keep = { name: 'keep', detect: (t: string) => { const i = t.indexOf(' li.'); return i < 0 ? [] : [{ start: i + 1, end: i + 3, kind: 'note' as unknown as 'person', priority: 99 }]; } };
    const res = blind(['Li Na met li.'], { known: [{ kind: 'person', value: 'Li Na' }], detectors: [keep], seed: 'kept-lower', now: NOW });
    expect(res.texts[0]!.endsWith(' met li.')).toBe(true);
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: res.texts[0]!.length - 3 }], unenforced: [] });
    expect(JSON.stringify(res.leaks)).not.toMatch(/li/i);
  });

  it('C40: a capitalised part that survived is reported by kind and offset, even where the text writes it in lower case', () => {
    const keep = { name: 'keep', detect: (t: string) => (t.startsWith('Mo') ? [{ start: 0, end: 2, kind: 'note' as unknown as 'person', priority: 99 }] : []) };
    const res = blind(['Mo said. mo li.'], { known: [{ kind: 'person', value: 'Mo Li' }], detectors: [keep], seed: 'kept-part', now: NOW });
    expect(res.texts[0]!.startsWith('Mo said. ')).toBe(true);
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 0 }], unenforced: [] });
    expect(JSON.stringify(res.leaks)).not.toMatch(/mo/i);
  });
});

describe('stop-word parts of a known full name', () => {
  for (const [value, part, src, kept] of [
    ['Al Brenner', 'Al', 'Al said yes. Trevor too. AL called. Fue al banco.', 'Fue al banco.'],
    ['Lo Wen', 'Lo', 'Lo said yes. LO called. Lo que dijo, lo dijo.', 'lo dijo.'],
    ['An Vo', 'An', 'An said yes. AN called. It was an apple.', 'It was an apple.'],
  ] as const) {
    it(`C40: "${part}" of a known "${value}" is replaced as written or in capitals, and the lower-case word stays`, () => {
      const res = blind([src], { known: [{ kind: 'person', value }], seed: `part-${part}`, now: NOW });
      const out = res.texts[0]!;
      expect(out).not.toMatch(new RegExp(`\\b(?:${part}|${part.toUpperCase()})\\b`));
      expect(out).toContain(kept);
      expect(res.leaks.ok).toBe(true);
      expect(unblind(out, res.mapping).text).toBe(src);
    });
  }

  it('C40: the leak check reports a stop-word part that survived as written or in capitals, by kind and offset only', () => {
    const keep = { name: 'keep', detect: (t: string) => [{ start: 0, end: 2, kind: 'note' as unknown as 'person', priority: 99 }, ...(t.includes('AN ') ? [{ start: t.indexOf('AN '), end: t.indexOf('AN ') + 2, kind: 'note' as unknown as 'person', priority: 99 }] : [])] };
    const src = 'An said yes. AN called. It was an apple.';
    const res = blind([src], { known: [{ kind: 'person', value: 'An Vo' }], detectors: [keep], seed: 'kept-an', now: NOW });
    expect(res.texts[0]).toBe(src);
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 0 }, { kind: 'person', textIndex: 0, offset: 13 }], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word-part' }] });
    expect(JSON.stringify(res.leaks)).not.toMatch(/an/i);
  });
});

describe('capitalised particles of a known full name', () => {
  for (const [value, src] of [
    ['Al Brenner', 'Al Brenner said yes.'],
    ['De Vries', 'Meet De Vries tomorrow. DE VRIES agreed.'],
  ] as const) {
    it(`C40: a known "${value}" becomes a whole fake of as many words, with no "${value.split(' ')[0]}", and round trips`, () => {
      const res = blind([src], { known: [{ kind: 'person', value }], seed: `particle-${value}`, now: NOW });
      const out = res.texts[0]!;
      const particle = value.split(' ')[0]!;
      expect(out).not.toMatch(new RegExp(`\\b${particle}\\b`, 'i'));
      const at = src.indexOf(value);
      expect(out.slice(at).split(' ').slice(0, 2).every((w) => /^\p{Lu}\p{Ll}+$/u.test(w))).toBe(true);
      expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word-part' }] });
      expect(unblind(out, res.mapping).text).toBe(src);
    });
  }

  it('C40: a particle the known name writes in lower case is kept in the fake', () => {
    const src = 'Ana de la Cruz spoke.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Ana de la Cruz' }], seed: 'particle-lower', now: NOW });
    expect(res.texts[0]).toMatch(/^\S+ de la \S+ spoke\.$/u);
    expect(res.leaks.ok).toBe(true);
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
  });
});

describe('short known values and stop words', () => {
  it('C40: a standalone two-letter known person is replaced wherever it stands as a whole word, and round trips', () => {
    const src = 'Al arrived. Then Al left with Alba.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Al' }], seed: 'al', now: NOW });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/\bAl\b/);
    expect(out).toContain('Alba');
    expect(res.leaks.ok).toBe(true);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a known person that is a stop word or particle overrides the stop list', () => {
    const src = 'La called. De wrote back.';
    const res = blind([src], { known: [{ kind: 'person', value: 'La' }, { kind: 'person', value: 'De' }], seed: 'stopword', now: NOW });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/\bLa\b|\bDe\b/);
    expect(out).toMatch(/^\p{Lu}\p{Ll}+ called\. \p{Lu}\p{Ll}+ wrote back\.$/u);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: the leak check enforces a known stop word as written or in capitals, by kind and offset only', () => {
    const report = checkLeaks({ ...leakInput(['Then Al, al and AL left.'], []), originals: [{ kind: 'person', value: 'Al', known: true }] });
    expect(report.hits).toEqual([
      { kind: 'person', textIndex: 0, offset: 5 },
      { kind: 'person', textIndex: 0, offset: 16 },
    ]);
    expect(checkLeaks(leakInput(['Then Al left.'], [{ kind: 'person', value: 'Al' }])).ok).toBe(true);
  });

  it('C40: a known stop word matches as written, so the Spanish word stays and the name is replaced', () => {
    const known: KnownValue[] = [{ kind: 'person', value: 'Al' }];
    const es = blind(['Fue al banco.'], { known, seed: 'al-es', now: NOW });
    expect(es.texts[0]).toBe('Fue al banco.');
    expect(es.leaks.ok).toBe(true);
    const src = 'Al arrived. Fue al banco.';
    const en = blind([src], { known, seed: 'al-en', now: NOW });
    expect(en.texts[0]).toMatch(/^\p{Lu}\p{Ll}+ arrived\. Fue al banco\.$/u);
    expect(en.leaks.ok).toBe(true);
    expect(unblind(en.texts[0]!, en.mapping).text).toBe(src);
  });

  it('C40: a known stop word written in capitals, as in a shouted line, is replaced', () => {
    const src = 'AL ARRIVED. FUE AL BANCO.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Al' }], seed: 'al-caps', now: NOW });
    expect(res.texts[0]).not.toMatch(/\bAL\b/);
    expect(res.leaks.ok).toBe(true);
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
  });

  it('C40: a known value that is not a stop word still matches in any case', () => {
    const res = blind(['Alba called. ALBA and alba agreed.'], { known: [{ kind: 'person', value: 'Alba' }], seed: 'alba', now: NOW });
    expect(res.texts[0]).not.toMatch(/alba/i);
    expect(res.leaks.ok).toBe(true);
  });

  it('C40: blind reports a known stop word that survived, by kind and offset only', () => {
    // A detector that claims the span under a kind blind writes no fake for keeps the known detector off it.
    const keep = { name: 'keep', detect: (t: string) => (t.startsWith('Al') ? [{ start: 0, end: 2, kind: 'note' as unknown as 'person', priority: 99 }] : []) };
    const res = blind(['Al arrived. Then Al left.'], { known: [{ kind: 'person', value: 'Al' }], detectors: [keep], seed: 'kept', now: NOW });
    const out = res.texts[0]!;
    expect(out.startsWith('Al arrived. Then ')).toBe(true);
    expect(out).not.toContain('Then Al');
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 0 }], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word' }] });
    expect(JSON.stringify(res.leaks)).not.toContain('Al');
    expect(() => assertNoLeaks(res)).toThrow();
  });

  it('C40: a fake for a value with no letter case is not written in capitals', () => {
    const res = blind(['王伟在华星科技工作'], { known: [{ kind: 'person', value: '王伟' }, { kind: 'org', value: '华星科技' }], seed: 'cjk', now: NOW });
    const out = res.texts[0]!;
    const words = out.split(/[在工作]+/).filter(Boolean);
    expect(words).toHaveLength(2);
    for (const w of words) expect(w).toMatch(/^\p{Lu}\p{Ll}/u);
  });
});

describe('known values the matcher cannot enforce', () => {
  const tooShort = (i: number, kind: string): string => `blind: known entry ${i} (${kind}) is too short to find or check; give at least two characters`;
  const empty = (i: number, kind: string): string => `blind: known entry ${i} (${kind}) is empty or only spaces; give the value to find`;
  const cases: Array<[string, KnownValue, (i: number, kind: string) => string]> = [
    ['one letter', { kind: 'person', value: 'Q' }, tooShort],
    ['empty', { kind: 'org', value: '' }, empty],
    ['whitespace only', { kind: 'place', value: ' \t ' }, empty],
    ['only a zero-width space', { kind: 'id', value: '\u200b' }, empty],
    ['one letter and a zero-width space', { kind: 'person', value: 'Q\u200b' }, tooShort],
    ['a phone with one digit', { kind: 'phone', value: '+7' }, tooShort],
  ];
  for (const [name, entry, message] of cases) {
    it(`C40: ${name} makes blind throw with the entry's index and kind, never its value`, () => {
      const known: KnownValue[] = [{ kind: 'org', value: 'Contoso' }, entry];
      let err: Error | undefined;
      try {
        blind(['Q arrived at Contoso. +7'], { known, seed: 'short', now: NOW });
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeInstanceOf(BlindError);
      expect((err as BlindError).kind).toBe('invalid-known');
      expect(err?.message).toBe(message(1, entry.kind));
      if (entry.value.trim()) expect(err?.message).not.toContain(entry.value.trim());
    });
  }

  const thrown = (known: unknown[]): BlindError => {
    // A detector that throws shows whether detection ran before the entry was refused.
    const ran = { name: 'ran', detect: (): never => { throw new BlindError('internal', 'detection ran'); } };
    try {
      blind(['Orvane Kelpstrom paid Kelpstrom Works. 42'], { known: known as KnownValue[], detectors: [ran], seed: 'kinds', now: NOW });
    } catch (e) {
      return e as BlindError;
    }
    throw new Error('blind did not throw');
  };

  for (const kind of ['Person', 'nope', 'name', '', 'person ', 42, null] as unknown[]) {
    it(`C40: a known entry of kind ${JSON.stringify(kind)} is refused with its index before detection runs, and the kind is not echoed`, () => {
      const err = thrown([{ kind: 'org', value: 'Kelpstrom Works' }, { kind, value: 'Orvane Kelpstrom' }]);
      expect(err).toBeInstanceOf(BlindError);
      expect(err.kind).toBe('invalid-known');
      expect(err.message).toBe('blind: known entry 1 has a kind blind does not know; use one of person, org, email, domain, phone, place, id');
      expect(err.message).not.toContain('Orvane');
      if (typeof kind === 'string' && kind.trim()) expect(err.message).not.toContain(kind);
    });
  }

  it('C40: a known entry that is not an object is refused as having no kind', () => {
    const err = thrown([null]);
    expect(err.kind).toBe('invalid-known');
    expect(err.message).toBe('blind: known entry 0 has a kind blind does not know; use one of person, org, email, domain, phone, place, id');
  });

  for (const value of [42, null, undefined, ['Orvane'], { v: 'Orvane' }] as unknown[]) {
    it(`C40: a known value of type ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value} is refused as not a string, with its index and kind`, () => {
      const err = thrown([{ kind: 'person', value: 'Orvane Kelpstrom' }, { kind: 'id', value }]);
      expect(err.kind).toBe('invalid-known');
      expect(err.message).toBe('blind: known entry 1 (id) has a value that is not a string');
      expect(err.message).not.toMatch(/42|Orvane/);
    });
  }

  it('C40: LeakError names only the library\'s kinds, never a kind a report built by hand carries', () => {
    const err = new LeakError({ ok: false, hits: [
      { kind: 'Orvane Kelpstrom' as unknown as Kind, textIndex: 0, offset: 0 },
      { kind: 'toString' as unknown as Kind, textIndex: 0, offset: 3 },
      { kind: 'id', textIndex: 1, offset: 5 },
    ] });
    expect(err.message).toBe('blind: 3 leak(s) in text 0, 1 (kinds: other, id)');
    expect(err.message).not.toMatch(/Orvane|toString/);
  });

  it('C40: two characters are accepted', () => {
    const res = blind(['QX arrived.'], { known: [{ kind: 'id', value: 'QX' }], seed: 'two', now: NOW });
    expect(res.texts[0]).not.toContain('QX');
  });

  it('C40: the leak check reports a short known id or phone that survived, written as given or with separators, by kind and offset only', () => {
    const r = checkLeaks(leakInput(['QX', 'ref qx and Q-X, not QXY', 'call 4 2 or 42', '日本で'], [
      { kind: 'id', value: 'QX', known: true },
      { kind: 'phone', value: '4-2', known: true },
      { kind: 'id', value: '日本', known: true },
    ]));
    expect(r.hits).toEqual([
      { kind: 'id', textIndex: 0, offset: 0 },
      { kind: 'id', textIndex: 1, offset: 4 },
      { kind: 'id', textIndex: 1, offset: 11 },
      { kind: 'phone', textIndex: 2, offset: 5 },
      { kind: 'phone', textIndex: 2, offset: 12 },
      { kind: 'id', textIndex: 3, offset: 0 },
    ]);
    expect(JSON.stringify(r)).not.toMatch(/QX|日本/);
  });

  it('C40: a short id found by a detector, not given in known, is still not looked for', () => {
    expect(checkLeaks(leakInput(['QX7'], [{ kind: 'id', value: 'QX7' }])).ok).toBe(true);
  });

  it('C40: blind reports a short known id that survived, by kind and offset only', () => {
    // A detector that claims the span under a kind blind writes no fake for keeps the known detector off it.
    const keep = { name: 'keep', detect: (t: string) => (t.startsWith('QX') ? [{ start: 0, end: 2, kind: 'note' as unknown as 'id', priority: 99 }] : []) };
    const res = blind(['QX arrived. Then QX left.'], { known: [{ kind: 'id', value: 'QX' }], detectors: [keep], seed: 'kept', now: NOW });
    const out = res.texts[0]!;
    expect(out.startsWith('QX arrived. Then ')).toBe(true);
    expect(out).not.toContain('Then QX');
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'id', textIndex: 0, offset: 0 }], unenforced: [] });
    expect(() => assertNoLeaks(res)).toThrow(LeakError);
    expect(() => assertNoLeaks(res)).toThrow('blind: 1 leak(s) in text 0 (kinds: id)');
  });
});

describe('a name found again by its accent-free spelling', () => {
  it('C21: a bare later mention that differs only by accents or case is replaced, a case variant shares the fake, and both turns round trip', () => {
    const first = blind(['From: Belén Ortiz <belen@ortiz.example>\n\nHi Belen, BELÉN said yes.'], { seed: 'belen', now: NOW });
    const out = first.texts[0]!;
    expect(out).not.toMatch(/Bel[eé]n|BEL[EÉ]N/);
    const fake = /^From: (\S+) /.exec(out)![1]!;
    expect(out).toContain(`${fake.toUpperCase()} said yes.`);
    expect(first.leaks.ok).toBe(true);
    expect(unblind(out, first.mapping).text).toBe('From: Belén Ortiz <belen@ortiz.example>\n\nHi Belen, BELÉN said yes.');

    const next = blind(['Belen and BELÉN agreed.'], { seed: 'belen', now: NOW, mapping: first.mapping });
    expect(next.texts[0]).not.toMatch(/Bel[eé]n|BEL[EÉ]N/);
    expect(next.leaks.ok).toBe(true);
    expect(unblind(next.texts[0]!, next.mapping).text).toBe('Belen and BELÉN agreed.');
  });
});

describe('a known value no text has written yet', () => {
  const known: KnownValue[] = [{ kind: 'person', value: 'Rosalind Vexmoor' }, { kind: 'org', value: 'Vexmoor Holdings' }];
  const words = /rosalind|vexmoor|holdings/i;

  it('C21: gets no pair, so the mapping never holds it, and a later turn that writes it and passes known again replaces it and round trips', () => {
    const first = blind(['Hello from the caller, nothing private here.'], { known, seed: 'absent', now: NOW });
    expect(first.mapping.pairs).toEqual([]);
    expect(JSON.stringify(first.mapping)).not.toMatch(words);
    expect(first.texts[0]).toBe('Hello from the caller, nothing private here.');

    const src = 'Rosalind Vexmoor of Vexmoor Holdings called. Rosalind will write again.';
    const next = blind([src], { known, seed: 'absent', now: NOW, mapping: first.mapping });
    expect(next.texts[0]).not.toMatch(words);
    expect(next.leaks.ok).toBe(true);
    expect(next.mapping.pairs.map((p) => p.real)).toEqual(expect.arrayContaining(['Rosalind', 'Vexmoor']));
    expect(unblind(next.texts[0]!, next.mapping).text).toBe(src);

    // Without `known` on the later turn nothing marks the name: a turn only carries what an earlier one wrote.
    const bare = blind(['Rosalind called.'], { seed: 'absent', now: NOW, mapping: first.mapping });
    expect(bare.texts[0]).toBe('Rosalind called.');
  });

  it('C21: a known name written only inside an address keeps the pairs of the words it writes, so a reply naming the fake comes back', () => {
    const src = 'Write to rosalind.vexmoor@corp.example today.';
    const res = blind([src], { known: [{ kind: 'person', value: 'Rosalind Vexmoor' }], seed: 'local', now: NOW });
    expect(res.texts[0]).not.toMatch(words);
    const local = /([a-z]+)\.([a-z]+)@/.exec(res.texts[0]!)!;
    const reply = `${local[1]![0]!.toUpperCase()}${local[1]!.slice(1)} agreed.`;
    expect(unblind(reply, res.mapping).text).toBe('Rosalind agreed.');
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
  });
});

describe('known values the matcher or the fakes cannot take as given', () => {
  it('C3: a known value made only of stop words leaves its lower-case copy as an ordinary word, unreplaced and unreported', () => {
    const known: KnownValue[] = [{ kind: 'person', value: 'Al' }];
    const lower = blind(['al arrived.'], { known, seed: 's', now: NOW });
    expect(lower.texts[0]).toBe('al arrived.');
    expect(lower.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word' }] });
    for (const [src, shape] of [['Al arrived.', /^\p{Lu}\p{Ll}+ arrived\.$/u], ['AL arrived.', /^\p{Lu}{2,} arrived\.$/u]] as const) {
      const res = blind([src], { known, seed: 's', now: NOW });
      const out = res.texts[0]!;
      expect(out, src).toMatch(shape);
      expect(out, src).not.toMatch(/\bAl\b|\bAL\b/);
      expect(res.leaks, src).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word' }] });
      expect(unblind(out, res.mapping).text, src).toBe(src);
    }
  });

  const refused = (kind: 'id' | 'email', value: string): BlindError => {
    let err: unknown;
    try {
      blind(['联系 日本 公司'], { known: [{ kind: 'org', value: '华星科技' }, { kind, value }], seed: 's', now: NOW });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BlindError);
    expect((err as BlindError).kind).toBe('invalid-known');
    expect((err as BlindError).message).not.toContain(value);
    return err as BlindError;
  };

  it('C40: a known id with no ASCII letter or digit is refused with invalid-known, its index and kind, never its value', () => {
    for (const value of ['日本', 'Ä-', '１２']) {
      expect(refused('id', value).message, value).toBe('blind: known entry 1 (id) has no ASCII letter or digit, which an id fake needs; give it as another kind');
    }
    const res = blind(['联系 日1 公司'], { known: [{ kind: 'id', value: '日1' }], seed: 's', now: NOW });
    expect(res.texts[0]).not.toContain('日1');
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
  });

  it('C40: a known email without an @ that has text on both sides is refused with invalid-known, its index and kind, never its value', () => {
    for (const value of ['日本', 'ana@', '@orvane.example', 'ana @ orvane.example']) {
      expect(refused('email', value).message, value).toBe('blind: known entry 1 (email) has no @ with text on both sides, which an email fake needs; give the whole address');
    }
    const src = 'Write to ana@orvane.example today.';
    const res = blind([src], { known: [{ kind: 'email', value: 'ana@orvane.example' }], seed: 's', now: NOW });
    expect(res.texts[0]).not.toContain('ana@orvane.example');
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
  });

  for (const kind of ['org', 'place'] as const) {
    it(`C40: a known ${kind} of two Chinese characters is accepted, replaced, leak check clean, and round trips`, () => {
      const src = '联系 日本 公司';
      const res = blind([src], { known: [{ kind, value: '日本' }], seed: 's', now: NOW });
      const out = res.texts[0]!;
      expect(out).not.toContain('日本');
      expect(out.startsWith('联系 ')).toBe(true);
      expect(out.endsWith(' 公司')).toBe(true);
      expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
      expect(unblind(out, res.mapping).text).toBe(src);
    });
  }
});

describe('known entries the leak check enforces only as written or in capitals', () => {
  // No value of a known entry may appear in the report or in a message built from it.
  const noValue = (res: { leaks: unknown }, values: string[]): void => {
    const report = JSON.stringify(res.leaks);
    const message = new LeakError(res.leaks as ConstructorParameters<typeof LeakError>[0]).message;
    for (const v of values.flatMap((x) => [x, ...x.split(' ')])) {
      expect(report, v).not.toMatch(new RegExp(`\\b${v}\\b`, 'i'));
      expect(message, v).not.toMatch(new RegExp(`\\b${v}\\b`, 'i'));
    }
  };

  it('C40: a known "Al Brenner" in Spanish text is listed once as stop-word-part, the lower-case "al" stays, ok is true and the text round trips', () => {
    const src = 'Al Brenner vino. Hablé con al ayer.';
    const res = blind([src], { seed: 's', known: [{ kind: 'person', value: 'Al Brenner' }] });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/\bAl\b|Brenner/);
    expect(out.endsWith(' vino. Hablé con al ayer.')).toBe(true);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word-part' }] });
    expect(() => assertNoLeaks(res)).not.toThrow();
    noValue(res, ['Al Brenner']);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a known "An Lark" in English text is listed once as stop-word-part, the article "an" stays, ok is true and the text round trips', () => {
    const src = 'An Lark called. I saw an at noon.';
    const res = blind([src], { seed: 's', known: [{ kind: 'person', value: 'An Lark' }] });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/\bAn\b|Lark/);
    expect(out.endsWith(' called. I saw an at noon.')).toBe(true);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word-part' }] });
    expect(() => assertNoLeaks(res)).not.toThrow();
    noValue(res, ['An Lark']);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C3: a known "Al" is listed once as stop-word, its lower-case copy stays unreplaced without a hit, ok is true and the text round trips', () => {
    const src = 'al arrived.';
    const res = blind([src], { seed: 's', known: [{ kind: 'person', value: 'Al' }] });
    expect(res.texts[0]).toBe(src);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word' }] });
    expect(() => assertNoLeaks(res)).not.toThrow();
    noValue(res, ['Al']);
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
    // Listed whether or not the text writes the value at all.
    expect(blind(['Nothing here.'], { seed: 's', known: [{ kind: 'person', value: 'Al' }] }).leaks.unenforced).toEqual([{ kind: 'person', index: 0, reason: 'stop-word' }]);
  });

  it('C40: a Spanish paragraph full of "al" and "de" with a known "Al Brenner" keeps every word, has no hit and one unenforced entry, and round trips', () => {
    const src = 'Al Brenner llegó al despacho de la calle Mayor a las nueve. Después fue al banco de su barrio, pasó al mercado de abastos y al final volvió a casa de su hermana al anochecer. AL BRENNER no dijo nada más de aquel día.';
    const res = blind([src], { seed: 's', known: [{ kind: 'person', value: 'Al Brenner' }] });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/\bAl\b|\bAL\b|Brenner|BRENNER/);
    const count = (t: string, w: string): number => t.match(new RegExp(`\\b${w}\\b`, 'g'))?.length ?? 0;
    expect(count(out, 'al')).toBe(count(src, 'al'));
    expect(count(out, 'de')).toBe(count(src, 'de'));
    expect(count(src, 'al')).toBe(5);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [{ kind: 'person', index: 0, reason: 'stop-word-part' }] });
    expect(() => assertNoLeaks(res)).not.toThrow();
    noValue(res, ['Al Brenner']);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: names with no part on the stop list ("Li Na", "王伟") are not listed, and each entry is listed once by its own index', () => {
    const src = 'Li Na y 王伟 vinieron. Al Brenner también, y Al. Fue al banco.';
    const known: KnownValue[] = [
      { kind: 'person', value: 'Li Na' },
      { kind: 'person', value: 'Al Brenner' },
      { kind: 'person', value: '王伟' },
      { kind: 'person', value: 'Al' },
      { kind: 'person', value: 'Al Brenner' },
    ];
    const res = blind([src], { seed: 's', known });
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [
      { kind: 'person', index: 1, reason: 'stop-word-part' },
      { kind: 'person', index: 3, reason: 'stop-word' },
      { kind: 'person', index: 4, reason: 'stop-word-part' },
    ] });
    expect(res.texts[0]).toContain('Fue al banco.');
    noValue(res, ['Li Na', 'Al Brenner', '王伟']);
    expect(unblind(res.texts[0]!, res.mapping).text).toBe(src);
    expect(blind([src], { seed: 's', known: [known[0]!, known[2]!] }).leaks).toEqual({ ok: true, hits: [], unenforced: [] });
  });

  it('C40: with a hit as well, assertNoLeaks throws for the hit and its message names the unenforced entry by index and kind only', () => {
    const keep = { name: 'keep', detect: (t: string) => (t.startsWith('Al') ? [{ start: 0, end: 2, kind: 'note' as unknown as 'person', priority: 99 }] : []) };
    const res = blind(['Al vino. Hablé con al ayer.'], { known: [{ kind: 'org', value: 'Orvane' }, { kind: 'person', value: 'Al Brenner' }], detectors: [keep], seed: 'kept-al', now: NOW });
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 0 }], unenforced: [{ kind: 'person', index: 1, reason: 'stop-word-part' }] });
    expect(() => assertNoLeaks(res)).toThrow('blind: 1 leak(s) in text 0 (kinds: person); known entries with a stop-word part enforced only as written or in capitals: 1 (person)');
    noValue(res, ['Al Brenner', 'Orvane']);
  });

  it('C40: values carried from an earlier turn are not listed, only the entries of this call\'s known', () => {
    const first = blind(['Al Brenner vino.'], { seed: 's', known: [{ kind: 'person', value: 'Al Brenner' }] });
    const next = blind(['Al Brenner volvió al día siguiente.'], { mapping: first.mapping });
    expect(next.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(next.texts[0]).toContain(' al día siguiente.');
  });
});

describe('one-letter Latin parts of a known full name', () => {
  const one = (index: number) => ({ kind: 'person', index, reason: 'one-letter-part' });
  /** Neither the report nor the LeakError message names a word of `values`; a one-letter word is looked for as written. */
  const noWord = (res: { leaks: Parameters<typeof assertNoLeaks>[0]['leaks'] }, values: string[]): void => {
    const texts = [JSON.stringify(res.leaks), new LeakError(res.leaks).message];
    for (const v of values.flatMap((x) => x.split(' '))) {
      for (const t of texts) expect(t, v).not.toMatch(v.length === 1 ? new RegExp(`(?<!\\p{L})${v}(?!\\p{L})`, 'u') : new RegExp(`\\b${v}\\b`, 'i'));
    }
  };

  for (const [value, src, kept] of [
    ['O Li', 'O Li wrote and O said', ' wrote and '],
    ['J Smith', 'J Smith wrote. J again.', ' wrote. '],
  ] as const) {
    it(`C40: the one-letter part of a known "${value}" is replaced inside the name and bare, and the entry is listed as one-letter-part`, () => {
      const res = blind([src], { seed: 's', known: [{ kind: 'person', value }] });
      const out = res.texts[0]!;
      const [letter, rest] = value.split(' ') as [string, string];
      expect(out).not.toMatch(new RegExp(`(?<!\\p{L})${letter}(?!\\p{L})|${rest}`, 'u'));
      // Two fake words where the name was, the fake of the letter again where it stood bare.
      const words = out.split(kept);
      expect(words[0]).toMatch(/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+$/u);
      expect(words[1]!.startsWith(words[0]!.split(' ')[0]! + ' ')).toBe(true);
      expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [one(0)] });
      noWord(res, [value]);
      expect(unblind(out, res.mapping).text).toBe(src);
    });
  }

  it('C40: a bare one-letter part is replaced as written or in capitals, and its lower-case copy stays an ordinary word', () => {
    const src = 'O Li vino. O dijo que sí, o que no. O LI firmó.';
    const res = blind([src], { seed: 'caps', known: [{ kind: 'person', value: 'O Li' }] });
    const out = res.texts[0]!;
    expect(out).not.toMatch(/(?<!\p{L})O(?!\p{L})|\bLi\b|\bLI\b/u);
    expect(out).toContain(' dijo que sí, o que no. ');
    expect(out.endsWith(' firmó.')).toBe(true);
    expect(out.slice(out.lastIndexOf('. ') + 2, out.lastIndexOf(' firmó.'))).toMatch(/^\p{Lu}+ \p{Lu}+$/u);
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [one(0)] });
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C3/C40: the leak check reports a one-letter part that survived as written, by kind and offset only, and not its lower-case copy', () => {
    const keep = { name: 'keep', detect: (t: string) => [...t.matchAll(/(?<!\p{L})J(?![\p{L}.])/gu)].map((m) => ({ start: m.index, end: m.index + 1, kind: 'note' as unknown as 'person', priority: 99 })) };
    const src = 'J said yes. Then j and J agreed. J. Orvane left.';
    const res = blind([src], { known: [{ kind: 'person', value: 'J. Orvane' }], detectors: [keep], seed: 'kept-j', now: NOW });
    const out = res.texts[0]!;
    expect(out.startsWith('J said yes. Then j and J agreed. ')).toBe(true);
    expect(out).not.toContain('Orvane');
    expect(res.leaks).toEqual({ ok: false, hits: [{ kind: 'person', textIndex: 0, offset: 0 }, { kind: 'person', textIndex: 0, offset: 23 }], unenforced: [one(0)] });
    expect(() => assertNoLeaks(res)).toThrow('blind: 2 leak(s) in text 0 (kinds: person); known entries with a stop-word or one-letter part enforced only as written or in capitals: 0 (person)');
    noWord(res, ['J Orvane']);
  });

  it('C40: a Spanish paragraph full of "o" and "y" with a known "O Li" and "Y Vega" has no hits, passes assertNoLeaks and round trips', () => {
    const src = 'Y Vega y O Li escribieron. O vienes hoy o mañana, y luego vemos. Pan y vino o agua y sal. ' +
      'Y entonces O Li dijo que sí o que no, y Y Vega calló. ¿Uno o dos? Tres y cuatro.';
    const known: KnownValue[] = [{ kind: 'person', value: 'O Li' }, { kind: 'person', value: 'Y Vega' }];
    const res = blind([src], { seed: 'es', known });
    const out = res.texts[0]!;
    expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [one(0), one(1)] });
    expect(() => assertNoLeaks(res)).not.toThrow();
    const lower = (t: string, w: string) => (t.match(new RegExp(`(?<!\\p{L})${w}(?!\\p{L})`, 'gu')) ?? []).length;
    expect([lower(out, 'o'), lower(out, 'y')]).toEqual([lower(src, 'o'), lower(src, 'y')]);
    expect(out).not.toMatch(/(?<!\p{L})[OY](?!\p{L})|\bLi\b|\bVega\b/u);
    expect(out).toContain(' hoy o mañana, y luego vemos. Pan y vino o agua y sal. ');
    noWord(res, ['O Li', 'Y Vega']);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
    it(`C40: a known name with a one-letter part round trips in ${replaceWith} mode, with no copy of the letter or the name left`, () => {
      const src = 'O Li wrote to J. Orvane. O and J agreed, o sea, sí.';
      const res = blind([src], { seed: `mode-${replaceWith}`, replaceWith, known: [{ kind: 'person', value: 'O Li' }, { kind: 'person', value: 'J. Orvane' }] });
      const out = res.texts[0]!;
      expect(out).not.toMatch(/(?<!\p{L})[OJ](?!\p{L})|\bLi\b|Orvane/u);
      expect(out.endsWith(' agreed, o sea, sí.')).toBe(true);
      expect(res.leaks).toEqual({ ok: true, hits: [], unenforced: [one(0), one(1)] });
      expect(unblind(out, res.mapping).text).toBe(src);
    });
  }

  it('C40: a known value of one Latin letter is still refused with its index and kind, while a full name with a one-letter part is accepted', () => {
    let err: unknown;
    try {
      blind(['O wrote.'], { seed: 's', known: [{ kind: 'person', value: 'O Li' }, { kind: 'person', value: 'O' }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BlindError);
    expect((err as BlindError).kind).toBe('invalid-known');
    expect((err as Error).message).toBe('blind: known entry 1 (person) is too short to find or check; give at least two characters');
    expect(blind(['O Li wrote.'], { seed: 's', known: [{ kind: 'person', value: 'O Li' }] }).leaks.unenforced).toEqual([one(0)]);
  });
});

describe('known values in Cyrillic and Greek', () => {
  const clean = { ok: true, hits: [], unenforced: [] };
  /** The words of `value`, none of which may be left in `out`, matched without regard to case. */
  const survives = (out: string, value: string): boolean =>
    value.split(' ').some((w) => out.toLocaleLowerCase().split(/[^\p{L}]+/u).includes(w.toLocaleLowerCase()));

  const probes: Array<[string, KnownValue]> = [
    ['Сказал Иван Петров.', { kind: 'person', value: 'Иван Петров' }],
    ['Сказал Петров.', { kind: 'person', value: 'Петров' }],
    ['Счёт от Газпромбанк.', { kind: 'org', value: 'Газпромбанк' }],
    ['Είπε ο Γιάννης Παπαδόπουλος.', { kind: 'person', value: 'Γιάννης Παπαδόπουλος' }],
    ['Ли На пришла.', { kind: 'person', value: 'Ли На' }],
    ['אמר דוד כהן.', { kind: 'person', value: 'דוד כהן' }],
    ['राम शर्मा ने कहा।', { kind: 'person', value: 'राम शर्मा' }],
  ];

  it('C40: a known value in Cyrillic or Greek is replaced like one in Hebrew or Devanagari, with a clean leak report', () => {
    for (const [src, k] of probes) {
      const res = blind([src], { seed: 's', known: [k], now: NOW });
      const out = res.texts[0]!;
      expect(survives(out, k.value)).toBe(false);
      expect(res.leaks).toEqual(clean);
      expect(() => assertNoLeaks(res)).not.toThrow();
      expect(unblind(out, res.mapping).text).toBe(src);
    }
  });

  it('C40: every word of a known Cyrillic name is replaced in full and bare, with the fakes of the full name', () => {
    const src = 'Иван Петров звонил. Иван ответил, Петров нет.';
    const res = blind([src], { seed: 'cyr-parts', known: [{ kind: 'person', value: 'Иван Петров' }], now: NOW });
    const out = res.texts[0]!;
    expect(survives(out, 'Иван Петров')).toBe(false);
    const [first, last] = out.slice(0, out.indexOf(' звонил')).split(' ');
    expect(out).toBe(`${first} ${last} звонил. ${first} ответил, ${last} нет.`);
    expect(res.leaks).toEqual(clean);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a known Cyrillic name written in capitals is replaced with the fakes of the name as given', () => {
    const src = 'ИВАН ПЕТРОВ звонил. Иван ответил, Петров нет.';
    const res = blind([src], { seed: 'cyr-caps', known: [{ kind: 'person', value: 'Иван Петров' }], now: NOW });
    const out = res.texts[0]!;
    expect(survives(out, 'Иван Петров')).toBe(false);
    const [first, last] = out.slice(0, out.indexOf(' звонил')).split(' ');
    expect(first).toBe(first!.toUpperCase());
    const title = (w: string): string => w[0]! + w.slice(1).toLowerCase();
    expect(out).toBe(`${first} ${last} звонил. ${title(first!)} ответил, ${title(last!)} нет.`);
    expect(res.leaks).toEqual(clean);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a known Greek name in capitals and a Greek org are replaced, and the final sigma counts as sigma', () => {
    const src = 'ΓΙΆΝΝΗΣ ΠΑΠΑΔΌΠΟΥΛΟΣ έγραψε στην Αλφαβητική Τράπεζα. Η ΑΛΦΑΒΗΤΙΚΉ ΤΡΆΠΕΖΑ απάντησε στον Γιάννη Παπαδόπουλος.';
    const known: KnownValue[] = [{ kind: 'person', value: 'Γιάννης Παπαδόπουλος' }, { kind: 'org', value: 'Αλφαβητική Τράπεζα' }];
    const res = blind([src], { seed: 'el', known, now: NOW });
    const out = res.texts[0]!;
    expect(survives(out, 'Γιάννης Παπαδόπουλος Αλφαβητική Τράπεζα')).toBe(false);
    expect(res.leaks).toEqual(clean);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: Cyrillic and Greek known values round trip in fake, placeholder and random modes', () => {
    const src = 'Иван Петров из Газпромбанк писал Γιάννης Παπαδόπουλος. ИВАН ответил, Петров нет.';
    const known: KnownValue[] = [
      { kind: 'person', value: 'Иван Петров' }, { kind: 'org', value: 'Газпромбанк' }, { kind: 'person', value: 'Γιάννης Παπαδόπουλος' },
    ];
    for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
      const res = blind([src], { seed: 'rt', known, replaceWith, now: NOW });
      const out = res.texts[0]!;
      expect(survives(out, 'Иван Петров Газпромбанк Γιάννης Παπαδόπουλος')).toBe(false);
      expect(res.leaks).toEqual(clean);
      expect(unblind(out, res.mapping).text).toBe(src);
    }
  });

  it('C40: a Latin known value written with Cyrillic or Greek look-alike letters is still found, as in C1/P17', () => {
    // Every letter with a look-alike swapped: Cyrillic M, а, е, о, Т, р and a Greek nu for v.
    const src = 'Signed by Маrcо Теrаlis and νiсtоr.';
    const known: KnownValue[] = [{ kind: 'person', value: 'Marco Teralis' }, { kind: 'person', value: 'Victor' }];
    const res = blind([src], { seed: 'p17', known, now: NOW });
    const out = res.texts[0]!;
    expect(out.startsWith('Signed by ')).toBe(true);
    expect(survives(foldForTest(out), 'Marco Teralis Victor')).toBe(false);
    expect(res.leaks).toEqual(clean);
    expect(unblind(out, res.mapping).text).toBe(src);
  });

  it('C40: a known value in Armenian, Georgian or Latin with Vietnamese marks is replaced, capitals included', () => {
    const cases: Array<[string, KnownValue]> = [
      ['Ասաց Արամ Պետրոսյան. ԱՐԱՄ ՊԵՏՐՈՍՅԱՆ', { kind: 'person', value: 'Արամ Պետրոսյան' }],
      ['თქვა გიორგი ბერიძე. ᲒᲘᲝᲠᲒᲘ ᲑᲔᲠᲘᲫᲔ', { kind: 'person', value: 'გიორგი ბერიძე' }],
      ['Ông Nguyễn Văn Đức nói. NGUYỄN VĂN ĐỨC, Đức.', { kind: 'person', value: 'Nguyễn Văn Đức' }],
    ];
    for (const [src, k] of cases) {
      const res = blind([src], { seed: 'scripts', known: [k], now: NOW });
      const out = res.texts[0]!;
      expect(survives(out, k.value)).toBe(false);
      expect(res.leaks).toEqual(clean);
      expect(unblind(out, res.mapping).text).toBe(src);
    }
  });

  it('C3: the leak check reports a surviving Cyrillic or Greek value in capitals or another case, by kind and offset only', () => {
    const report = checkLeaks(leakInput(
      ['ИВАН ПЕТРОВ звонил.', 'Η ΑΛΦΑΒΗΤΙΚΉ ΤΡΆΠΕΖΑ, ο γιάννης.'],
      [{ kind: 'person', value: 'Иван Петров' }, { kind: 'org', value: 'Αλφαβητική Τράπεζα' }, { kind: 'person', value: 'Γιάννης' }],
    ));
    expect(report.ok).toBe(false);
    expect(report.hits).toEqual([
      { kind: 'person', textIndex: 0, offset: 0 },
      { kind: 'org', textIndex: 1, offset: 2 },
      { kind: 'person', textIndex: 1, offset: 24 },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/\p{Script=Cyrillic}|\p{Script=Greek}/u);
  });

  it('C40: LeakError on a surviving Cyrillic value carries the kind and an index, never the value', () => {
    const leaks = checkLeaks(leakInput(['ИВАН ПЕТРОВ звонил.'], [{ kind: 'person', value: 'Иван Петров' }]));
    expect(() => assertNoLeaks({ leaks })).toThrow(LeakError);
    try {
      assertNoLeaks({ leaks });
    } catch (e) {
      expect((e as Error).message).toMatch(/person/);
      expect((e as Error).message).not.toMatch(/\p{Script=Cyrillic}/u);
    }
  });
});

/** Latin for the look-alike letters the C40 look-alike test writes, so a surviving copy is seen. */
const foldForTest = (s: string): string => s.replace(/[МаоТесν]/g, (c) => ({ 'М': 'M', 'а': 'a', 'о': 'o', 'Т': 'T', 'е': 'e', 'с': 'c', 'ν': 'v' })[c]!);

describe('known values behind a Hebrew or Arabic glued prefix', () => {
  const clean = { ok: true, hits: [], unenforced: [] };
  const david: KnownValue[] = [{ kind: 'person', value: 'דוד כהן' }];
  const muhammad: KnownValue[] = [{ kind: 'person', value: 'محمد علي' }];
  const hebrew = /\p{scx=Hebrew}/u;
  const arabic = /\p{scx=Arabic}/u;
  const run = (src: string, known: KnownValue[], seed = 's', replaceWith: 'fake' | 'placeholder' | 'random' = 'fake') => {
    const res = blind([src], { seed, known, replaceWith, now: NOW });
    return { res, out: res.texts[0]!, back: unblind(res.texts[0]!, res.mapping).text };
  };

  it('C40: the four probes: a known Hebrew or Arabic name behind a glued prefix is replaced, the prefix kept, with a clean report', () => {
    {
      const { res, out, back } = run('שלום לדוד כהן ודוד', david);
      const m = /^שלום ל(\P{scx=Hebrew}+) (\P{scx=Hebrew}+) ו(\P{scx=Hebrew}+)$/u.exec(out);
      expect(m, out).not.toBeNull();
      expect(m![3]).toBe(m![1]);
      expect(res.leaks).toEqual(clean);
      expect(back).toBe('שלום לדוד כהן ודוד');
    }
    {
      const { res, out, back } = run('قال محمد علي. ومحمد ولمحمد', muhammad);
      const m = /^قال (\P{scx=Arabic}+) (\P{scx=Arabic}+)\. و(\P{scx=Arabic}+) ول(\P{scx=Arabic}+)$/u.exec(out);
      expect(m, out).not.toBeNull();
      expect(m![3]).toBe(m![1]);
      expect(m![4]).toBe(m![1]);
      expect(res.leaks).toEqual(clean);
      expect(back).toBe('قال محمد علي. ومحمد ولمحمد');
    }
    for (const [src, known, script, lead] of [['שלום דוד כהן', david, hebrew, 'שלום '], ['قال محمد علي', muhammad, arabic, 'قال ']] as const) {
      const { res, out, back } = run(src, known);
      expect(out.startsWith(lead)).toBe(true);
      expect(script.test(out.slice(lead.length))).toBe(false);
      expect(res.leaks).toEqual(clean);
      expect(back).toBe(src);
    }
  });

  const prefixes: Array<[string, string[], KnownValue[], RegExp]> = [
    ['Hebrew', ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'], david, hebrew],
    ['Arabic', ['و', 'ف', 'ب', 'ل', 'ك'], muhammad, arabic],
  ];
  for (const [script, letters, known, letter] of prefixes) {
    it(`C40: each ${script} one-letter prefix is kept and the known name behind it replaced, and round trips`, () => {
      const word = known[0]!.value.split(' ')[0]!;
      for (const p of letters) {
        const src = `${p}${word} ${p}${known[0]!.value}`;
        const { res, out, back } = run(src, known, `pre-${p}`);
        expect(out.startsWith(p), out).toBe(true);
        expect(letter.test(out.slice(1, out.indexOf(' '))), out).toBe(false);
        expect(out.match(new RegExp(letter.source, 'gu'))).toEqual([p, p]);
        expect(res.leaks).toEqual(clean);
        expect(back).toBe(src);
      }
    });
  }

  it('C40: a chain of prefixes and the Arabic article are kept and the known name behind them replaced, and round trips', () => {
    const cases: Array<[string, KnownValue[]]> = [
      ['ול', david], ['וב', david], ['ולל', david], ['שב', david],
      ['ال', [{ kind: 'org', value: 'نجمة' }]], ['وال', [{ kind: 'org', value: 'نجمة' }]], ['فال', [{ kind: 'org', value: 'نجمة' }]],
      ['ولل', [{ kind: 'org', value: 'نجمة' }]], ['ول', muhammad], ['بال', [{ kind: 'org', value: 'نجمة' }]],
    ];
    for (const [chain, known] of cases) {
      const word = known[0]!.value.split(' ')[0]!;
      const src = `${chain}${word} כן`;
      const { res, out, back } = run(src, known, `chain-${chain}`);
      expect(out.startsWith(chain), out).toBe(true);
      expect(out.endsWith(' כן'), out).toBe(true);
      expect(/[\p{scx=Hebrew}\p{scx=Arabic}]/u.test(out.slice(chain.length, -3)), out).toBe(false);
      expect(res.leaks).toEqual(clean);
      expect(back).toBe(src);
    }
  });

  it('C40: a known value that starts with a prefix letter is matched as a whole word first, and behind a prefix too', () => {
    for (const value of ['לאה', 'ליאור', 'ولید', 'بلال']) {
      const and = arabic.test(value) ? 'و' : 'ו';
      const src = `${value} ${and}${value}`;
      const { res, out, back } = run(src, [{ kind: 'person', value }], `whole-${value}`);
      const fake = out.slice(0, out.indexOf(' '));
      expect(/[\p{scx=Hebrew}\p{scx=Arabic}]/u.test(fake), out).toBe(false);
      expect(out).toBe(`${fake} ${and}${fake}`);
      expect(res.leaks).toEqual(clean);
      expect(back).toBe(src);
    }
  });

  it('C40: a known name written bare and behind a prefix in one text gets one fake for both', () => {
    const src = 'רונית כתבה. ולרונית ענו, ורונית שמחה.';
    const { res, out, back } = run(src, [{ kind: 'person', value: 'רונית' }], 'both');
    const fake = out.slice(0, out.indexOf(' '));
    expect(out).toBe(`${fake} כתבה. ול${fake} ענו, ו${fake} שמחה.`);
    expect(res.leaks).toEqual(clean);
    expect(back).toBe(src);
  });

  it('C40: a prefix is only taken off when the rest of the word is the value, and only a prefix letter counts', () => {
    // א is not a prefix and לדודו has a letter after the value: neither is the name.
    const src = 'אדוד לדודו לכהנים';
    const { res, out } = run(src, david, 'guard');
    expect(out).toBe(src);
    expect(res.leaks).toEqual(clean);
  });

  it('C40: Hebrew has no capitals, but a value ending in a final-form letter is matched bare and behind a prefix', () => {
    for (const value of ['ברוך', 'מרים', 'רונן', 'יוסף', 'פרץ']) {
      const src = `${value} ול${value}.`;
      const { res, out, back } = run(src, [{ kind: 'person', value }], `final-${value}`);
      const fake = out.slice(0, out.indexOf(' '));
      expect(hebrew.test(fake), out).toBe(false);
      expect(out).toBe(`${fake} ול${fake}.`);
      expect(res.leaks).toEqual(clean);
      expect(back).toBe(src);
    }
  });

  it('C40: known Hebrew and Arabic values behind prefixes round trip in fake, placeholder and random modes', () => {
    const src = 'שלום לדוד כהן ודוד. قال محمد علي. ومحمد وللنجمة';
    const known: KnownValue[] = [...david, ...muhammad, { kind: 'org', value: 'نجمة' }];
    for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
      const { res, out, back } = run(src, known, 'rt', replaceWith);
      for (const w of ['דוד', 'כהן', 'محمد', 'علي', 'نجمة']) expect(out, replaceWith).not.toContain(w);
      expect(out.startsWith('שלום ל')).toBe(true);
      expect(out).toContain(' ו');
      expect(out).toContain(' ول');
      expect(res.leaks).toEqual(clean);
      expect(back).toBe(src);
    }
  });

  it('C3: the leak check reports a known Hebrew or Arabic value that survived behind a prefix, by kind and offset only', () => {
    const report = checkLeaks(leakInput(
      ['שלום לדוד כהן ודוד, אדוד', 'قال ومحمد وللنجمة نجمتي'],
      [{ kind: 'person', value: 'דוד כהן', known: true }, { kind: 'person', value: 'דוד', known: true }, { kind: 'person', value: 'محمد', known: true }, { kind: 'org', value: 'نجمة', known: true }],
    ));
    expect(report.ok).toBe(false);
    expect(report.hits).toEqual([
      { kind: 'person', textIndex: 0, offset: 6 },
      { kind: 'person', textIndex: 0, offset: 6 },
      { kind: 'person', textIndex: 0, offset: 15 },
      { kind: 'person', textIndex: 1, offset: 5 },
      { kind: 'org', textIndex: 1, offset: 13 },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/\p{scx=Hebrew}|\p{scx=Arabic}/u);
    try {
      assertNoLeaks({ leaks: report });
    } catch (e) {
      expect(e).toBeInstanceOf(LeakError);
      expect((e as Error).message).toMatch(/person/);
      expect((e as Error).message).not.toMatch(/\p{scx=Hebrew}|\p{scx=Arabic}/u);
    }
  });
});
