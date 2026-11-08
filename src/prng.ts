/** Small seeded PRNG. Math.random is never used. */

/**
 * The whole seed string hashed into four 32-bit lanes (cyrb128). Every
 * character reaches every lane, so two seeds that differ anywhere give
 * different states. Plain JavaScript, no Web Crypto, since blind is synchronous.
 */
export function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

const rotl = (x: number, k: number): number => (x << k) | (x >>> (32 - k));

/**
 * xoshiro128**: 128 bits of state, keyed from a hash of the whole seed. It is
 * not a cryptographic generator; see docs/THREAT-MODEL.md for what that means.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(private readonly seed: string) {
    [this.a, this.b, this.c, this.d] = hash128(seed);
    // xoshiro must not start from all zeros.
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Independent stream, so adding one kind of surrogate never shifts another. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}|${label}`);
  }

  next(): number {
    const result = Math.imul(rotl(Math.imul(this.b, 5), 7), 9) >>> 0;
    const t = this.b << 9;
    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = rotl(this.d, 11);
    return result / 4294967296;
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)] as T;
  }

  digit(min = 0): number {
    return this.range(min, 9);
  }

  shuffled<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [a[i], a[j]] = [a[j] as T, a[i] as T];
    }
    return a;
  }
}
