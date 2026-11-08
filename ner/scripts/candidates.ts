/**
 * Prints the tables in ner/CANDIDATES.md from the runs in reports/candidates/.
 *   tsx ner/scripts/candidates.ts [reports/candidates]
 * Each run is `pnpm ner:eval` (corpus-<model>-<t>.json) or `score-gretel.ts --ner-only`
 * (gretel-<model>-<t>.json). The threshold rule is fixed here, before any candidate was scored:
 * on Gretel half-a, the highest mean F1 over person, org and place, ties to the lower
 * threshold. The tables report Gretel half-b, which the rule never sees, and the full corpus.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const KINDS = ['person', 'org', 'place'] as const;
type Kind = (typeof KINDS)[number];
interface Row { recall: number | null; precision: number | null }
type Cells = Record<Kind, Row>;

const dir = process.argv[2] ?? join(import.meta.dirname, '..', '..', 'reports', 'candidates');
const modelsDir = join(import.meta.dirname, '..', 'models');
const runs = readdirSync(dir).filter((f) => /^(corpus|gretel)-.+-\d(\.\d+)?\.json$/.test(f));
const parse = (f: string): { set: string; model: string; t: number } => {
  const m = /^(corpus|gretel)-(.+)-(\d(?:\.\d+)?)\.json$/.exec(f) as RegExpExecArray;
  return { set: m[1] as string, model: m[2] as string, t: Number(m[3]) };
};
const read = (f: string): any => JSON.parse(readFileSync(join(dir, f), 'utf8'));

const corpus = new Map<string, Map<number, { cells: Cells; ms: number | null }>>();
const gretel = new Map<string, Map<number, { a: Cells; b: Cells; all: Cells; en: Cells; es: Cells; ms: number | null }>>();
const pick = (perKind: any): Cells => Object.fromEntries(KINDS.map((k) => [k, { recall: perKind[k].recall, precision: perKind[k].precision }])) as Cells;
for (const f of runs) {
  const { set, model, t } = parse(f);
  const r = read(f);
  if (set === 'corpus') {
    const m = corpus.get(model) ?? new Map();
    m.set(t, { cells: pick(r.bare.ner.perKind), ms: r.corpus_model_ms_per_file ?? null });
    corpus.set(model, m);
  } else {
    const g = r.results['blind:bare+gliner'];
    const m = gretel.get(model) ?? new Map();
    m.set(t, { a: pick(g.cards['half-a'].perKind), b: pick(g.cards['half-b'].perKind), all: pick(g.cards.all.perKind), en: pick(g.cards.en.perKind), es: pick(g.cards.es.perKind), ms: r.gliner?.msPerCall ?? null });
    gretel.set(model, m);
  }
}

const f1 = (c: Row): number => {
  const p = c.precision ?? 0;
  const r = c.recall ?? 0;
  return p + r === 0 ? 0 : (2 * p * r) / (p + r);
};
const meanF1 = (c: Cells): number => KINDS.reduce((s, k) => s + f1(c[k]), 0) / KINDS.length;
const fmt = (n: number | null): string => (n === null ? 'n/a' : n.toFixed(1));
/** Model time comes from the one uncached run per model and dataset. */
const msOf = (m: Map<number, { ms: number | null }>): number | null => [...m.values()].map((v) => v.ms).find((v) => v !== null) ?? null;

// Baseline first, then the candidates in the order of CANDIDATES.md, each label variant after its model.
const ORDER = ['gliner_multi-v2.1', 'gliner_multi_pii-v1', 'gliner-multi-pii-domains-v1', 'gliner-pii-base-v1.0'];
const rank = (k: string): number => {
  const i = ORDER.indexOf(k.split('+')[0] as string);
  return (i < 0 ? ORDER.length : i) * 2 + (k.includes('+') ? 1 : 0);
};
const byRank = (a: string, b: string): number => rank(a) - rank(b) || a.localeCompare(b);
const entries = <V>(m: Map<string, V>): Array<[string, V]> => [...m.entries()].sort((a, b) => byRank(a[0], b[0]));

const chosen = new Map<string, number>();
for (const [model, m] of gretel) {
  const best = [...m.entries()].sort((x, y) => meanF1(y[1].a) - meanF1(x[1].a) || x[0] - y[0])[0] as [number, unknown];
  chosen.set(model, best[0]);
}

const header = '| model | threshold | person R | person P | org R | org P | place R | place P | mean F1 | ms per file |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const line = (model: string, t: number, c: Cells, ms: number | null): string =>
  `| ${model} | ${t}${chosen.get(model) === t ? ' (chosen)' : ''} | ${KINDS.map((k) => `${fmt(c[k].recall)} | ${fmt(c[k].precision)}`).join(' | ')} | ${(meanF1(c)).toFixed(1)} | ${fmt(ms)} |`;

console.log('Blind corpus, 379 files, bare mode, strict recall and same-kind precision, %\n');
console.log(header);
for (const [model, m] of entries(corpus)) for (const t of [...m.keys()].sort()) console.log(line(model, t, (m.get(t) as { cells: Cells }).cells, msOf(m)));

console.log('\nGretel half-b, 444 files (222 en, 222 es), the half the threshold rule did not see, %\n');
console.log(header);
for (const [model, m] of entries(gretel)) for (const t of [...m.keys()].sort()) console.log(line(model, t, (m.get(t) as { b: Cells }).b, msOf(m)));

console.log('\nGretel half-a, 444 files, the tuning half (mean F1 picks the threshold), %\n');
console.log(header);
for (const [model, m] of entries(gretel)) for (const t of [...m.keys()].sort()) console.log(line(model, t, (m.get(t) as { a: Cells }).a, msOf(m)));

console.log('\nGretel all 888 files at the chosen threshold, %\n');
console.log(header);
for (const [model, m] of entries(gretel)) {
  const t = chosen.get(model) as number;
  console.log(line(model, t, (m.get(t) as { all: Cells }).all, msOf(m)));
}

console.log('\nGretel by language, all 444 files of each, at the chosen threshold (both halves, so a diagnostic), %\n');
console.log(header.replace('| model |', '| model, language |'));
for (const [model, m] of entries(gretel)) {
  const t = chosen.get(model) as number;
  const v = m.get(t) as { en: Cells; es: Cells };
  for (const lang of ['en', 'es'] as const) console.log(line(`${model}, ${lang}`, t, v[lang], null));
}

console.log('\nModel size on disk (onnx/model.onnx, then the whole directory), MB\n');
const du = (p: string): number => {
  const s = statSync(p);
  return s.isDirectory() ? readdirSync(p).reduce((a, c) => a + du(join(p, c)), 0) : s.size;
};
// A run named <model>+<variant> used the same weights with other labels.
for (const model of new Set([...corpus.keys(), ...gretel.keys()].map((k) => k.split('+')[0] as string))) {
  const d = join(modelsDir, model);
  if (!existsSync(join(d, 'onnx', 'model.onnx'))) continue;
  console.log(`${model}: ${(du(join(d, 'onnx', 'model.onnx')) / 1e6).toFixed(0)} MB, directory ${(du(d) / 1e6).toFixed(0)} MB`);
}
