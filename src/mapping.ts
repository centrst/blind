/**
 * The mapping as a value passed back in: what makes one valid, and which of
 * its pairs cannot come back as written. Both `blind` and `unblind` read it.
 */
import { BlindError } from './errors.js';
import { placeholderNumber, REPLACE_MODES } from './replace.js';
import type { Collision, Kind, Mapping, ReplaceWith } from './types.js';

const KINDS = new Set<Kind>(['person', 'org', 'email', 'domain', 'phone', 'place', 'id', 'url', 'iban', 'amount', 'date']);
/** Kinds whose fake always differs from the real value when blind made it. */
const ALWAYS_CHANGED = new Set<Kind>(['person', 'org', 'place', 'phone', 'iban', 'id', 'date']);
/** The same in `random` mode, where an amount's fake is drawn to differ too. */
const ALWAYS_CHANGED_RANDOM = new Set<Kind>([...ALWAYS_CHANGED, 'amount']);

/**
 * A mapping passed back in, perhaps by someone else (a proxy's caller), must
 * keep the invariants blind made it under. A factor of 1, a zero shift or a pair
 * whose fake is its real value would let real amounts, dates or names through
 * with a clean leak check. `placeholder` and `random` mappings scale and shift
 * nothing, so they need a factor of exactly 1 and a shift of 0, and their pairs
 * must be placeholders of their kind or random values that differ from the
 * real ones. The error names the field, never a value.
 */
export function checkMapping(m: unknown): asserts m is Mapping {
  const bad = (field: string): never => {
    throw new BlindError('invalid-mapping', `blind: the mapping is not valid (${field})`);
  };
  if (!m || typeof m !== 'object') bad('shape');
  const x = m as Record<string, unknown>;
  if (x.version !== 1) bad('version');
  if (typeof x.seed !== 'string' || x.seed.length === 0) bad('seed');
  if (x.replaceWith !== undefined && !REPLACE_MODES.includes(x.replaceWith as ReplaceWith)) bad('replaceWith');
  const mode = (x.replaceWith ?? 'fake') as ReplaceWith;
  const f = x.factor;
  const d = x.dayShift;
  if (mode === 'fake') {
    if (typeof f !== 'number' || !(f >= 0.6 && f <= 1.6) || Math.abs(f - 1) < 0.05) bad('factor');
    if (typeof d !== 'number' || !Number.isInteger(d) || d === 0 || d % 7 !== 0 || Math.abs(d) > 70) bad('dayShift');
  } else {
    if (f !== 1) bad('factor');
    if (d !== 0) bad('dayShift');
  }
  if (x.dateOrder !== 'dmy' && x.dateOrder !== 'mdy') bad('dateOrder');
  if (typeof x.refYear !== 'number' || !Number.isInteger(x.refYear)) bad('refYear');
  if (!Array.isArray(x.pairs)) bad('pairs');
  if (x.literals !== undefined) {
    const lit = x.literals;
    if (mode !== 'placeholder' || !Array.isArray(lit) || !lit.every((l) => typeof l === 'string' && /^\[REDACTED_[A-Z]+_[1-9]\d*\]$/.test(l))) bad('literals');
  }
  (x.pairs as unknown[]).forEach((p, i) => {
    const q = p as Record<string, unknown> | null;
    if (!q || !KINDS.has(q.kind as Kind) || typeof q.real !== 'string' || typeof q.fake !== 'string' || q.real.length === 0) bad(`pairs[${i}]`);
    const kind = q!.kind as Kind;
    const same = (q!.fake as string).toLowerCase() === (q!.real as string).toLowerCase();
    if (mode === 'placeholder' && placeholderNumber(kind, q!.fake as string) === null) bad(`pairs[${i}]`);
    if (same && (mode === 'random' ? ALWAYS_CHANGED_RANDOM : ALWAYS_CHANGED).has(kind)) bad(`pairs[${i}]`);
  });
}

/**
 * Amount and date pairs whose fake an earlier pair of the same kind with a
 * different real value already holds. Unblind restores the earlier value for
 * both, so such a text does not come back exactly. Blind gives each spelling
 * of an amount or a date its own fake, so this stays empty unless every
 * rendering of one was taken. In `placeholder` mode a pair collides when its
 * placeholder is also a literal the input already held (`mapping.literals`).
 */
export function collisions(mapping: Mapping): Collision[] {
  if ((mapping.replaceWith ?? 'fake') === 'placeholder') {
    const held = new Set(mapping.literals ?? []);
    const out: Collision[] = [];
    mapping.pairs.forEach((p, index) => {
      if (held.has(p.fake.toUpperCase())) out.push({ kind: p.kind, index });
    });
    return out;
  }
  const realOf = new Map<string, string>();
  const out: Collision[] = [];
  mapping.pairs.forEach((p, index) => {
    if (p.kind !== 'date' && p.kind !== 'amount') return;
    const key = `${p.kind}|${p.fake}`;
    const real = realOf.get(key);
    if (real === undefined) realOf.set(key, p.real);
    else if (real !== p.real) out.push({ kind: p.kind, index });
  });
  return out;
}
