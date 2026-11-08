/**
 * A small GLiNER span-model runner on ONNX Runtime, in process.
 *
 * The `gliner` npm package was tried first and dropped. Its word splitter uses
 * an ASCII `\w`, so "Gestoría" becomes three words, and the Python reference
 * uses a Unicode `\w`. This file keeps the algorithm (prompt of entity labels,
 * word-level spans up to `max_width`, sigmoid scores, greedy flat decoding) and
 * fixes the splitter. It needs only onnxruntime-node and a pure-JS tokenizer.
 *
 * Nothing here touches the network. Files are read from a local directory.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BlindError } from '@centrst/blind';
import { Tokenizer } from '@huggingface/tokenizers';
import type * as Ort from 'onnxruntime-node';

/** The onnxruntime-node module. It loads its native binary when imported. */
export type OrtModule = typeof Ort;

/**
 * Imports onnxruntime-node when a model loads, not when this package loads, so
 * the package and its stub-backed parts still load on a platform that has no
 * onnxruntime-node binary.
 */
export function loadOrt(): Promise<OrtModule> {
  return import('onnxruntime-node');
}

export interface RawEntity {
  start: number;
  end: number;
  label: string;
  score: number;
}

export interface GlinerOptions {
  /** ONNX file inside the model directory. Default `onnx/model.onnx` (fp32). The int8 export finds nothing. */
  file?: string;
  /** ONNX Runtime intra-op threads. Default: the runtime's choice. */
  threads?: number;
}

export interface PredictOptions {
  /** Minimum sigmoid score for a span. Default 0.5. */
  threshold?: number;
}

interface Word {
  text: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}\p{N}\p{M}_]+(?:[-_][\p{L}\p{N}\p{M}_]+)*|\S/gu;

export function splitWords(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(WORD_RE)) out.push({ text: m[0], start: m.index!, end: m.index! + m[0].length });
  return out;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

export class GlinerModel {
  private constructor(
    private readonly ort: OrtModule,
    private readonly session: Ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly cfg: { maxWidth: number; maxLen: number; entToken: string; sepToken: string; cls: number; sep: number },
  ) {}

  /** Loads a model directory with `gliner_config.json`, `tokenizer.json`, `tokenizer_config.json` and the ONNX file. */
  static async load(dir: string, opts: GlinerOptions = {}): Promise<GlinerModel> {
    const json = (f: string): any => JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const g = json('gliner_config.json');
    const tokenizer = new Tokenizer(json('tokenizer.json'), json('tokenizer_config.json'));
    const ids = tokenizer.encode('a', { add_special_tokens: true }).ids;
    const ort = await loadOrt();
    const session = await ort.InferenceSession.create(join(dir, opts.file ?? 'onnx/model.onnx'), {
      executionProviders: ['cpu'],
      ...(opts.threads ? { intraOpNumThreads: opts.threads } : {}),
    });
    return new GlinerModel(ort, session, tokenizer, {
      maxWidth: g.max_width ?? 12,
      maxLen: g.max_len ?? 384,
      entToken: g.ent_token ?? '<<ENT>>',
      sepToken: g.sep_token ?? '<<SEP>>',
      cls: ids[0] as number,
      sep: ids[ids.length - 1] as number,
    });
  }

  private encodeWord(word: string): number[] {
    return tokenizerIds(this.tokenizer, word);
  }

  /** Entities for one text. Long texts run in overlapping windows. Spans never overlap in the result. */
  async predict(text: string, labels: string[], opts: PredictOptions = {}): Promise<RawEntity[]> {
    const threshold = opts.threshold ?? 0.5;
    const words = splitWords(text);
    if (words.length === 0) return [];
    const promptIds: number[] = [];
    for (const l of labels) promptIds.push(...this.encodeWord(this.cfg.entToken), ...this.encodeWord(l));
    promptIds.push(...this.encodeWord(this.cfg.sepToken));
    const wordIds = words.map((w) => this.encodeWord(w.text));
    const budget = this.cfg.maxLen - promptIds.length - 2;
    if (budget < 16) throw new BlindError('invalid-option', 'ner: too many labels for the model window');

    // Windows of words that fit the token budget, overlapping by up to 24 words.
    const windows: Array<[number, number]> = [];
    for (let from = 0; from < words.length; ) {
      let used = 0;
      let to = from;
      while (to < words.length && used + (wordIds[to] as number[]).length <= budget) used += (wordIds[to++] as number[]).length;
      if (to === from) to = from + 1; // a single oversized word still advances
      windows.push([from, to]);
      if (to >= words.length) break;
      from = Math.max(from + 1, to - 24);
    }

    const found: RawEntity[] = [];
    for (const [a, b] of windows) {
      const got = await this.run(words.slice(a, b), wordIds.slice(a, b), promptIds, labels, threshold);
      found.push(...got);
    }
    return greedyFlat(found);
  }

  private async run(words: Word[], wordIds: number[][], promptIds: number[], labels: string[], threshold: number): Promise<RawEntity[]> {
    const W = words.length;
    const MW = this.cfg.maxWidth;
    const L = labels.length;
    const ids: number[] = [this.cfg.cls, ...promptIds];
    const wmask: number[] = new Array(ids.length).fill(0);
    wordIds.forEach((pieces, i) => {
      pieces.forEach((id, j) => {
        ids.push(id);
        wmask.push(j === 0 ? i + 1 : 0);
      });
    });
    ids.push(this.cfg.sep);
    wmask.push(0);
    const N = ids.length;
    const big = (xs: number[]): BigInt64Array => BigInt64Array.from(xs, (x) => BigInt(x));
    const spanIdx = new BigInt64Array(W * MW * 2);
    const spanMask = new Uint8Array(W * MW);
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < MW; j++) {
        const k = i * MW + j;
        spanIdx[k * 2] = BigInt(i);
        spanIdx[k * 2 + 1] = BigInt(Math.min(i + j, W - 1));
        spanMask[k] = i + j < W ? 1 : 0;
      }
    }
    const out = await this.session.run({
      input_ids: new this.ort.Tensor('int64', big(ids), [1, N]),
      attention_mask: new this.ort.Tensor('int64', big(new Array(N).fill(1)), [1, N]),
      words_mask: new this.ort.Tensor('int64', big(wmask), [1, N]),
      text_lengths: new this.ort.Tensor('int64', big([W]), [1, 1]),
      span_idx: new this.ort.Tensor('int64', spanIdx, [1, W * MW, 2]),
      span_mask: new this.ort.Tensor('bool', spanMask, [1, W * MW]),
    });
    const logits = out['logits']!.data as Float32Array;
    if (process.env.GLINER_DEBUG) console.error(out['logits']!.dims, Math.max(...logits));
    const spans: RawEntity[] = [];
    for (let i = 0; i < W; i++) {
      for (let j = 0; j < MW && i + j < W; j++) {
        for (let c = 0; c < L; c++) {
          const p = sigmoid(logits[(i * MW + j) * L + c] as number);
          if (p >= threshold) spans.push({ start: (words[i] as Word).start, end: (words[i + j] as Word).end, label: labels[c] as string, score: p });
        }
      }
    }
    return spans;
  }
}

function tokenizerIds(tok: Tokenizer, word: string): number[] {
  return tok.encode(word, { add_special_tokens: false }).ids;
}

/** Highest score first, no two spans may overlap. */
export function greedyFlat(spans: RawEntity[]): RawEntity[] {
  const sorted = spans.slice().sort((a, b) => b.score - a.score || b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: RawEntity[] = [];
  for (const s of sorted) if (!kept.some((k) => s.start < k.end && k.start < s.end)) kept.push(s);
  return kept.sort((a, b) => a.start - b.start);
}
