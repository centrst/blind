import { describe, expect, it } from 'vitest';
import { blind, unblind } from '../src/index.js';

/**
 * A value the model computes from fakes, rather than copies, comes back close but
 * not always exact. Each fake amount is rounded to its written precision, and
 * unblind divides a computed amount by the factor. A date moved by months lands in
 * months of other lengths. These tests pin the limits the README states, until
 * exact restoration of derived amounts exists (issue #25).
 */
describe('values the model computes from fakes', () => {
  const amount = (text: string, label: string): number => Number(new RegExp(`${label} for EUR (\\d+)`).exec(text)?.[1]);

  it('restore a difference of two whole amounts within one unit, listed in invented unless it equals a fake', () => {
    // round(200f) - round(100f) differs from 100f by at most 0.75 for any factor f,
    // and dividing by the smallest factor, 0.6, keeps that under 1.5 before rounding.
    let inexact = 0;
    for (let i = 0; i < 500; i++) {
      const b = blind(['Invoice A for EUR 100. Invoice B for EUR 200.'], { seed: `derived-${i}` });
      const text = b.texts[0] as string;
      const fakeA = amount(text, 'Invoice A');
      const difference = amount(text, 'Invoice B') - fakeA;
      const back = unblind(`EUR ${difference}`, b.mapping);
      const restored = Number(/EUR (\d+)/.exec(back.text)?.[1]);
      expect(Math.abs(restored - 100), `seed derived-${i}`).toBeLessThanOrEqual(1);
      // A difference equal to invoice A's fake is read as that fake, so it maps back
      // to EUR 100 exactly and is not invented. Any other difference is invented.
      if (difference === fakeA) {
        expect(back.text, `seed derived-${i}`).toBe('EUR 100');
        expect(back.invented, `seed derived-${i}`).toEqual([]);
      } else {
        expect(back.invented, `seed derived-${i}`).toContain(`EUR ${difference}`);
      }
      if (restored !== 100) inexact++;
    }
    // The README states this count.
    expect(inexact).toBe(150);
  });

  it('restore a difference that equals an unrelated fake as that amount, without listing it', () => {
    const b = blind(['Invoice A for EUR 100. Invoice B for EUR 200.', 'Fee EUR 99.'], { seed: 'synthetic-private-workflow' });
    expect(b.texts).toEqual(['Invoice A for EUR 75. Invoice B for EUR 149.', 'Fee EUR 74.']);
    expect(unblind('EUR 149 - EUR 75 = EUR 74', b.mapping)).toEqual({ text: 'EUR 200 - EUR 100 = EUR 99', invented: [], collisions: [] });
  });

  it('restore a date moved by a month a few days off, listed in invented', () => {
    const b = blind(['Due 25 January 2026.'], { seed: 'm-4' });
    expect(b.texts).toEqual(['Due 15 February 2026.']);
    expect(unblind('Due 15 March 2026.', b.mapping)).toEqual({ text: 'Due 22 February 2026.', invented: ['15 March 2026'], collisions: [] });
  });

  it('restore a computed date that equals a fake as that date, without listing it', () => {
    const b = blind(['Due 25 January 2026. Paid 22 February 2026.'], { seed: 'm-4' });
    expect(b.texts).toEqual(['Due 15 February 2026. Paid 15 March 2026.']);
    expect(unblind('Due 15 March 2026.', b.mapping)).toEqual({ text: 'Due 22 February 2026.', invented: [], collisions: [] });
  });

  it('restore a yearless date moved across a year end a day off, listed in invented', () => {
    const b = blind(['Due 10 December.'], { seed: 'y25', now: new Date('2024-06-01T00:00:00Z') });
    expect(b.texts).toEqual(['Due 31 December.']);
    const back = unblind('Due 1 March.', b.mapping);
    expect(back.text).toBe('Due 9 February.');
    expect(back.invented).toHaveLength(1);
  });

  it('leave a computed negative amount written EUR -74 unchanged and unlisted', () => {
    const b = blind(['Invoice A for EUR 100. Invoice B for EUR 200.'], { seed: 'synthetic-private-workflow' });
    expect(unblind('EUR 75 - EUR 149 = EUR -74', b.mapping)).toEqual({ text: 'EUR 100 - EUR 200 = EUR -74', invented: [], collisions: [] });
  });

  const source = 'Dana Mercer <dana@northwind.example> sent invoice A for EUR 100, due 6 November 2026. Dana Mercer <dana@northwind.example> sent invoice B for EUR 200, due 9 November 2026.';
  const fixture = () => blind([source], { replaceWith: 'fake', seed: 'synthetic-private-workflow', known: [{ kind: 'person', value: 'Dana Mercer' }] });

  it('restore the issue #25 fixture difference as EUR 99, listed in invented', () => {
    const b = fixture();
    expect(b.mapping.factor).toBe(0.747);
    expect(b.texts[0]).toMatch(/invoice A for EUR 75, .*invoice B for EUR 149,/);
    expect(unblind('EUR 149 - EUR 75 = EUR 74', b.mapping)).toEqual({ text: 'EUR 200 - EUR 100 = EUR 99', invented: ['EUR 74'], collisions: [] });
  });

  // When derived amounts restore exactly, this starts to pass, it.fails turns red,
  // and the README limit and the test above must be rewritten.
  it.fails('restore the difference in the issue #25 fixture exactly (known limit)', () => {
    expect(unblind('EUR 149 - EUR 75 = EUR 74', fixture().mapping).text).toBe('EUR 200 - EUR 100 = EUR 100');
  });
});
