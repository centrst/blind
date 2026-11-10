import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Detector } from '@centrst/blind';
import { blind, unblind } from '@centrst/blind';
import { loadAdversarial, runCase } from '../../test/support/adversarial.js';
import { belowFloors, FIXED_NOW, loadCorpus, SCORED_KINDS, scoreCorpus, type CorpusFile, type FloorSet } from '../../test/support/corpus.js';
import { hits, installPatches, removePatches } from '../../test/support/network-guard.js';
import { createNerDetector, GlinerModel } from '../src/index.js';
import { HAS_MODEL, HAS_ORT, MODEL_DIR, MODEL_FILE, NER_ROOT } from './support.js';

const files = loadCorpus();
const outcomeRank = { silent: 0, flagged: 1, replaced: 2 } as const;

describe.skipIf(!HAS_MODEL || !HAS_ORT)('NER detector with the GLiNER model', () => {
  const prepared = new Map<string, Detector>();
  const extra = (f: CorpusFile): Detector[] => [prepared.get(f.name) as Detector];

  beforeAll(async () => {
    const model = await GlinerModel.load(MODEL_DIR, { file: MODEL_FILE });
    const ner = createNerDetector(model);
    for (const f of files) prepared.set(f.name, await ner.prepare([f.parsed.text]));
  });

  it('C15/corpus: all 381 corpus files round trip exactly in bare and known mode with the detector on', () => {
    expect(files.length).toBe(381);
    const failures: string[] = [];
    for (const mode of ['bare', 'known'] as const) {
      for (const f of files) {
        const res = blind([f.parsed.text], { known: mode === 'known' ? f.parsed.known : [], seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: extra(f) });
        if (unblind(res.texts[0] as string, res.mapping).text !== f.parsed.text) failures.push(`${mode} ${f.name}`);
      }
    }
    expect(failures).toEqual([]);
  });

  /**
   * Invented contracts shaped like the Gretel files that broke: a role word the
   * model tags in any letter case, two spellings of one name, a user name glued
   * to digits, a phone with an extension and an address in two cases.
   */
  const contracts = [
    'CONTRATO DE SERVICIOS\n\nEntre Talleres Ondara S.L., en adelante "la Empresa", y Belén Quiroga, en adelante "la Clienta".\n\n' +
      'PRIMERA. La Empresa presta el servicio. LA EMPRESA responde de los daños. Si la Empresa se retrasa, la Clienta avisa a la empresa por escrito.\n\n' +
      'SEGUNDA. Contacto: bquiroga88 o brescia420 en el portal, teléfono (615)555-0142x77, correo BQuiroga@ondara.example o bquiroga@ondara.example.\n\n' +
      'Firmado: BELÉN QUIROGA y Belen Quiroga, por TALLERES ONDARA S.L.',
    'SERVICE AGREEMENT\n\nThis agreement is made between Harlow Marine Insurance Company (the "Insurer") and Imogen Ashworth (the "Insured").\n\n' +
      '1. The Insurer covers the vessel. THE INSURER pays within 30 days. If the Insurer refuses, the Insured may write to the insurer.\n\n' +
      '2. The Company Harlow Marine and the company HARLOW MARINE share one address: 716.555.0199x4021, imogen.ashworth@harlow.example, Imogen.Ashworth@harlow.example.\n\n' +
      'Signed, IMOGEN ASHWORTH\nimogen77',
  ];

  it('C15/outside: invented contracts with role words in any case, names glued to digits and phone extensions round trip with the detector on, in every mode', async () => {
    const model = await GlinerModel.load(MODEL_DIR, { file: MODEL_FILE });
    const ner = createNerDetector(model);
    const failures: string[] = [];
    for (const [i, text] of contracts.entries()) {
      const det = await ner.prepare([text]);
      for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
        const res = blind([text], { seed: `contract-${i}`, now: FIXED_NOW, detectors: [det], replaceWith });
        if (unblind(res.texts[0] as string, res.mapping).text !== text) failures.push(`${replaceWith} ${i}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('C15/adversarial: every round-trip case of the adversarial set that blind catches still round trips with the detector on, in every mode', async () => {
    const model = await GlinerModel.load(MODEL_DIR, { file: MODEL_FILE });
    const ner = createNerDetector(model);
    const cases = loadAdversarial().flatMap((f) => f.cases).filter((c) => c.check === 'roundtrip' && c.expect !== 'silent');
    expect(cases.length).toBeGreaterThanOrEqual(7);
    const failures: string[] = [];
    for (const c of cases) {
      const det = await ner.prepare([c.text]);
      for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
        const res = blind([c.text], { known: c.known, seed: c.seed, now: FIXED_NOW, detectors: [det], replaceWith });
        if (unblind(res.texts[0] as string, res.mapping).text !== c.text) failures.push(`${replaceWith} ${c.id}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('C17/corpus: strict recall and precision with the detector stay at or above the NER floors', () => {
    const floors = JSON.parse(readFileSync(join(NER_ROOT, '..', 'corpus', 'floors-ner.json'), 'utf8')) as { bare: FloorSet; known: FloorSet };
    for (const mode of ['bare', 'known'] as const) {
      expect(belowFloors(scoreCorpus(files, mode, extra), floors[mode])).toEqual([]);
    }
  });

  it('C17/corpus: person, org and place recall rise with the detector and no other kind falls', () => {
    for (const mode of ['bare', 'known'] as const) {
      const base = scoreCorpus(files, mode);
      const withNer = scoreCorpus(files, mode, extra);
      for (const k of SCORED_KINDS) {
        const was = base.perKind[k].recall;
        const now = withNer.perKind[k].recall;
        // A clear rise: 20 points, or half the way to 100 when the core alone is already close.
        // From 98% up the core leaves a dozen values or fewer of a kind, too few for half the gap to be a fair bar, so any rise counts.
        const bar = was >= 98 ? was : Math.min(was + 20, (was + 100) / 2);
        if (k === 'person' || k === 'org' || k === 'place') expect(now, `${mode} ${k}`).toBeGreaterThan(bar);
        else expect(now, `${mode} ${k}`).toBeGreaterThanOrEqual(was);
      }
    }
  });

  it('C18/adversarial: the detector never turns a handled adversarial case into a miss', async () => {
    const model = await GlinerModel.load(MODEL_DIR, { file: MODEL_FILE });
    const ner = createNerDetector(model);
    const worse: string[] = [];
    for (const f of loadAdversarial()) {
      for (const c of f.cases) {
        const before = runCase(c).outcome;
        const after = runCase(c, [await ner.prepare([c.text])]).outcome;
        if (outcomeRank[after] < outcomeRank[before]) worse.push(`${c.id} ${before} -> ${after}`);
      }
    }
    expect(worse).toEqual([]);
  });
});

describe.skipIf(!HAS_MODEL || !HAS_ORT)('NER detector without a network', () => {
  beforeAll(() => {
    installPatches();
  });
  afterAll(() => {
    removePatches();
  });

  it('C16/N1: the patches are live', async () => {
    await expect(Promise.resolve().then(() => (globalThis as unknown as { fetch: (u: string) => unknown }).fetch('http://corpus.example'))).rejects.toThrow(/N1: blocked fetch/);
    hits.length = 0;
  });

  it('C16/N1: loading the model and running inference touch no network, socket or child process', async () => {
    const model = await GlinerModel.load(MODEL_DIR, { file: MODEL_FILE });
    const ner = createNerDetector(model);
    const sample = files.filter((_, i) => i % 9 === 0);
    expect(sample.length).toBeGreaterThan(30);
    for (const f of sample) {
      const det = await ner.prepare([f.parsed.text]);
      const res = blind([f.parsed.text], { known: f.parsed.known, seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: [det] });
      unblind(res.texts[0] as string, res.mapping);
    }
    expect(hits).toEqual([]);
  });
});
