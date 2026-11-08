/**
 * The seeded generator on its own: 128 bits of state keyed from the whole seed,
 * same seed same stream.
 */
import { describe, expect, it } from 'vitest';
import { hash128, Rng } from '../src/prng.js';

describe('Rng', () => {
  it('C6/unit: the same seed gives the same stream, and a fork depends on its label', () => {
    const a = new Rng('seed-a');
    const b = new Rng('seed-a');
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(xs);
    expect(new Rng('seed-a').fork('x').next()).toBe(new Rng('seed-a').fork('x').next());
    expect(new Rng('seed-a').fork('x').next()).not.toBe(new Rng('seed-a').fork('y').next());
  });

  it('every character of the seed reaches every lane of the 128-bit state', () => {
    const base = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
    const h = hash128(base);
    for (let i = 0; i < base.length; i++) {
      const changed = base.slice(0, i) + (base[i] === '0' ? '1' : '0') + base.slice(i + 1);
      const g = hash128(changed);
      for (let lane = 0; lane < 4; lane++) expect(g[lane]).not.toBe(h[lane]);
    }
  });

  it('the state is wider than 32 bits: 2^18 UUID-shaped seeds give 2^18 different streams', () => {
    // A 32-bit state makes about eight of 2^18 seeds share a whole stream by
    // the birthday bound (the generator this replaced had ten here). With 128
    // bits a shared state is out of reach.
    const g = new Rng('uuid-shaped seeds');
    const hex = (n: number): string => Array.from({ length: n }, () => '0123456789abcdef'[g.int(16)]).join('');
    const seen = new Set<string>();
    for (let i = 0; i < 1 << 18; i++) {
      const r = new Rng(`${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`);
      seen.add(`${r.next()},${r.next()}`);
    }
    expect(seen.size).toBe(1 << 18);
  });

  it('outputs are in [0, 1) and spread evenly over ten buckets', () => {
    const r = new Rng('spread');
    const buckets = new Array<number>(10).fill(0);
    let outside = 0;
    for (let i = 0; i < 100_000; i++) {
      const x = r.next();
      if (x < 0 || x >= 1) outside++;
      else buckets[Math.floor(x * 10)]!++;
    }
    expect(outside).toBe(0);
    for (const b of buckets) expect(Math.abs(b - 10_000)).toBeLessThan(500);
  });
});
