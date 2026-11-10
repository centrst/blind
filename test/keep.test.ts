import { describe, expect, it } from 'vitest';
import { blind, checkMapping, createUnblinder, prepareUnblinder, unblind } from '../src/index.js';
import { BlindError } from '../src/errors.js';
import type { Kind, Mapping } from '../src/types.js';

// Synthetic text. Every name, number and domain is invented.
const TEXT = [
  'Hi, Ana Ruiz <ana@gestoria-lumera.example> here.',
  'Christmas Day is 25 December 2026. The VAT registration threshold is £90,000.',
  'Invoice INV-20419 of £1,250 is due on 3 March 2026.',
].join('\n');
const KNOWN = [{ kind: 'person' as const, value: 'Ana Ruiz' }];
const SEED = 'keep-1';

const kept = (keep?: Kind[]) => blind([TEXT], { seed: SEED, known: KNOWN, ...(keep ? { keep } : {}) });

describe('keep', () => {
  it('C53: a kept kind is written as it stands, with no pair and no count, and every other kind is still replaced', () => {
    const r = kept(['amount', 'date']);
    const out = r.texts[0] as string;
    for (const v of ['25 December 2026', '£90,000', '£1,250', '3 March 2026']) expect(out, v).toContain(v);
    for (const v of ['Ana', 'Ruiz', 'gestoria-lumera', 'INV-20419']) expect(out, v).not.toContain(v);
    expect(r.replaced.amount).toBeUndefined();
    expect(r.replaced.date).toBeUndefined();
    expect(r.replaced.person).toBe(1);
    expect(r.mapping.pairs.some((p) => p.kind === 'amount' || p.kind === 'date')).toBe(false);
    expect(r.leaks.ok).toBe(true);
    expect(unblind(out, r.mapping).text).toBe(TEXT);
  });

  it('C53: the default is unchanged: without keep the same seed gives the same text it gave before, with amounts scaled and dates shifted', () => {
    const r = kept();
    expect(r.mapping.keep).toBeUndefined();
    expect(r.texts[0]).not.toContain('£90,000');
    expect(r.texts[0]).not.toContain('25 December 2026');
    expect(blind([TEXT], { seed: SEED, known: KNOWN, keep: [] }).texts).toEqual(r.texts);
    // Names and ids get the same fakes whether or not amounts and dates are kept.
    const k = kept(['amount', 'date']).texts[0] as string;
    const nameOf = (t: string): string => /Hi, (\S+ \S+) </.exec(t)![1]!;
    expect(nameOf(k)).toBe(nameOf(r.texts[0] as string));
  });

  it('C53: a kept span still takes part in span resolution, so a kept date is not then taken as an id', () => {
    const text = 'Ref 2026-03-03 for Ana Ruiz.';
    const r = blind([text], { seed: SEED, known: KNOWN, keep: ['date'] });
    expect(r.texts[0]).toContain('2026-03-03');
    expect(r.replaced.id).toBeUndefined();
    expect(r.mapping.pairs.every((p) => p.kind === 'person')).toBe(true);
  });

  it('C53: keep is checked like the other options, by index and never by value', () => {
    const call = (keep: unknown): unknown => blind(['x'], { keep } as never);
    expect(() => call('amount')).toThrow(/keep must be an array of kinds/);
    try {
      call(['amount', 'Ana Ruiz']);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BlindError);
      expect((e as BlindError).kind).toBe('invalid-option');
      expect((e as Error).message).toMatch(/keep entry 1 is not a kind/);
      expect((e as Error).message).not.toContain('Ana');
    }
    expect(() => blind(['x'], { kepp: ['amount'] } as never)).toThrow(/options has a key blind does not know.*keep/);
  });

  it('C53: the mapping records the kinds in one order, a later turn keeps them, and a different keep throws', () => {
    const first = blind([TEXT], { seed: SEED, known: KNOWN, keep: ['date', 'amount', 'date'] });
    expect(first.mapping.keep).toEqual(['amount', 'date']);
    const next = blind(['Ana Ruiz paid £1,250 on 3 March 2026 and £75 on 4 March 2026.'], { mapping: first.mapping });
    expect(next.mapping.keep).toEqual(['amount', 'date']);
    expect(next.texts[0]).toContain('paid £1,250 on 3 March 2026 and £75 on 4 March 2026.');
    expect(next.texts[0]).not.toContain('Ana');
    expect(blind(['x'], { mapping: first.mapping, keep: ['date', 'amount'] }).mapping.keep).toEqual(['amount', 'date']);
    for (const keep of [['amount'], [], ['amount', 'date', 'id']] as Kind[][]) {
      expect(() => blind(['x'], { mapping: first.mapping, keep })).toThrow(/keep differs from the kinds the mapping was made with/);
    }
    expect(() => blind(['x'], { mapping: kept().mapping, keep: ['amount'] })).toThrow(/keep differs/);
    expect(blind(['x'], { mapping: kept().mapping }).mapping.keep).toBeUndefined();
  });

  it('C53: checkMapping accepts a mapping with keep and refuses a keep that is not a list of distinct kinds, naming only the field', () => {
    const m = kept(['amount', 'date']).mapping;
    expect(() => checkMapping(JSON.parse(JSON.stringify(m)))).not.toThrow();
    for (const keep of ['amount', [], ['amount', 'amount'], ['amount', 'money'], [7]]) {
      expect(() => checkMapping({ ...m, keep }), JSON.stringify(keep)).toThrow(/the mapping is not valid \(keep\)/);
      expect(() => unblind('x', { ...m, keep } as Mapping)).toThrow(/\(keep\)/);
      expect(() => blind(['x'], { mapping: { ...m, keep } as Mapping })).toThrow(/\(keep\)/);
    }
  });

  it('C53: unblind leaves an amount or date of a kept kind that the mapping does not know as written and does not list it, one-shot, prepared and streamed', () => {
    const r = kept(['amount', 'date']);
    const answer = `The VAT registration threshold is £90,000. The tax year ends on 5 April 2026, so pay £300 by 31 January 2027.\n${r.texts[0]}`;
    const expected = `The VAT registration threshold is £90,000. The tax year ends on 5 April 2026, so pay £300 by 31 January 2027.\n${TEXT}`;
    const one = unblind(answer, r.mapping);
    expect(one.text).toBe(expected);
    expect(one.invented).toEqual([]);
    expect(prepareUnblinder(r.mapping).unblind(answer)).toEqual(one);
    for (const size of [1, 3, 7, 40]) {
      const u = createUnblinder(r.mapping);
      let text = '';
      for (let i = 0; i < answer.length; i += size) text += u.push(answer.slice(i, i + size));
      const end = u.end();
      expect(text + end.text).toBe(one.text);
      expect(end.invented).toEqual(one.invented);
    }
    // Only amounts kept: a new date is still shifted back and listed, a new amount is not.
    const a = kept(['amount']);
    const back = unblind('Pay £300 by 31 January 2027.', a.mapping);
    expect(back.text).toContain('£300');
    expect(back.text).not.toContain('31 January 2027');
    expect(back.invented).toEqual(['31 January 2027']);
    // Without keep, the same answer is rescaled and shifted, and both are listed.
    const plain = unblind('The VAT registration threshold is £90,000.', kept().mapping);
    expect(plain.text).not.toContain('£90,000');
    expect(plain.invented).toEqual(['£90,000']);
  });

  it('C53: a kept value is not a leak hit, but a known or deny entry of a kept kind still is', () => {
    const r = blind(['Meet Ana Ruiz at Valdoria Harbour on 3 March 2026, fee £1,250.'], {
      seed: SEED, keep: ['person', 'place', 'amount', 'date'], deny: ['£1,250'],
      known: [{ kind: 'person', value: 'Ana Ruiz' }, { kind: 'place', value: 'Valdoria Harbour' }],
    });
    expect(r.texts[0]).toBe('Meet Ana Ruiz at Valdoria Harbour on 3 March 2026, fee £1,250.');
    expect(r.leaks.ok).toBe(false);
    const kinds = new Set(r.leaks.hits.map((h) => h.kind));
    expect(kinds).toEqual(new Set(['person', 'place', 'deny']));
    expect(JSON.stringify(r.leaks)).not.toMatch(/Ana|Valdoria|1,250/);
    // The same kept values found by the detectors alone, with no known or deny entry: clean. A bare host is a
    // url span, and with hosts kept the host of a replaced address is not looked for in it.
    const found = blind(['Pay £1,250 on 3 March 2026 to ana@gestoria-lumera.example, see gestoria-lumera.example.'], { seed: SEED, keep: ['amount', 'date', 'domain', 'url'] });
    expect(found.texts[0]).toContain('£1,250 on 3 March 2026');
    expect(found.texts[0]).toContain('see gestoria-lumera.example.');
    expect(found.texts[0]).not.toContain('ana@');
    expect(found.leaks).toEqual({ ok: true, hits: [], unenforced: [] });
    expect(unblind(found.texts[0] as string, found.mapping).text).toBe('Pay £1,250 on 3 March 2026 to ana@gestoria-lumera.example, see gestoria-lumera.example.');
  });

  it('C53: a later turn does not look for a kept kind it carried in an earlier pair, so it stays clean', () => {
    const first = blind(['Write to ana@gestoria-lumera.example.'], { seed: SEED, keep: ['domain', 'url'] });
    expect(first.mapping.pairs.some((p) => p.kind === 'domain')).toBe(true);
    const next = blind(['The site is gestoria-lumera.example.'], { mapping: first.mapping });
    expect(next.texts[0]).toBe('The site is gestoria-lumera.example.');
    expect(next.leaks.ok).toBe(true);
  });

  it('C53: in paranoid mode a kept value is not a suspect', () => {
    const text = 'Dear Mr Holloway, the grant of £1,250,000 is paid on 3 March 2026.';
    const r = blind([text], { seed: SEED, paranoid: true, keep: ['person', 'amount', 'date'] });
    expect(r.texts[0]).toBe(text);
    expect(r.leaks.suspects).toEqual([]);
    expect(r.leaks.ok).toBe(true);
    // A word no detector finds is still flagged beside them.
    const more = blind([`${text} Project Falcon Orvane approves.`], { seed: SEED, paranoid: true, keep: ['person', 'amount', 'date'] });
    expect(more.leaks.suspects?.map((s) => s.kind)).toEqual(['name']);
  });

  it('C53: keep works with placeholder and random values too', () => {
    for (const replaceWith of ['placeholder', 'random'] as const) {
      const r = blind([TEXT], { seed: SEED, known: KNOWN, replaceWith, keep: ['amount', 'date'] });
      const out = r.texts[0] as string;
      for (const v of ['25 December 2026', '£90,000', '£1,250', '3 March 2026']) expect(out, `${replaceWith} ${v}`).toContain(v);
      expect(out).not.toContain('Ana');
      expect(r.mapping.keep).toEqual(['amount', 'date']);
      const back = unblind(`Also £75 on 4 March 2026.\n${out}`, r.mapping);
      expect(back.text).toBe(`Also £75 on 4 March 2026.\n${TEXT}`);
      expect(back.invented).toEqual([]);
    }
  });
});
