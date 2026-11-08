import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RawEntity } from '../src/gliner.js';
import type { NerBackend } from '../src/detector.js';
import { loadOrt } from '../src/gliner.js';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const NER_ROOT = join(HERE, '..');
export const MODEL_DIR = process.env.BLIND_NER_MODEL ?? join(NER_ROOT, 'models', 'gliner_multi-v2.1');
export const MODEL_FILE = 'onnx/model.onnx';
export const HAS_MODEL = existsSync(join(MODEL_DIR, MODEL_FILE));

/**
 * Whether onnxruntime-node's native binary loads here. Its npm package ships
 * binaries for some platforms only (none for darwin/x64), so the suites that
 * run a model skip on the others. The stub suites never load it.
 */
export const HAS_ORT = await loadOrt().then(
  () => true,
  () => false,
);
export const NO_ORT_MESSAGE = `onnxruntime-node has no binary that loads on ${process.platform}/${process.arch}; the model suites skip here (see ner/README.md)`;
if (!HAS_ORT) console.warn(NO_ORT_MESSAGE);

/** A backend that finds listed strings and nothing else. Records what it was shown. */
export function stubBackend(entities: Record<string, 'person' | 'organization' | 'location'>): NerBackend & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async predict(text) {
      seen.push(text);
      const out: RawEntity[] = [];
      for (const [value, label] of Object.entries(entities)) {
        for (let from = 0; ; ) {
          const i = text.indexOf(value, from);
          if (i < 0) break;
          out.push({ start: i, end: i + value.length, label, score: 0.99 });
          from = i + value.length;
        }
      }
      return out.sort((a, b) => a.start - b.start);
    },
  };
}
