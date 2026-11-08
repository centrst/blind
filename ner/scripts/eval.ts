/**
 * Scores the corpus with and without the NER detector.
 *   tsx scripts/eval.ts [<model dir> | --model <dir>] [--file onnx/model.onnx] [--threshold 0.5] [--labels place=address] [--backend gliner|tc] [--out ../reports/ner-corpus.json]
 * The model directory defaults to $BLIND_NER_MODEL, then models/gliner_multi-v2.1.
 * `--backend tc` loads a token-classification model (ner/TRAINED.md) instead of GLiNER.
 * Model results are cached in .local/ so merge-logic changes rerun in seconds. For GLiNER the
 * cache holds every span scoring CACHE_FLOOR or more and each run keeps those at its own
 * threshold. That is the same as running the model at that threshold: greedyFlat keeps spans in
 * score order, so the spans above a higher threshold decide among themselves. The token
 * classifier's BIO decoder joins neighbouring words above the threshold into one span scored by
 * their mean, so a lower threshold can lengthen or merge spans. Its cache is per threshold.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Detector } from '@centrst/blind';
import { loadAdversarial, runCase } from '../../test/support/adversarial.js';
import { floorsFrom, loadCorpus, SCORED_KINDS, scoreCorpus, type CorpusFile, type Mode, type Scorecard } from '../../test/support/corpus.js';
import { createNerDetector, DEFAULT_LABELS, type NerBackend, type NerKind } from '../src/detector.js';
import { GlinerModel, type RawEntity } from '../src/gliner.js';
import { TokenClassifierModel } from '../src/token-classifier.js';

// The last occurrence wins, so `pnpm ner:eval --out x` overrides the script's own --out.
const arg = (name: string, d?: string): string | undefined => {
  const i = process.argv.lastIndexOf(name);
  return i >= 0 ? process.argv[i + 1] : d;
};
const VALUED = new Set(['--model', '--file', '--threshold', '--labels', '--backend', '--out']);
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !VALUED.has(all[i - 1] ?? ''));
const dir = arg('--model') ?? positional[0] ?? process.env.BLIND_NER_MODEL ?? join(import.meta.dirname, '..', 'models', 'gliner_multi-v2.1');
const file = arg('--file', 'onnx/model.onnx') as string;
const threshold = Number(arg('--threshold', '0.3'));
const out = arg('--out');
const backendKind = arg('--backend', 'gliner') as string;
if (backendKind !== 'gliner' && backendKind !== 'tc') throw new Error(`--backend wants gliner or tc, got ${backendKind}`);
// Only GLiNER's decoder lets one low-threshold run stand for every higher threshold (see above).
const CACHE_FLOOR = backendKind === 'gliner' ? Math.min(0.2, threshold) : null;
// Labels sent to the model per kind, over the defaults: `--labels place=address,org=company`.
const labels = Object.fromEntries((arg('--labels') ?? '').split(',').filter(Boolean).map((kv) => kv.split('=') as [NerKind, string]));

const localDir = join(import.meta.dirname, '..', '.local');
mkdirSync(localDir, { recursive: true });
const cachePath = join(localDir, CACHE_FLOOR === null ? `cache-${basename(dir)}-${basename(file)}-${threshold}.json` : `cache-${basename(dir)}-${basename(file)}-floor${CACHE_FLOOR}.json`);
const cache: Record<string, RawEntity[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const model: NerBackend = backendKind === 'tc' ? await TokenClassifierModel.load(dir, { file }) : await GlinerModel.load(dir, { file });
let modelMs = 0;
let modelCalls = 0;
const backend: NerBackend = {
  async predict(text, labels, o) {
    const key = createHash('sha1').update(`${labels.join(',')}|${text}`).digest('hex');
    let r = cache[key];
    if (!r) {
      const t0 = performance.now();
      r = await model.predict(text, labels, CACHE_FLOOR === null ? o : { ...o, threshold: CACHE_FLOOR });
      modelMs += performance.now() - t0;
      modelCalls++;
      cache[key] = r;
    }
    if (CACHE_FLOOR === null) return r;
    const t = o?.threshold ?? threshold;
    return r.filter((e) => e.score >= t);
  },
};

const files = loadCorpus();
const ner = createNerDetector(backend, { threshold, labels });
const prepared = new Map<string, Detector>();
for (const f of files) prepared.set(f.name, await ner.prepare([f.parsed.text]));
// Model time on the corpus files alone, before the shorter adversarial cases join the average.
const corpusModel = { ms: modelMs, calls: modelCalls };
writeFileSync(cachePath, JSON.stringify(cache));
const extra = (f: CorpusFile): Detector[] => [prepared.get(f.name) as Detector];

interface Row { recall: number; precision: number; annotated: number; survivors: number; replaced: number; correct: number }
function summarize(c: Scorecard): { perKind: Record<string, Row>; overall: { recall: number; annotated: number; survivors: number }; roundTrip: { ok: number; total: number; failures: string[] }; files: number } {
  const perKind: Record<string, Row> = {};
  let ann = 0;
  let surv = 0;
  for (const k of SCORED_KINDS) {
    const s = c.perKind[k];
    perKind[k] = { recall: s.recall, precision: s.precision, annotated: s.annotated, survivors: s.survivors, replaced: s.replaced, correct: s.correct };
    ann += s.annotated;
    surv += s.survivors;
  }
  return { perKind, overall: { recall: Math.round(((ann - surv) / ann) * 10000) / 100, annotated: ann, survivors: surv }, roundTrip: c.roundTrip, files: c.files };
}

const result: Record<string, unknown> = { model: basename(dir), backend: backendKind, file, threshold, labels: { ...DEFAULT_LABELS, ...labels } };
for (const mode of ['bare', 'known'] as Mode[]) {
  const t0 = performance.now();
  const base = scoreCorpus(files, mode);
  const baseSecs = (performance.now() - t0) / 1000;
  const t1 = performance.now();
  const withNer = scoreCorpus(files, mode, extra);
  const nerSecs = (performance.now() - t1) / 1000;
  const split: Record<string, unknown> = {};
  for (const lang of ['en', 'es', 'mixed']) {
    const sub = files.filter((f) => f.lang === lang);
    split[lang] = { files: sub.length, base: summarize(scoreCorpus(sub, mode)), ner: summarize(scoreCorpus(sub, mode, extra)) };
  }
  result[mode] = { base: summarize(base), ner: summarize(withNer), baseSecs, nerSecs, split };
}
// Adversarial set, with and without the detector.
const adv = loadAdversarial().flatMap((f) => f.cases.map((c) => ({ ...c, category: f.category })));
const advRows = [];
for (const c of adv) {
  const det = await ner.prepare([c.text]);
  const before = runCase(c).outcome;
  const after = runCase(c, [det]).outcome;
  advRows.push({ id: c.id, category: c.category, expect: c.expect, before, after });
}
writeFileSync(cachePath, JSON.stringify(cache));
const rank: Record<string, number> = { silent: 0, flagged: 1, replaced: 2 };
result.adversarial = {
  total: advRows.length,
  before: { replaced: advRows.filter((r) => r.before === 'replaced').length, flagged: advRows.filter((r) => r.before === 'flagged').length, silent: advRows.filter((r) => r.before === 'silent').length },
  after: { replaced: advRows.filter((r) => r.after === 'replaced').length, flagged: advRows.filter((r) => r.after === 'flagged').length, silent: advRows.filter((r) => r.after === 'silent').length },
  worse: advRows.filter((r) => (rank[r.after] as number) < (rank[r.before] as number)).map((r) => `${r.id} ${r.before}->${r.after}`),
  better: advRows.filter((r) => (rank[r.after] as number) > (rank[r.before] as number)).map((r) => `${r.id} ${r.before}->${r.after}`),
  rows: advRows,
};
if (process.argv.includes('--write-floors')) {
  const cards = { bare: scoreCorpus(files, 'bare', extra), known: scoreCorpus(files, 'known', extra) };
  const floors = { bare: floorsFrom(cards.bare), known: floorsFrom(cards.known), note: `NER mode: ${basename(dir)}, threshold ${threshold}. Rounded down to a whole percent, only move up.` };
  writeFileSync(join(import.meta.dirname, '..', '..', 'corpus', 'floors-ner.json'), `${JSON.stringify(floors, null, 2)}\n`);
  console.log('wrote corpus/floors-ner.json');
}
result.model_ms_per_file = modelCalls ? Math.round(modelMs / modelCalls) : null;
result.model_calls = modelCalls;
result.corpus_model_ms_per_file = corpusModel.calls ? Math.round((corpusModel.ms / corpusModel.calls) * 10) / 10 : null;
result.corpus_model_calls = corpusModel.calls;
if (out) writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);

for (const mode of ['bare', 'known']) {
  const r = (result as any)[mode];
  console.log(`\n${mode}: round trip base ${r.base.roundTrip.ok}/${r.base.roundTrip.total}, ner ${r.ner.roundTrip.ok}/${r.ner.roundTrip.total}; overall recall ${r.base.overall.recall} -> ${r.ner.overall.recall}`);
  console.log('kind     recall(base->ner)   precision(base->ner)  replaced');
  for (const k of ['person', 'org', 'place', 'email', 'phone', 'id', 'date', 'amount']) {
    const b = r.base.perKind[k];
    const n = r.ner.perKind[k];
    console.log(`${k.padEnd(8)} ${String(b.recall).padStart(6)} -> ${String(n.recall).padStart(6)}    ${String(b.precision).padStart(6)} -> ${String(n.precision).padStart(6)}   ${n.replaced}`);
  }
  for (const lang of ['en', 'es', 'mixed']) {
    const s = r.split[lang];
    console.log(`  ${lang}: recall ${s.base.overall.recall} -> ${s.ner.overall.recall}; person ${s.base.perKind.person.recall} -> ${s.ner.perKind.person.recall}; org ${s.base.perKind.org.recall} -> ${s.ner.perKind.org.recall}; place ${s.base.perKind.place.recall} -> ${s.ner.perKind.place.recall}`);
  }
  if (r.ner.roundTrip.failures.length) console.log('  round trip failures:', r.ner.roundTrip.failures.length, r.ner.roundTrip.failures.slice(0, 8).join(' '));
}
const a = (result as any).adversarial;
console.log(`\nadversarial ${a.total} cases: replaced ${a.before.replaced} -> ${a.after.replaced}, flagged ${a.before.flagged} -> ${a.after.flagged}, silent ${a.before.silent} -> ${a.after.silent}; worse: ${a.worse.join(', ') || 'none'}; better: ${a.better.join(', ') || 'none'}`);
console.log(`\nmodel: ${modelCalls} calls, ${modelCalls ? Math.round(modelMs / modelCalls) : 0} ms each; corpus files alone ${corpusModel.calls} calls, ${result.corpus_model_ms_per_file ?? 0} ms each (cached calls not counted)`);
