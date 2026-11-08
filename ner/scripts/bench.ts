/**
 * Throughput of blind with and without the NER detector, bare mode, one text per call.
 *   tsx --tsconfig ner/tsconfig.json ner/scripts/bench.ts [model dir] [--file onnx/model.onnx] [--backend gliner|tc] [--threads n] [--input reports/gretel-input.json]
 * Run it on a quiet machine. Nothing is cached. `--input` times the texts of a benchmark input
 * (scripts/bench/gretel_sample.py, ner/train/prepare.py evalsets) instead of the corpus.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blind, type Detector } from '@centrst/blind';
import { FIXED_NOW, loadCorpus } from '../../test/support/corpus.js';
import { createNerDetector, GlinerModel, TokenClassifierModel, type NerBackend } from '../src/index.js';

const arg = (name: string, d: string): string => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] as string) : d;
};
const dir = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : join(import.meta.dirname, '..', 'models', 'gliner_multi-v2.1');
const file = arg('--file', 'onnx/model.onnx');
const backendKind = arg('--backend', 'gliner');
const threads = Number(arg('--threads', '0')) || undefined;

const input = arg('--input', '');
const files = input
  ? (JSON.parse(readFileSync(input, 'utf8')) as { files: Array<{ name: string; text: string }> }).files.map((f) => ({ name: f.name, parsed: { text: f.text, dateOrder: 'dmy' as const } }))
  : loadCorpus();
const t0 = performance.now();
const model: NerBackend = backendKind === 'tc' ? await TokenClassifierModel.load(dir, { file, threads }) : await GlinerModel.load(dir, { file, threads });
const loadMs = performance.now() - t0;
const ner = createNerDetector(model);
await ner.prepare([files[0]!.parsed.text]); // warm-up

const words = files.reduce((n, f) => n + f.parsed.text.split(/\s+/).length, 0);
let t = performance.now();
for (const f of files) blind([f.parsed.text], { seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder });
const baseSecs = (performance.now() - t) / 1000;

const per: number[] = [];
const dets: Detector[] = [];
for (const f of files) {
  t = performance.now();
  dets.push(await ner.prepare([f.parsed.text]));
  per.push(performance.now() - t);
}
const modelSecs = per.reduce((a, b) => a + b, 0) / 1000;
t = performance.now();
files.forEach((f, i) => blind([f.parsed.text], { seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: [dets[i]!] }));
const coreSecs = (performance.now() - t) / 1000;

per.sort((a, b) => a - b);
const q = (p: number): number => Math.round(per[Math.floor(p * (per.length - 1))] as number);
const rss = Math.round(process.memoryUsage().rss / 1048576);
console.log(JSON.stringify({
  model: dir.split('/').pop(),
  file,
  backend: backendKind,
  input: input || 'corpus',
  files: files.length,
  words,
  model_load_s: Math.round(loadMs / 100) / 10,
  core_only_files_per_s: Math.round(files.length / baseSecs),
  model_ms_per_file: { p50: q(0.5), p95: q(0.95), max: q(1) },
  model_files_per_s: Math.round((files.length / modelSecs) * 10) / 10,
  end_to_end_files_per_s: Math.round((files.length / (modelSecs + coreSecs)) * 10) / 10,
  rss_mb: rss,
}, null, 1));
