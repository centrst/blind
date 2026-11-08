/**
 * Training emails for the token-classification model, from blind's own generator.
 *   tsx --tsconfig ner/tsconfig.json ner/scripts/gen-train-emails.ts [count] [out]
 * Reads .local/train/pools.json (`python -I ner/train/prepare.py pools`) and writes
 * .local/train/emails.jsonl, one {id, lang, category, text, spans} per line, UTF-16 offsets.
 *
 * Seeds are `ner-train-v1-<i>`, never the corpus's `corpus-v1-<i>`. The generator's name,
 * company and town pools are small (16 towns, 30 company words), and the corpus is drawn from
 * them, so a model trained on raw generator output would learn the corpus's names by heart.
 * Each email therefore has every pool word swapped, consistently within the email and inside
 * its addresses and domains, for a word from Nemotron's train split that appears in no corpus
 * annotation. The templates stay the same, which the write-up counts as home ground.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Rng } from '../../src/prng.js';
import { parseAnnotated } from '../../test/support/annotate.js';
import { loadCorpus, ROOT } from '../../test/support/corpus.js';
import { CATEGORIES, genEmail, type LangMode } from '../../test/support/templates.js';
import { FIRST_EN, FIRST_ES, LAST_EN, LAST_ES, ORG_BASE, PLACE_EN, PLACE_ES, plain } from '../../test/support/values.js';

const count = Number(process.argv[2] ?? 4200);
const out = process.argv[3] ?? join(ROOT, '.local', 'train', 'emails.jsonl');
const MODES: LangMode[] = ['en', 'es', 'es', 'mixed', 'en', 'es', 'mixed'];
const PARTICLES = new Set(['de', 'la', 'del', 'los', 'las']);

const pools = JSON.parse(readFileSync(join(ROOT, '.local', 'train', 'pools.json'), 'utf8')) as { first: string[]; last: string[]; orgBase: string[]; town: string[] };

// Every word of every person, org and place annotation in the 379 corpus files. No replacement may be one of them.
const corpusWords = new Set<string>();
for (const f of loadCorpus()) {
  for (const s of f.parsed.spans) if (s.kind === 'person' || s.kind === 'org' || s.kind === 'place') for (const w of s.value.split(/[^\p{L}]+/u)) if (w) corpusWords.add(plain(w));
}
const poolFirst = new Set([...FIRST_ES, ...FIRST_EN]);
const poolLast = new Set([...LAST_ES, ...LAST_EN].flatMap((l) => l.split(' ')).filter((t) => !PARTICLES.has(t)));
const poolOrg = new Set(ORG_BASE);
const poolPlaces = [...PLACE_ES, ...PLACE_EN].sort((a, b) => b.length - a.length);
const clean = (xs: string[]): string[] => xs.filter((x) => x.split(' ').every((w) => !corpusWords.has(plain(w))) && plain(x).replace(/-/g, '').length >= 3);
const fresh = { first: clean(pools.first), last: clean(pools.last), org: clean(pools.orgBase), town: clean(pools.town) };

const esc = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (t: string): RegExp => new RegExp(String.raw`(?<![\p{L}\p{N}])${esc(t)}(?![\p{L}\p{N}])`, 'gu');

/** Swaps every pool word in one annotated email. */
function swap(src: string, rng: Rng): string {
  const used = new Set<string>();
  const draw = (from: string[]): string => {
    for (;;) {
      const x = from[rng.int(from.length)] as string;
      if (!used.has(x)) {
        used.add(x);
        return x;
      }
    }
  };
  const map = new Map<string, string>();
  for (const p of poolPlaces) if (src.includes(p)) map.set(p, draw(fresh.town));
  for (const m of src.matchAll(/\p{L}+/gu)) {
    const t = m[0];
    if (map.has(t)) continue;
    if (poolFirst.has(t)) map.set(t, draw(fresh.first));
    else if (poolLast.has(t)) map.set(t, draw(fresh.last));
    else if (poolOrg.has(t)) map.set(t, draw(fresh.org));
  }
  let s = src;
  const pairs = [...map].sort((a, b) => b[0].length - a[0].length);
  for (const [from, to] of pairs) {
    s = s.replace(word(from), to);
    if (from.toUpperCase() !== from) s = s.replace(word(from.toUpperCase()), to.toUpperCase());
  }
  // Inside addresses, URLs and domains the generator writes the plain lower-case form, often glued to other letters.
  s = s.replace(/\S*(?:@|www\.|https?:|\.example)\S*/gu, (chunk) => {
    let c = chunk;
    for (const [from, to] of pairs) {
      const f = plain(from);
      if (f.length >= 3) c = c.split(f).join(plain(to));
      const f2 = f.replace(/-/g, '');
      if (f2 !== f && f2.length >= 3) c = c.split(f2).join(plain(to).replace(/-/g, ''));
    }
    return c;
  });
  return s;
}

mkdirSync(dirname(out), { recursive: true });
const lines: string[] = [];
let residual = 0;
for (let i = 0; i < count; i++) {
  const category = CATEGORIES[i % CATEGORIES.length]!;
  const mode = MODES[Math.floor(i / CATEGORIES.length) % MODES.length]!;
  const src = genEmail(new Rng(`ner-train-v1-${i}`), category, mode);
  const parsed = parseAnnotated(swap(src, new Rng(`ner-train-v1-${i}|swap`)));
  for (const sp of parsed.spans) {
    if (sp.kind !== 'person' && sp.kind !== 'org' && sp.kind !== 'place') continue;
    if (sp.value.split(/[^\p{L}]+/u).some((w) => w && corpusWords.has(plain(w)) && (poolFirst.has(w) || poolLast.has(w) || poolOrg.has(w)))) residual++;
  }
  lines.push(JSON.stringify({ id: `emails/${i}`, lang: mode, category, text: parsed.text, spans: parsed.spans.map((s) => ({ start: s.start, end: s.end, kind: s.kind })) }));
}
writeFileSync(out, `${lines.join('\n')}\n`);
console.log(`wrote ${count} emails to ${out}; pool words left in a person, org or place label: ${residual}`);
console.log(`replacement pools after dropping corpus words: first ${fresh.first.length}, last ${fresh.last.length}, org ${fresh.org.length}, town ${fresh.town.length}`);
