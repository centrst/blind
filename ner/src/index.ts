import { blind, type BlindOptions, type BlindResult } from '@centrst/blind';
import { createNerDetector, type NerDetectorOptions, type NerBackend } from './detector.js';

export { createNerDetector, DEFAULT_LABELS } from './detector.js';
export type { NerBackend, NerDetector, NerDetectorOptions, NerKind } from './detector.js';
export { GlinerModel, greedyFlat, splitWords } from './gliner.js';
export type { GlinerOptions, PredictOptions, RawEntity } from './gliner.js';
export { decodeBio, planWindows, TokenClassifierModel } from './token-classifier.js';
export type { LabelFile, TokenClassifierOptions, TokenClassifierPredictOptions } from './token-classifier.js';

/**
 * `blind` with a NER detector plugged into its `detectors` option. The model
 * runs first (it is async), then the core runs unchanged.
 */
export async function blindWithNer(backend: NerBackend, texts: string[], opts: BlindOptions & { ner?: NerDetectorOptions } = {}): Promise<BlindResult> {
  const { ner, ...rest } = opts;
  const detector = await createNerDetector(backend, ner).prepare(texts);
  return blind(texts, { ...rest, detectors: [...(rest.detectors ?? []), detector] });
}
