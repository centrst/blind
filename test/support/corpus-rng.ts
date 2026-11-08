/**
 * The corpus generator's own seeded source. The committed corpus is a fixture:
 * it must not change when the library's `Rng` changes, or a generator swap
 * reshuffles every test text and floors move for reasons unrelated to the
 * change. This is the 32-bit generator `src/prng.ts` used when the corpus was
 * written (a 32-bit seed hash and the mulberry32 step), frozen here so
 * `pnpm corpus:generate` keeps reproducing `corpus/generated` byte for byte.
 */
import type { Src } from './values.js';

function hash32(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export class CorpusRng implements Src {
  private s: number;

  constructor(seed: string) {
    this.s = hash32(seed);
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }
}
