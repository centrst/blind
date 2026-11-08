import { adaptCase } from './case.js';
import type { Kind, Pair } from './types.js';

/** Kinds unblind gives back in the letter case the text writes the fake in. */
const NAMED = new Set<Kind>(['person', 'org', 'place']);

/**
 * The real-to-fake pair log, and the one rule unblind reads it by. A fake
 * written exactly as a pair has it gives back that pair's real value. The same
 * fake in another letter case gives back the first pair with that fake, a name
 * in the case it is written in. Every fake blind writes is claimed here first
 * and gets a pair as written, so one fake never stands for two values and a
 * value restores exactly, whatever its case or spelling.
 */
export class PairLog {
  private claimed: Pair[] = [];
  private reserved: Pair[] = [];
  /** Reservations made for a known name before any text wrote it. */
  private primed = new Set<Pair>();
  private exact = new Map<string, Pair>();
  private folded = new Map<string, Pair>();
  private byReal = new Map<string, string>();

  /** `earlier` pairs are read as unblind reads them but not listed again. */
  constructor(earlier: readonly Pair[] = [], private readonly caseHabit = true) {
    for (const p of earlier) this.index(p);
  }

  private index(p: Pair): void {
    if (!this.exact.has(p.fake)) this.exact.set(p.fake, p);
    const low = p.fake.toLowerCase();
    if (!this.folded.has(low)) this.folded.set(low, p);
    const r = `${p.kind}|${p.real}`;
    if (!this.byReal.has(r) && this.exact.get(p.fake) === p) this.byReal.set(r, p.fake);
  }

  /** The real value that holds `fake` exactly, if any. */
  ownerOf(fake: string): string | undefined {
    return this.exact.get(fake)?.real;
  }

  /** The real value of the first pair with `fake` in any letter case, if any. */
  firstOwnerOf(fake: string): string | undefined {
    return this.folded.get(fake.toLowerCase())?.real;
  }

  /** The fake already written for `real`, as written, if any. */
  fakeOf(kind: Kind, real: string): string | undefined {
    return this.byReal.get(`${kind}|${real}`);
  }

  /** True when some pair has `fake` in any letter case. */
  knows(fake: string): boolean {
    return this.folded.has(fake.toLowerCase());
  }

  /** Lower-case fakes, the keys unblind looks for. */
  keys(): string[] {
    return [...this.folded.keys()];
  }

  /**
   * Writes `fake` for `real`. False when another value holds that fake, and
   * then nothing is recorded: the caller must try another fake.
   */
  claim(kind: Kind, real: string, fake: string): boolean {
    const owner = this.exact.get(fake);
    if (owner) return owner.real === real;
    const p = { kind, real, fake };
    this.claimed.push(p);
    this.index(p);
    return true;
  }

  /**
   * A pair for a form no text may write: a name's base fake for its plain
   * spelling, a host on its own. It is kept, after every claimed pair, only if
   * no value claims its fake, so a reply that writes it still comes back.
   */
  reserve(kind: Kind, real: string, fake: string, primed = false): void {
    const p = { kind, real, fake };
    this.reserved.push(p);
    if (primed) this.primed.add(p);
  }

  /**
   * Drops each reservation made for a known name up front that `keep` refuses,
   * so a known word no text wrote gets no pair and never reaches the mapping.
   */
  keepPrimed(keep: (p: Pair) => boolean): void {
    this.reserved = this.reserved.filter((p) => !this.primed.has(p) || keep(p));
  }

  /** Claimed pairs in the order they were claimed, then the reservations nothing took. */
  get pairs(): Pair[] {
    const out = [...this.claimed];
    const taken = new Set(this.exact.keys());
    for (const p of this.reserved) {
      if (taken.has(p.fake)) continue;
      taken.add(p.fake);
      out.push(p);
    }
    return out;
  }

  /** What unblind gives back for `fake` as found in a text. */
  restore(fake: string): string | undefined {
    const hit = this.exact.get(fake);
    if (hit) return hit.real;
    const p = this.folded.get(fake.toLowerCase());
    if (!p) return undefined;
    return this.caseHabit && NAMED.has(p.kind) ? adaptCase(fake, p.real) : p.real;
  }
}
