/** Loads corpus/adversarial/*.json and runs one case through blind. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blind, unblind } from '../../src/index.js';
import type { Detector, KnownValue } from '../../src/types.js';
import { CORPUS_DIR, FIXED_NOW } from './corpus.js';

export type Outcome = 'replaced' | 'flagged' | 'silent';

export interface AdvCase {
  id: string;
  title: string;
  text: string;
  /** Strings a reader must not be able to find in the blind text. */
  secrets: string[];
  /** replaced: gone. flagged: still there but the leak check says so. silent: still there and unreported, a known miss. */
  expect: Outcome;
  known?: KnownValue[];
  deny?: string[];
  why?: string;
  /** `roundtrip` asserts unblind(blind(x)) === x instead of looking for secrets. */
  check?: 'secrets' | 'roundtrip';
  seed: string;
}

export interface AdvFile {
  category: string;
  cases: AdvCase[];
}

export const ADV_DIR = join(CORPUS_DIR, 'adversarial');

export function loadAdversarial(): AdvFile[] {
  return readdirSync(ADV_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ category: f.replace(/\.json$/, ''), cases: JSON.parse(readFileSync(join(ADV_DIR, f), 'utf8')) as AdvCase[] }));
}

import { foldLookalikes } from '../../src/fold.js';

const fold = (s: string): string =>
  foldLookalikes(s).normalize('NFKC').replace(/[\u200b-\u200f\u2060\ufeff]/g, '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function runCase(c: AdvCase, detectors: Detector[] = []): { outcome: Outcome; out: string } {
  const res = blind([c.text], { known: c.known, deny: c.deny, seed: c.seed, now: FIXED_NOW, detectors });
  const out = res.texts[0] as string;
  if (c.check === 'roundtrip') {
    return { outcome: unblind(out, res.mapping).text === c.text ? 'replaced' : 'silent', out };
  }
  const left = c.secrets.filter((s) => fold(out).includes(fold(s)));
  if (left.length === 0) return { outcome: 'replaced', out };
  return { outcome: res.leaks.ok ? 'silent' : 'flagged', out };
}
