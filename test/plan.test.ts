import { describe, expect, it } from 'vitest';
import { blind, unblind } from '../src/index.js';
import { Rng } from '../src/prng.js';
import { survives } from './support/corpus.js';

// Synthetic texts: every amount and date below is invented.
const NOW = new Date('2026-06-01T00:00:00Z');
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** One factor as blind draws it: values within 0.05 of 1 are drawn again from the same stream. */
function drawFactor(fr: Rng): number {
  for (let i = 0; i < 64; i++) {
    const f = Math.round((0.6 + fr.next()) * 1000) / 1000;
    if (Math.abs(f - 1) >= 0.05) return f;
  }
  return 1.1;
}

/** The factor and day shift blind draws first for a seed, before any collision check. */
function firstDraw(seed: string): { factor: number; dayShift: number } {
  const root = new Rng(seed);
  const factor = drawFactor(root.fork('factor'));
  const dayShift = root.fork('shift').range(1, 10) * (root.fork('shift-sign').int(2) === 0 ? -1 : 1) * 7;
  return { factor, dayShift };
}

/** The first `n` factors and day shifts blind draws for a seed, in order. */
function draws(seed: string, n: number): Array<{ factor: number; dayShift: number }> {
  const root = new Rng(seed);
  const fr = root.fork('factor');
  const sr = root.fork('shift');
  const signs = root.fork('shift-sign');
  return Array.from({ length: n }, () => {
    const factor = drawFactor(fr);
    const dayShift = sr.range(1, 10) * (signs.int(2) === 0 ? -1 : 1) * 7;
    return { factor, dayShift };
  });
}

describe('scaling plan', () => {
  it('C39/unit: a factor whose fake of one amount equals another real amount is drawn again', () => {
    const seed = 'c32-amount';
    const naive = firstDraw(seed);
    const other = (Math.round(3810 * naive.factor) / 100).toFixed(2);
    expect(other).not.toBe('38.10');
    const text = `The first invoice was 38.10 EUR. The second invoice was ${other} EUR.`;
    const res = blind([text], { seed, now: NOW });
    const out = res.texts[0] as string;
    expect(res.mapping.factor).not.toBe(naive.factor);
    expect(survives('amount', '38.10', out)).toBe(false);
    expect(survives('amount', other, out)).toBe(false);
    expect(res.leaks.ok).toBe(true);
    expect(unblind(out, res.mapping).text).toBe(text);
  });

  it('C39/unit: a shift whose fake of one date contains another real date is drawn again', () => {
    const seed = 'c32-date';
    const naive = firstDraw(seed);
    const real = new Date(Date.UTC(2025, 7, 22));
    const moved = new Date(real.getTime() + naive.dayShift * 86_400_000);
    const bare = `${moved.getUTCDate()} de ${MONTHS[moved.getUTCMonth()]}`;
    const text = `Hola, la declaración vence el 22 de agosto de 2025. La cita previa es el ${bare}.`;
    const res = blind([text], { seed, now: NOW });
    const out = res.texts[0] as string;
    expect(res.mapping.dayShift).not.toBe(naive.dayShift);
    expect(survives('date', '22 de agosto de 2025', out)).toBe(false);
    expect(survives('date', bare, out)).toBe(false);
    expect(res.leaks.ok).toBe(true);
    expect(unblind(out, res.mapping).text).toBe(text);
  });

  it('C39/unit: when every shift lands on another real date, a long text stops after two draws and lists the colliding pairs by kind and index', () => {
    const seed = 'c39-dense';
    // 1,100 days in a row: any shift of one to ten weeks moves most of them onto another day of the list.
    const day = (i: number): string => new Date(Date.UTC(2023, 0, 1 + i)).toISOString().slice(0, 10);
    const text = Array.from({ length: 1100 }, (_, i) => `Entry ${i + 1} is dated ${day(i)}.`).join('\n');
    const res = blind([text], { seed, now: NOW });
    expect(res.mapping).toMatchObject(draws(seed, 2)[1] as object);
    const reals = new Set(Array.from({ length: 1100 }, (_, i) => day(i)));
    const colliding = res.mapping.pairs.flatMap((p, index) => (p.kind === 'date' && reals.has(p.fake) ? [index] : []));
    expect(colliding.length).toBeGreaterThan(0);
    expect(res.collisions.map((c) => c.index)).toEqual(colliding);
    for (const c of res.collisions) expect(Object.keys(c).sort()).toEqual(['index', 'kind']);
    expect(res.collisions.every((c) => c.kind === 'date')).toBe(true);
    expect(unblind(res.texts[0] as string, res.mapping).text).toBe(text);
  });

  it('C39/unit: without a collision the first draw is kept, so the plan stays the same for a seed', () => {
    const seed = 'c32-clean';
    const text = 'The invoice was 38.10 EUR, due on 22 August 2025.';
    const a = blind([text], { seed, now: NOW });
    expect(a.mapping).toMatchObject(firstDraw(seed));
    expect(blind([text], { seed, now: NOW }).texts).toEqual(a.texts);
  });

  it('C44/unit: a factor within 0.05 of 1 is drawn again, not moved to 0.9 or 1.1, so no factor comes up far more often than the rest', () => {
    const n = 3000;
    const counts = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const { factor } = blind(['The invoice was 38.10 EUR.'], { seed: `c44-${i}`, now: NOW }).mapping;
      expect(factor >= 0.6 && factor <= 1.6).toBe(true);
      expect(Math.abs(factor - 1)).toBeGreaterThanOrEqual(0.05);
      counts.set(factor, (counts.get(factor) ?? 0) + 1);
    }
    // About 900 factors remain, each near 0.11% of draws. Clamping put about 5% on each of 0.9 and 1.1.
    expect((counts.get(0.9) ?? 0) / n).toBeLessThan(0.01);
    expect((counts.get(1.1) ?? 0) / n).toBeLessThan(0.01);
    expect(Math.max(...counts.values()) / n).toBeLessThan(0.01);
    expect(counts.size).toBeGreaterThan(800);
  });
});

describe('id fakes', () => {
  /** The letters blind's first draw gives a three-letter id, before any check: `digitsLike` takes them from the `digits` stream. */
  const firstLetters = (seed: string): string => {
    const r = new Rng(seed).fork('digits');
    return Array.from({ length: 3 }, () => String.fromCharCode(65 + r.int(26))).join('');
  };

  it('C39/unit: an id fake whose letters spell a part of a known name, RIO for Río, is drawn again, so the name does not come back inside an id', () => {
    let seed = '';
    for (let i = 0; seed === ''; i++) if (firstLetters(`rio-${i}`) === 'RIO') seed = `rio-${i}`;
    const text = 'Expediente EXP-2024-0000 de Joaquín del Río.';
    const res = blind([text], { seed, known: [{ kind: 'person', value: 'Joaquín del Río' }], now: NOW });
    const id = res.mapping.pairs.find((p) => p.kind === 'id');
    expect(id?.real).toBe('EXP-2024-0000');
    expect(id?.fake.slice(0, 3)).not.toBe('RIO');
    expect(res.leaks.ok).toBe(true);
    expect(unblind(res.texts[0] as string, res.mapping).text).toBe(text);
  });
});
