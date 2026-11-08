/**
 * A BIO token-classification runner on ONNX Runtime, in process, beside the GLiNER one.
 *
 * It runs the mdeberta-v3-base model trained by `ner/train/` (see ner/TRAINED.md), and any
 * model exported the same way: `onnx/model.onnx` with inputs `input_ids` and `attention_mask`
 * and output `logits` [batch, tokens, labels], `tokenizer.json`, `tokenizer_config.json` and
 * `labels.json`. Words come from the same Unicode splitter as GLiNER (`splitWords`), each word
 * is tokenized on its own, and a word's label is read from its first sub-token. That is how the
 * model was trained, so the two sides see the same words and the same windows.
 *
 * It returns the same `RawEntity` spans as `GlinerModel`, so `createNerDetector` takes it unchanged.
 * Nothing here touches the network. Files are read from a local directory.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Tokenizer } from '@huggingface/tokenizers';
import type * as Ort from 'onnxruntime-node';
import { loadOrt, splitWords, type OrtModule, type RawEntity } from './gliner.js';

export interface TokenClassifierOptions {
  /** ONNX file inside the model directory. Default `onnx/model.onnx` (fp32); `onnx/model_int8.onnx` is the quantized one. */
  file?: string;
  /** ONNX Runtime intra-op threads. Default: the runtime's choice. */
  threads?: number;
}

export interface TokenClassifierPredictOptions {
  /**
   * A word is part of an entity when its probability of not being O is at least this. Default 0.5,
   * which is close to taking the most likely label. Lower finds more, higher finds less.
   */
  threshold?: number;
}

/** What `labels.json` holds. Written by ner/train/export.py. */
export interface LabelFile {
  /** Label per output index: `O`, then `B-<kind>` and `I-<kind>` per kind. */
  labels: string[];
  maxLen: number;
  strideWords: number;
  special: { cls: number; sep: number; pad: number; unk: number };
}

/**
 * Word ranges [from, to) whose tokens fit `budget`, overlapping by up to `stride` words.
 * The same rule as `windows` in ner/train/words.py. A single word longer than the budget gets a
 * window of its own and is cut to the budget.
 */
export function planWindows(tokenCounts: number[], budget: number, stride: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let from = 0; from < tokenCounts.length; ) {
    let used = 0;
    let to = from;
    while (to < tokenCounts.length && used + (tokenCounts[to] as number) <= budget) used += tokenCounts[to++] as number;
    if (to === from) to = from + 1;
    out.push([from, to]);
    if (to >= tokenCounts.length) break;
    from = Math.max(from + 1, to - stride);
  }
  return out;
}

/**
 * Word spans from per-word label probabilities. The same rule as `decode` in ner/train/train.py:
 * a word is in an entity when 1 - P(O) >= threshold, its kind is the one with the highest B + I
 * probability, and a span starts at a B, at a change of kind, or after an O. The score of a span
 * is the mean of 1 - P(O) over its words.
 */
export function decodeBio(probs: Float32Array[], labels: string[], threshold: number): Array<{ from: number; to: number; kind: string; score: number }> {
  const kinds: Array<{ kind: string; b: number; i: number }> = [];
  labels.forEach((l, idx) => {
    if (!l.startsWith('B-')) return;
    const kind = l.slice(2);
    const i = labels.indexOf(`I-${kind}`);
    if (i >= 0) kinds.push({ kind, b: idx, i });
  });
  const o = labels.indexOf('O');
  const out: Array<{ from: number; to: number; kind: string; scores: number[] }> = [];
  let cur: { from: number; to: number; kind: string; scores: number[] } | null = null;
  probs.forEach((p, w) => {
    const ent = 1 - (p[o] as number);
    if (ent < threshold) {
      cur = null;
      return;
    }
    let best = -1;
    let kind = '';
    let tag: 'B' | 'I' = 'B';
    for (const k of kinds) {
      const b = p[k.b] as number;
      const i = p[k.i] as number;
      if (b + i > best) {
        best = b + i;
        kind = k.kind;
        tag = b >= i ? 'B' : 'I';
      }
    }
    if (cur && tag === 'I' && cur.kind === kind) {
      cur.to = w + 1;
      cur.scores.push(ent);
    } else {
      cur = { from: w, to: w + 1, kind, scores: [ent] };
      out.push(cur);
    }
  });
  return out.map((s) => ({ from: s.from, to: s.to, kind: s.kind, score: s.scores.reduce((a, b) => a + b, 0) / s.scores.length }));
}

function softmax(logits: Float32Array, at: number, n: number): Float32Array {
  const out = new Float32Array(n);
  let max = -Infinity;
  for (let c = 0; c < n; c++) max = Math.max(max, logits[at + c] as number);
  let sum = 0;
  for (let c = 0; c < n; c++) sum += out[c] = Math.exp((logits[at + c] as number) - max);
  for (let c = 0; c < n; c++) out[c] = (out[c] as number) / sum;
  return out;
}

export class TokenClassifierModel {
  private constructor(
    private readonly ort: OrtModule,
    private readonly session: Ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly meta: LabelFile,
  ) {}

  /** Loads a model directory with `labels.json`, `tokenizer.json`, `tokenizer_config.json` and the ONNX file. */
  static async load(dir: string, opts: TokenClassifierOptions = {}): Promise<TokenClassifierModel> {
    const json = (f: string): any => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const meta = json('labels.json') as LabelFile;
    const tokenizer = new Tokenizer(json('tokenizer.json'), json('tokenizer_config.json'));
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(join(dir, opts.file ?? 'onnx/model.onnx'), {
      executionProviders: ['cpu'],
      ...(opts.threads ? { intraOpNumThreads: opts.threads } : {}),
    });
    return new TokenClassifierModel(ort, session, tokenizer, meta);
  }

  /** The entity kinds the model was trained on, as label names: `person`, `organization`, `location`. */
  get kinds(): string[] {
    return this.meta.labels.filter((l) => l.startsWith('B-')).map((l) => l.slice(2));
  }

  /**
   * Entities for one text, for the kinds named in `labels`. The model's kinds are fixed at
   * training time, so a label it does not know is ignored. Spans never overlap.
   */
  async predict(text: string, labels: string[], opts: TokenClassifierPredictOptions = {}): Promise<RawEntity[]> {
    const threshold = opts.threshold ?? 0.5;
    const words = splitWords(text);
    if (words.length === 0) return [];
    const { cls, sep, unk } = this.meta.special;
    const budget = this.meta.maxLen - 2;
    const wordIds = words.map((w) => {
      const ids = this.tokenizer.encode(w.text, { add_special_tokens: false }).ids as number[];
      return ids.length ? ids : [unk];
    });
    const n = this.meta.labels.length;
    const probs: Float32Array[] = new Array(words.length);
    const margin = new Array<number>(words.length).fill(-1);
    for (const [a, b] of planWindows(wordIds.map((x) => x.length), budget, this.meta.strideWords)) {
      const ids: number[] = [cls];
      const firsts: number[] = [];
      for (let i = a; i < b; i++) {
        const pieces = b - a === 1 ? (wordIds[i] as number[]).slice(0, budget) : (wordIds[i] as number[]);
        firsts.push(ids.length);
        ids.push(...pieces);
      }
      ids.push(sep);
      const big = BigInt64Array.from(ids, (x) => BigInt(x));
      const out = await this.session.run({
        input_ids: new this.ort.Tensor('int64', big, [1, ids.length]),
        attention_mask: new this.ort.Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]),
      });
      const logits = out['logits']!.data as Float32Array;
      firsts.forEach((t, j) => {
        const w = a + j;
        // A word in two windows keeps the one where it sits furthest from an edge.
        const m = Math.min(w - a, b - 1 - w);
        if (m > (margin[w] as number)) {
          margin[w] = m;
          probs[w] = softmax(logits, t * n, n);
        }
      });
    }
    const wanted = new Set(labels);
    return decodeBio(probs, this.meta.labels, threshold)
      .filter((s) => wanted.has(s.kind))
      .map((s) => ({ start: words[s.from]!.start, end: words[s.to - 1]!.end, label: s.kind, score: s.score }));
  }
}
