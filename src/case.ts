/**
 * Letter case. The casing habit of a value, a fake put in that habit, and
 * every other case of a fake, so a reply that changes the case still finds it.
 */

export const title = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1).toLowerCase() : s);

type Habit = 'none' | 'upper' | 'lower' | 'other';

/** ALL CAPS (two letters or more), all lower, anything else, or no letter case at all (digits, Chinese). */
export function habit(s: string): Habit {
  if (s.toUpperCase() === s.toLowerCase()) return 'none';
  if (s.length > 1 && s === s.toUpperCase()) return 'upper';
  if (s === s.toLowerCase()) return 'lower';
  return 'other';
}

/** Give `fake` the same casing habit as `orig`: ALL CAPS, all lower, or as written. */
export function adaptCase(orig: string, fake: string): string {
  const h = habit(orig);
  return h === 'upper' ? fake.toUpperCase() : h === 'lower' ? fake.toLowerCase() : fake;
}

/**
 * `adaptCase`, and word by word when `orig` mixes its habits and has as many
 * words as `fake`: "the Company" becomes "estival Servicios", so it is told
 * apart from "The Company".
 */
export function caseLike(orig: string, fake: string): string {
  if (habit(orig) !== 'other') return adaptCase(orig, fake);
  const ow = orig.trim().split(/\s+/);
  const fw = fake.split(' ');
  if (ow.length < 2 || ow.length !== fw.length) return fake;
  return fw.map((w, i) => adaptCase(ow[i] as string, w)).join(' ');
}

/**
 * `fake` first, then other letter cases of it: all lower, ALL CAPS, each word
 * capitalised, then one letter flipped at a time. Lower-cased they are all the
 * same fake, so a reply that changes the case still finds the value.
 */
export function* caseVariants(fake: string): Generator<string> {
  const seen = new Set<string>();
  const forms = [fake, fake.toLowerCase(), fake.toUpperCase(), fake.toLowerCase().replace(/(^|[\s.@-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())];
  for (let i = 0; i < fake.length; i++) {
    const c = fake[i] as string;
    const flip = c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase();
    if (flip !== c && flip.length === 1) forms.push(fake.slice(0, i) + flip + fake.slice(i + 1));
  }
  for (const f of forms) {
    if (seen.has(f)) continue;
    seen.add(f);
    yield f;
  }
  // Then every other capitalisation, so a value written in many cases still finds a free one.
  const cased = [...fake].map((c, i) => ({ c, i })).filter(({ c }) => c.toLowerCase() !== c.toUpperCase() && c.toUpperCase().length === 1);
  const chars = [...fake.toLowerCase()];
  if (chars.length !== [...fake].length || cased.length > 30) return;
  for (let mask = 1; mask < 2 ** cased.length; mask++) {
    const out = chars.slice();
    cased.forEach(({ i }, bit) => {
      if (mask & (2 ** bit)) out[i] = (out[i] as string).toUpperCase();
    });
    const f = out.join('');
    if (seen.has(f)) continue;
    seen.add(f);
    yield f;
  }
}

export const uniformToTitle = (t: string): string => (t === t.toLowerCase() || t === t.toUpperCase() ? title(t) : t);
