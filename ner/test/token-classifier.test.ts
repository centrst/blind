import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blind, unblind, type Detector } from '@centrst/blind';
import { loadAdversarial, runCase } from '../../test/support/adversarial.js';
import { FIXED_NOW, loadCorpus } from '../../test/support/corpus.js';
import { hits, installPatches, removePatches } from '../../test/support/network-guard.js';
import { blindWithNer, createNerDetector, decodeBio, planWindows, TokenClassifierModel } from '../src/index.js';
import { HAS_ORT, NER_ROOT } from './support.js';

const LABELS = ['O', 'B-person', 'I-person', 'B-organization', 'I-organization', 'B-location', 'I-location'];
/** One word's probabilities, from the label it should get and how sure it is. */
const word = (label: string, p = 0.9): Float32Array => {
  const out = new Float32Array(LABELS.length).fill((1 - p) / (LABELS.length - 1));
  out[LABELS.indexOf(label)] = p;
  return out;
};

describe('token-classification runner, without a model', () => {
  it('cuts words into windows that fit the token budget and overlap by the stride', () => {
    expect(planWindows([1, 1, 1], 10, 2)).toEqual([[0, 3]]);
    const w = planWindows([3, 3, 3, 3, 3, 3, 3], 9, 1);
    expect(w).toEqual([[0, 3], [2, 5], [4, 7]]);
    // Every word is in a window, and no window is over budget unless it holds one oversized word.
    const counts = Array.from({ length: 200 }, (_, i) => 1 + ((i * 7) % 5));
    const ws = planWindows(counts, 40, 6);
    const seen = new Set<number>();
    for (const [a, b] of ws) {
      for (let i = a; i < b; i++) seen.add(i);
      expect(counts.slice(a, b).reduce((x, y) => x + y, 0)).toBeLessThanOrEqual(40);
    }
    expect(seen.size).toBe(200);
    // A word longer than the budget still advances.
    expect(planWindows([2, 50, 2], 10, 3)).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('decodes BIO labels into spans: B starts, I continues the same kind, O and a change of kind end a span', () => {
    const probs = [word('B-person'), word('I-person'), word('O'), word('I-organization'), word('I-organization'), word('B-location'), word('I-person')];
    expect(decodeBio(probs, LABELS, 0.5).map((s) => [s.from, s.to, s.kind])).toEqual([
      [0, 2, 'person'],
      [3, 5, 'organization'],
      [5, 6, 'location'],
      [6, 7, 'person'],
    ]);
  });

  it('a lower threshold keeps words the model is unsure of, a higher one drops them', () => {
    // P(O) is 0.35, so 1 - P(O) is 0.65: kept at 0.5, dropped at 0.7.
    const unsure = new Float32Array([0.35, 0.4, 0.05, 0.05, 0.05, 0.05, 0.05]);
    expect(decodeBio([unsure], LABELS, 0.5)).toHaveLength(1);
    expect(decodeBio([unsure], LABELS, 0.7)).toHaveLength(0);
    expect(decodeBio([word('O', 0.6)], LABELS, 0.3)).toHaveLength(1);
    expect(decodeBio([word('O', 0.6)], LABELS, 0.5)).toHaveLength(0);
  });
});

const TC_DIR = process.env.BLIND_NER_TC_MODEL ?? join(NER_ROOT, 'models', 'blind-ner-deberta-full');
const HAS_TC = existsSync(join(TC_DIR, 'onnx', 'model.onnx'));
const files = loadCorpus();

describe.skipIf(!HAS_TC || !HAS_ORT)('token-classification runner with the trained model', () => {
  let model: TokenClassifierModel;
  beforeAll(async () => {
    model = await TokenClassifierModel.load(TC_DIR);
  });

  it('finds exactly the spans the Python pipeline found with the same ONNX file (parity.json from export.py)', async () => {
    const parity = JSON.parse(readFileSync(join(TC_DIR, 'parity.json'), 'utf8')) as { cases: Array<{ text: string; threshold: number; spans: Array<[number, number, string]> }> };
    expect(parity.cases.length).toBeGreaterThan(100);
    const diff: number[] = [];
    for (const [i, c] of parity.cases.entries()) {
      const got = (await model.predict(c.text, model.kinds, { threshold: c.threshold })).map((e) => [e.start, e.end, e.label]);
      if (JSON.stringify(got) !== JSON.stringify(c.spans)) diff.push(i);
    }
    expect(diff).toEqual([]);
  });

  it('reports only the kinds it is asked for', async () => {
    const text = 'Hola, soy Pilar Ondarreta de Talleres Ugalde S.L., con oficina en Valdemorillo.';
    const all = await model.predict(text, ['person', 'organization', 'location']);
    const people = await model.predict(text, ['person']);
    expect(people.every((e) => e.label === 'person')).toBe(true);
    expect(people).toEqual(all.filter((e) => e.label === 'person'));
    expect(await model.predict(text, ['address'])).toEqual([]);
  });

  for (const file of ['onnx/model.onnx', 'onnx/model_int8.onnx']) {
    it(`all 381 corpus files round trip exactly in bare and known mode with ${file} plugged in`, async () => {
      if (!existsSync(join(TC_DIR, file))) return;
      const m = file === 'onnx/model.onnx' ? model : await TokenClassifierModel.load(TC_DIR, { file });
      const ner = createNerDetector(m);
      expect(files.length).toBe(381);
      const failures: string[] = [];
      for (const f of files) {
        const det = await ner.prepare([f.parsed.text]);
        for (const mode of ['bare', 'known'] as const) {
          const res = blind([f.parsed.text], { known: mode === 'known' ? f.parsed.known : [], seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: [det] });
          if (unblind(res.texts[0] as string, res.mapping).text !== f.parsed.text) failures.push(`${mode} ${f.name}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it('the adversarial round-trip cases still round trip in every mode, and no handled case becomes a miss', async () => {
    const ner = createNerDetector(model);
    const rank = { silent: 0, flagged: 1, replaced: 2 } as const;
    const failures: string[] = [];
    const worse: string[] = [];
    for (const f of loadAdversarial()) {
      for (const c of f.cases) {
        const det: Detector = await ner.prepare([c.text]);
        if (rank[runCase(c, [det]).outcome] < rank[runCase(c).outcome]) worse.push(c.id);
        if (c.check !== 'roundtrip' || c.expect === 'silent') continue;
        for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
          const res = blind([c.text], { known: c.known, seed: c.seed, now: FIXED_NOW, detectors: [det], replaceWith });
          if (unblind(res.texts[0] as string, res.mapping).text !== c.text) failures.push(`${replaceWith} ${c.id}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(worse).toEqual([]);
  });

  it('plugs into blindWithNer unchanged: names go, role words stay, and the text comes back', async () => {
    const text =
      'CONTRATO DE PRÉSTAMO\n\nEntre Ferrallas Abaigar S.L. (en adelante, "la Empresa") y Rosaura Etxebeste Quilez (en adelante, "el Prestatario").\n\n' +
      'PRIMERA. La Empresa entrega al Prestatario la cantidad acordada. El Prestatario devolverá el importe a la Empresa.\n\nFirmado en Navalcarnero.';
    const res = await blindWithNer(model, [text], { seed: 'tc-contract', now: FIXED_NOW });
    const out = res.texts[0] as string;
    for (const v of ['Abaigar', 'Etxebeste', 'Quilez']) expect(out, v).not.toContain(v);
    for (const role of ['la Empresa', 'el Prestatario', 'La Empresa', 'El Prestatario']) expect(out, role).toContain(role);
    expect(unblind(out, res.mapping).text).toBe(text);
  });
});

describe.skipIf(!HAS_TC || !HAS_ORT)('token-classification runner without a network', () => {
  beforeAll(() => installPatches());
  afterAll(() => removePatches());

  it('loading the model and running inference touch no network, socket or child process', async () => {
    hits.length = 0;
    const model = await TokenClassifierModel.load(TC_DIR);
    const ner = createNerDetector(model);
    for (const f of files.filter((_, i) => i % 9 === 0)) {
      const det = await ner.prepare([f.parsed.text]);
      const res = blind([f.parsed.text], { seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: [det] });
      unblind(res.texts[0] as string, res.mapping);
    }
    expect(hits).toEqual([]);
  });
});
