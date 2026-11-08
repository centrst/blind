/**
 * Scoring shared by scripts/bench/score.ts (blind's corpus) and scripts/bench/score-gretel.ts
 * (the Gretel sample). Both score every tool the same way: strict recall through `survives`
 * from test/support/corpus.ts, and precision as the share of replaced spans that overlap an
 * annotation of the same kind.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { blind } from '../../src/index.js';
import type { Detector } from '../../src/types.js';
import { FIXED_NOW, required, resolvedSpans, ROOT, SCORED_KINDS, scoreCorpus, survives, type CorpusFile, type ScoredKind } from '../../test/support/corpus.js';

// ------------------------------------------------------------------ input

/** One replaced span from presidio.py or llm_guard.py, in UTF-16 offsets of the input text. */
export interface ExtSpan {
  start: number;
  end: number;
  entity: string;
  score?: number;
  placeholder?: string;
}
export interface ExtFile {
  anonymized: string;
  replaced: ExtSpan[];
  /** llm_guard.py only: Deanonymize with the file's vault gave back the input exactly. */
  roundTrip?: boolean;
  /** llm_guard.py only: placeholders that stand for two or more different values. */
  collapsedPlaceholders?: string[];
  /** llm_guard.py only: edits outside any placeholder, null when there were none. */
  outsideChanges?: unknown[] | null;
  seconds?: number;
}
export interface Raw {
  meta: Record<string, unknown> & { versions: Record<string, string> };
  configs: Record<string, { seconds: number; secondsPerFile?: number; files: Record<string, ExtFile> }>;
}

export const readRaw = (path: string): Raw | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Raw) : null);

/**
 * Presidio and LLM Guard entity types onto blind's kinds. The first block is Presidio's, the
 * second the names only LLM Guard returns: its regex patterns (`*_RE`, UUID, BTC_ADDRESS) and
 * the Presidio recognizers it loads for every country. Left out on purpose, so they count only
 * in "any kind": NRP (nationality, religious or political group), TIME_RE (clock times) and
 * HEX_COLOR. blind has no such kinds and neither dataset scores them as one.
 */
export const ENTITY_TO_KIND: Record<string, ScoredKind> = {
  PERSON: 'person',
  ORGANIZATION: 'org',
  LOCATION: 'place',
  EMAIL_ADDRESS: 'email',
  URL: 'url',
  PHONE_NUMBER: 'phone',
  IBAN_CODE: 'iban',
  DATE_TIME: 'date',
  CREDIT_CARD: 'id',
  CRYPTO: 'id',
  IP_ADDRESS: 'id',
  MAC_ADDRESS: 'id',
  MEDICAL_LICENSE: 'id',
  US_SSN: 'id',
  US_ITIN: 'id',
  US_PASSPORT: 'id',
  US_DRIVER_LICENSE: 'id',
  US_BANK_NUMBER: 'id',
  UK_NHS: 'id',
  ES_NIF: 'id',
  ES_NIE: 'id',
  // LLM Guard
  EMAIL_ADDRESS_RE: 'email',
  URL_RE: 'url',
  PHONE_NUMBER_WITH_EXT: 'phone',
  DATE_RE: 'date',
  PRICE_RE: 'amount',
  PO_BOX_RE: 'place',
  CREDIT_CARD_RE: 'id',
  US_SSN_RE: 'id',
  UUID: 'id',
  BTC_ADDRESS: 'id',
  UK_NINO: 'id',
  AU_ABN: 'id',
  AU_ACN: 'id',
  AU_MEDICARE: 'id',
  AU_TFN: 'id',
  IN_AADHAAR: 'id',
  IN_PAN: 'id',
  IN_PASSPORT: 'id',
  IN_VEHICLE_REGISTRATION: 'id',
  IN_VOTER: 'id',
  SG_NRIC_FIN: 'id',
};

// ---------------------------------------------------------------- scoring

export const pct = (a: number, b: number): number | null => (b === 0 ? null : Math.round((a / b) * 10000) / 100);

export interface KindRow {
  annotated: number;
  survivors: number;
  recall: number | null;
  replaced: number;
  correct: number;
  precision: number | null;
}
export interface Card {
  files: number;
  perKind: Record<ScoredKind, KindRow>;
  /** Every replaced span, any kind, and the share that overlaps some annotation. */
  anyKind: { replaced: number; overlapping: number; precision: number | null };
  unmapped: Record<string, number>;
}
export type BlindCard = Card & { roundTrip: { ok: number; total: number } };

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }): boolean => a.start < b.end && b.start < a.end;

type Acc = Record<ScoredKind, { annotated: number; survivors: number; replaced: number; correct: number }>;

export function emptyAcc(): Acc {
  return Object.fromEntries(SCORED_KINDS.map((k) => [k, { annotated: 0, survivors: 0, replaced: 0, correct: 0 }])) as Acc;
}

export function finish(n: number, acc: Acc, any: { replaced: number; overlapping: number }, unmapped: Record<string, number>): Card {
  const perKind = Object.fromEntries(
    SCORED_KINDS.map((k) => {
      const a = acc[k];
      return [k, { ...a, recall: pct(a.annotated - a.survivors, a.annotated), precision: pct(a.correct, a.replaced) }];
    }),
  ) as Record<ScoredKind, KindRow>;
  return { files: n, perKind, anyKind: { ...any, precision: pct(any.overlapping, any.replaced) }, unmapped };
}

/**
 * A tool that writes placeholders (Presidio, LLM Guard), scored the way scoreCorpus scores
 * blind in bare mode. Annotations whose kind is not a scored kind are skipped in the per-kind
 * rows and still count as an overlap for "any kind".
 */
export function scoreExternal(subset: CorpusFile[], get: (f: CorpusFile) => ExtFile | undefined, what: string): Card {
  const acc = emptyAcc();
  const any = { replaced: 0, overlapping: 0 };
  const unmapped: Record<string, number> = {};
  for (const f of subset) {
    const p = get(f);
    if (!p) throw new Error(`${what} has no result for ${f.name}`);
    const { spans } = f.parsed;
    for (const sp of spans) {
      const a = acc[sp.kind as ScoredKind];
      if (!a) continue;
      a.annotated++;
      if (survives(sp.kind, sp.value, p.anonymized)) a.survivors++;
    }
    for (const r of p.replaced) {
      any.replaced++;
      if (spans.some((s) => overlaps(s, r))) any.overlapping++;
      const k = ENTITY_TO_KIND[r.entity];
      if (!k) {
        unmapped[r.entity] = (unmapped[r.entity] ?? 0) + 1;
        continue;
      }
      acc[k].replaced++;
      if (spans.some((s) => s.kind === k && overlaps(s, r))) acc[k].correct++;
    }
  }
  return finish(subset.length, acc, any, unmapped);
}

/** Extra detectors for one file, as scoreCorpus takes them. */
export type Extra = (f: CorpusFile) => Detector[];

/** blind through the corpus scorer, plus the any-kind precision the scorer does not report. */
export function scoreBlind(subset: CorpusFile[], mode: 'bare' | 'known', extra?: Extra): BlindCard {
  const card = scoreCorpus(subset, mode, extra);
  const any = { replaced: 0, overlapping: 0 };
  for (const f of subset) {
    const found = resolvedSpans(f.parsed.text, mode === 'known' ? f.parsed.known : [], f.parsed.dateOrder, extra?.(f) ?? []);
    for (const r of found) {
      any.replaced++;
      if (f.parsed.spans.some((s) => overlaps(s, r))) any.overlapping++;
    }
  }
  const acc = emptyAcc();
  for (const k of SCORED_KINDS) {
    const s = card.perKind[k];
    acc[k] = { annotated: s.annotated, survivors: s.survivors, replaced: s.replaced, correct: s.correct };
  }
  return { ...finish(subset.length, acc, any, {}), roundTrip: { ok: card.roundTrip.ok, total: card.roundTrip.total } };
}

/** Files where one placeholder stands for two or more different values, so no side table could map an answer back. */
export function collapsedPlaceholders(subset: CorpusFile[], get: (f: CorpusFile) => ExtFile | undefined): { files: number; filesWithReplacements: number } {
  let n = 0;
  let withAny = 0;
  for (const f of subset) {
    const p = get(f) as ExtFile;
    if (p.replaced.length) withAny++;
    const seen = new Map<string, Set<string>>();
    for (const r of p.replaced) {
      // Presidio's replace operator writes <ENTITY> for every value; LLM Guard numbers them.
      const key = r.placeholder ?? r.entity;
      const s = seen.get(key) ?? new Set<string>();
      s.add(f.parsed.text.slice(r.start, r.end).toLowerCase());
      seen.set(key, s);
    }
    if ([...seen.values()].some((s) => s.size > 1)) n++;
  }
  return { files: n, filesWithReplacements: withAny };
}

/**
 * A diagnostic, not the recall: the share of annotations whose letters (person, org, place),
 * digits (amount) or letters and digits (the rest) all sit inside replaced spans, the rule
 * scoreCorpus uses for its `coverage`. Strict recall counts a value as gone once it no longer
 * shows as a whole word, so a tool that replaces part of a word or part of an address scores
 * a hit there and a miss here.
 */
export function coverage(subset: CorpusFile[], replaced: (f: CorpusFile) => Array<{ start: number; end: number }>): Record<ScoredKind, { annotated: number; covered: number; pct: number | null }> {
  const acc = Object.fromEntries(SCORED_KINDS.map((k) => [k, { annotated: 0, covered: 0 }])) as Record<ScoredKind, { annotated: number; covered: number }>;
  for (const f of subset) {
    const covered = new Set<number>();
    for (const r of replaced(f)) for (let i = r.start; i < r.end; i++) covered.add(i);
    for (const sp of f.parsed.spans) {
      const a = acc[sp.kind as ScoredKind];
      if (!a) continue;
      a.annotated++;
      if (required(sp.kind, sp.value, sp.start).every((i) => covered.has(i))) a.covered++;
    }
  }
  return Object.fromEntries(SCORED_KINDS.map((k) => [k, { ...acc[k], pct: pct(acc[k].covered, acc[k].annotated) }])) as Record<ScoredKind, { annotated: number; covered: number; pct: number | null }>;
}

/** Spans blind replaces in bare mode, for `coverage`. */
export const blindSpans = (extra?: Extra) => (f: CorpusFile) => resolvedSpans(f.parsed.text, [], f.parsed.dateOrder, extra?.(f) ?? []);

/** Milliseconds per file for one `blind` call in bare mode. With a prepared NER detector this leaves out the model time. */
export function timeBlind(subset: CorpusFile[], extra?: Extra): number {
  const t0 = performance.now();
  for (const f of subset) blind([f.parsed.text], { seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: extra?.(f) ?? [] });
  return Math.round(((performance.now() - t0) / Math.max(1, subset.length)) * 10) / 10;
}

// ------------------------------------------------------------------ NER

/** The GLiNER model directory, as in ner/test/support.ts: $BLIND_NER_MODEL, else the default model. */
export const MODEL_DIR = process.env.BLIND_NER_MODEL ?? join(ROOT, 'ner', 'models', 'gliner_multi-v2.1');
export const MODEL_FILE = 'onnx/model.onnx';
/** The detector's own default in ner/src/detector.ts. Every + GLiNER column uses it unless it names another. */
export const NER_THRESHOLD = 0.3;
/** GLiNER's cache keeps spans down to this score, and each run filters to its own threshold (see ner/scripts/eval.ts). */
const CACHE_FLOOR = 0.2;

interface RawEntityLike {
  start: number;
  end: number;
  label: string;
  score: number;
}
interface NerBackendLike {
  predict(text: string, labels: string[], opts?: { threshold?: number }): Promise<RawEntityLike[]>;
}
interface NerModule {
  GlinerModel: { load(dir: string, opts: { file: string }): Promise<NerBackendLike> };
  TokenClassifierModel: { load(dir: string, opts: { file: string }): Promise<NerBackendLike> };
  createNerDetector(backend: NerBackendLike, opts: { threshold?: number; labels?: Record<string, string> }): { prepare(texts: string[]): Promise<Detector> };
}

/** A token-classification model to score beside GLiNER, from `--tc <name>=<dir>[,<file>[,<threshold>]]`. */
export interface TcSpec {
  name: string;
  dir: string;
  file: string;
  threshold: number;
}

/**
 * Every `--tc` argument. File defaults to onnx/model.onnx and threshold to the detector default,
 * 0.3. The directory is relative to the repository root.
 *   --tc "DeBERTa=ner/models/blind-ner-deberta-full" --tc "DeBERTa int8=ner/models/blind-ner-deberta-full,onnx/model_int8.onnx"
 */
export function tcSpecs(argv: string[] = process.argv): TcSpec[] {
  const out: TcSpec[] = [];
  argv.forEach((a, i) => {
    if (a !== '--tc') return;
    const v = argv[i + 1] ?? '';
    const eq = v.indexOf('=');
    if (eq <= 0) throw new Error(`--tc wants <name>=<dir>[,<file>[,<threshold>]], got ${v}`);
    const [dir, file, threshold] = v.slice(eq + 1).split(',');
    out.push({ name: v.slice(0, eq), dir: resolve(ROOT, dir as string), file: file || MODEL_FILE, threshold: threshold ? Number(threshold) : NER_THRESHOLD });
  });
  return out;
}

/** The value after the last `--name`, or the default. The last wins, so a pnpm script's own flag can be overridden. */
export const argValue = (name: string, d: string, argv: string[] = process.argv): string => {
  const i = argv.lastIndexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : d;
};

interface DetectorSpec {
  backend: 'gliner' | 'tc';
  dir: string;
  file: string;
  threshold: number;
  /** Labels sent to the model per kind, over the detector's defaults. */
  labels?: Record<string, string>;
  /**
   * When set, the model runs once at this score and each call keeps the spans at its own
   * threshold. Only for a decoder where that gives the same spans as running at the threshold.
   * Without it the cache holds the spans of one threshold.
   */
  floor?: number;
  cacheName: string;
}

/**
 * Prepares one NER detector per file, the way ner/scripts/eval.ts and ner/test/model.test.ts do.
 * The import goes through a URL so the root typecheck does not pull the ner package in.
 * Model output is cached in .local/ under `cacheName`, keyed by labels and text, so a rerun
 * skips inference. The cache holds only what the model returned: the detector, name propagation
 * and blind itself run live on every call.
 * Returns null when the model file is missing.
 */
async function loadDetector(files: CorpusFile[], spec: DetectorSpec): Promise<{ extra: Extra; meta: Record<string, unknown> } | null> {
  if (!existsSync(join(spec.dir, spec.file))) return null;
  const ner = (await import(pathToFileURL(join(ROOT, 'ner', 'src', 'index.ts')).href)) as NerModule;
  const cacheDir = join(ROOT, '.local');
  mkdirSync(cacheDir, { recursive: true });
  const cachePath = join(cacheDir, spec.cacheName);
  const cache: Record<string, RawEntityLike[]> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
  const model = await (spec.backend === 'gliner' ? ner.GlinerModel : ner.TokenClassifierModel).load(spec.dir, { file: spec.file });
  const { floor } = spec;
  let calls = 0;
  let ms = 0;
  const backend: NerBackendLike = {
    async predict(text, labels, o) {
      const key = createHash('sha1').update(`${labels.join(',')}|${text}`).digest('hex');
      let r = cache[key];
      if (!r) {
        const t0 = performance.now();
        r = await model.predict(text, labels, floor === undefined ? o : { ...o, threshold: floor });
        ms += performance.now() - t0;
        calls++;
        cache[key] = r;
      }
      if (floor === undefined) return r;
      const t = o?.threshold ?? spec.threshold;
      return r.filter((e) => e.score >= t);
    },
  };
  const det = ner.createNerDetector(backend, { threshold: spec.threshold, ...(spec.labels ? { labels: spec.labels } : {}) });
  const prepared = new Map<string, Detector>();
  const t0 = performance.now();
  for (const f of files) prepared.set(f.name, await det.prepare([f.parsed.text]));
  const prepareMs = performance.now() - t0;
  writeFileSync(cachePath, JSON.stringify(cache));
  return {
    extra: (f) => [prepared.get(f.name) as Detector],
    meta: {
      model: basename(spec.dir),
      backend: spec.backend,
      dir: spec.dir.startsWith(ROOT) ? spec.dir.slice(ROOT.length + 1) : spec.dir,
      file: spec.file,
      threshold: spec.threshold,
      labels: spec.labels ?? null,
      cacheFloor: floor ?? null,
      modelCalls: calls,
      // Model time per uncached call. A rerun on cached output reports zero calls.
      msPerCall: calls ? Math.round(ms / calls) : null,
      prepareMsPerFile: Math.round(prepareMs / Math.max(1, files.length)),
    },
  };
}

/**
 * GLiNER, from `dir` (default MODEL_DIR), at the detector default threshold unless one is named,
 * with optional label overrides. Cached at CACHE_FLOOR: greedyFlat keeps spans in score order, so
 * the spans above a higher threshold decide among themselves and filtering is exact.
 * Null when the weights are not in the model directory.
 */
export function loadNer(files: CorpusFile[], opts: { dir?: string; threshold?: number; labels?: Record<string, string> } = {}): Promise<{ extra: Extra; meta: Record<string, unknown> } | null> {
  const dir = opts.dir ?? MODEL_DIR;
  const threshold = opts.threshold ?? NER_THRESHOLD;
  const floor = Math.min(CACHE_FLOOR, threshold);
  return loadDetector(files, { backend: 'gliner', dir, file: MODEL_FILE, threshold, floor, cacheName: `bench-ner-cache-${basename(dir)}-floor${floor}.json`, ...(opts.labels ? { labels: opts.labels } : {}) });
}

/**
 * A token-classification model from `--tc`. Cached per threshold, not at a floor: its BIO decoder
 * joins neighbouring words above the threshold into one span and scores the span by their mean,
 * so a lower threshold can lengthen a span or merge two, and filtering those spans by score does
 * not give back the spans of a higher threshold. Null when its files are missing.
 */
export function loadTc(files: CorpusFile[], spec: TcSpec): Promise<{ extra: Extra; meta: Record<string, unknown> } | null> {
  const cacheName = `bench-tc-cache-${basename(spec.dir)}-${basename(spec.file, '.onnx')}-${spec.threshold}.json`;
  return loadDetector(files, { backend: 'tc', dir: spec.dir, file: spec.file, threshold: spec.threshold, cacheName });
}

// ------------------------------------------------------------------ print

export const cell = (n: number | null | undefined): string => (n === null || n === undefined ? 'n/a' : `${n.toFixed(1)}%`);
