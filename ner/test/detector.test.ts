import { describe, expect, it } from 'vitest';
import { BlindError, blind, unblind, type Detector } from '@centrst/blind';
import { blindWithNer, createNerDetector, greedyFlat, splitWords, type NerDetectorOptions } from '../src/index.js';
import { forbiddenIn } from '../../test/support/forbidden.js';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NER_ROOT, stubBackend } from './support.js';

const NOW = new Date('2026-06-01T00:00:00Z');
const back = (r: Awaited<ReturnType<typeof blindWithNer>>): string => unblind(r.texts[0] as string, r.mapping).text;

describe('NER detector with a stub model', () => {
  it('C13/N2: plugs into the detectors option and replaces people, orgs and places the patterns cannot see', async () => {
    const text = 'Hola, soy Ana Ruiz de Gestoría Norte. Nos vemos en Valencia el martes.';
    const b = stubBackend({ 'Ana Ruiz': 'person', 'Gestoría Norte': 'organization', Valencia: 'location' });
    const r = await blindWithNer(b, [text], { seed: 's1', now: NOW });
    const out = r.texts[0] as string;
    for (const v of ['Ana', 'Ruiz', 'Gestoría', 'Norte', 'Valencia']) expect(out, v).not.toContain(v);
    expect(r.mapping.pairs.map((p) => p.kind).sort()).toEqual(expect.arrayContaining(['person', 'org', 'place']));
    expect(back(r)).toBe(text);
    // Without the detector the same text keeps all three.
    expect(blind([text], { seed: 's1', now: NOW }).texts[0]).toContain('Valencia');
  });

  it('C13/N3: a NER span that touches an email or a phone is cut around it, and the pattern span wins', async () => {
    const text = 'Contacto: Ana Ruiz ana.ruiz@gestoria.example +34 791 123 456 hoy.';
    const b = stubBackend({ 'Ana Ruiz ana.ruiz@gestoria.example +34 791 123 456': 'person' });
    const r = await blindWithNer(b, [text], { seed: 's2', now: NOW });
    const out = r.texts[0] as string;
    const kinds = r.mapping.pairs.map((p) => p.kind);
    expect(kinds).toContain('email');
    expect(kinds).toContain('phone');
    expect(kinds).toContain('person');
    expect(out).not.toContain('Ruiz');
    expect(out).not.toContain('gestoria.example');
    expect(out).not.toContain('791 123 456');
    expect(back(r)).toBe(text);
  });

  it('C13/N4: a known value wins over a NER span on the same words', async () => {
    const text = 'Escribe a Ana Ruiz mañana.';
    const b = stubBackend({ 'Ana Ruiz': 'organization' });
    const r = await blindWithNer(b, [text], { seed: 's3', now: NOW, known: [{ kind: 'person', value: 'Ana Ruiz' }] });
    expect(r.mapping.pairs.filter((p) => p.kind === 'org')).toEqual([]);
    expect(r.mapping.pairs.some((p) => p.kind === 'person')).toBe(true);
    expect(back(r)).toBe(text);
    // A NER span that spills past the known value is cut around it, so the rest is still replaced.
    const spill = 'Escribe a Ana Ruiz de Gestoría Norte mañana.';
    const b2 = stubBackend({ 'Ana Ruiz de Gestoría Norte': 'organization' });
    const r2 = await blindWithNer(b2, [spill], { seed: 's3', now: NOW, known: [{ kind: 'person', value: 'Ana Ruiz' }] });
    const out2 = r2.texts[0] as string;
    expect(out2).not.toMatch(/Ruiz|Gestoría|Norte/);
    expect(r2.mapping.pairs.find((p) => p.kind === 'org')?.real).toBe('Gestoría Norte');
    expect(back(r2)).toBe(spill);
    // What is left after a cut is dropped when it is only a legal suffix.
    const suffix = 'Factura de Gestoría Norte S.L. adjunta.';
    const b3 = stubBackend({ 'Gestoría Norte S.L.': 'organization' });
    const r3 = await blindWithNer(b3, [suffix], { seed: 's3', now: NOW, known: [{ kind: 'org', value: 'Gestoría Norte' }] });
    expect(r3.texts[0]).toMatch(/S\.L\. adjunta\.$/);
    expect(r3.mapping.pairs.filter((p) => p.kind === 'org')).toHaveLength(1);
  });

  it('C13/N4: a NER span around a known Korean name glued into a word adds no span of its own, and the text round trips', async () => {
    const text = '김민수는 내일 옵니다. 우리팀김민수님도 왔어요. 서울 한빛김민수 팀장';
    const known = [{ kind: 'person' as const, value: '김민수' }];
    const b = stubBackend({ 김민수는: 'person', 우리팀김민수님도: 'organization', '서울 한빛': 'location' });
    for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
      const r = await blindWithNer(b, [text], { seed: 's5', now: NOW, known, replaceWith });
      const out = r.texts[0] as string;
      expect(out, replaceWith).not.toContain('김민수');
      expect(out, replaceWith).toContain('우리팀');
      expect(out, replaceWith).toContain('님도');
      // Only the glued word goes: `서울` stands apart and is still the detector's place.
      expect(r.mapping.pairs.map((p) => `${p.kind} ${p.real}`).sort(), replaceWith).toEqual(['person 김민수', 'place 서울']);
      expect(back(r), replaceWith).toBe(text);
    }
  });

  it('refuses a text it was not prepared for, without echoing it', async () => {
    const b = stubBackend({ 'Ana Ruiz': 'person' });
    const det = await createNerDetector(b).prepare(['Hola Ana Ruiz.']);
    const ctx = { dateOrder: 'dmy' as const, isAllowedHost: () => false };
    expect(() => det.detect('Adiós Ana Ruiz.', ctx)).toThrow(/not prepared/);
    expect(() => det.detect('Adiós Ana Ruiz.', ctx)).not.toThrow(/Adiós/);
    let caught: unknown;
    try {
      blind(['Adiós Ana Ruiz.'], { seed: 'x', detectors: [det] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BlindError);
    expect((caught as BlindError).kind).toBe('detector-not-prepared');
    // blind() hands on only the kind: the detector's own message stays behind the boundary.
    expect((caught as BlindError).message).toBe('blind: detector error while detecting values (detector-not-prepared)');
    for (const part of ['Adiós', 'Ana', 'Ruiz', 'ner:']) expect((caught as BlindError).message).not.toContain(part);
  });

  it('C13/N5: the model sees look-alike letters as plain letters, and hidden characters do not split a name', async () => {
    const text = 'Hola Аna R​uiz, un saludo.'; // Cyrillic A, zero-width space
    const b = stubBackend({ 'Ana Ruiz': 'person' });
    const r = await blindWithNer(b, [text], { seed: 's4', now: NOW });
    expect(b.seen[0]).toContain('Ana Ruiz');
    const out = r.texts[0] as string;
    expect(out).not.toMatch(/Ruiz|R​uiz/);
    // The core puts the name back as it was written, disguise included.
    expect(back(r)).toBe(text);
  });

  it('C14/N6: one person keeps one fake across a header, prose and a bare first name', async () => {
    const text = 'From: Ana Ruiz <ana.ruiz@gestoria.example>\n\nHola Ana,\nGracias por tu tiempo. Un saludo, Ana Ruiz\n';
    const b = stubBackend({ 'Ana Ruiz': 'person' });
    const r = await blindWithNer(b, [text], { seed: 's5', now: NOW });
    const out = r.texts[0] as string;
    expect(out).not.toMatch(/Ana|Ruiz/);
    const person = r.mapping.pairs.filter((p) => p.kind === 'person');
    const first = person.find((p) => p.real === 'Ana');
    const full = person.find((p) => p.real === 'Ruiz' || p.real === 'Ana Ruiz');
    expect(first).toBeDefined();
    expect(full).toBeDefined();
    const fakeFirst = (first as { fake: string }).fake;
    expect(out.split(fakeFirst).length - 1).toBeGreaterThanOrEqual(3);
    expect(back(r)).toBe(text);
  });

  it('C14/N6: a bare surname and a bare first name after the full name the model found are replaced, always', async () => {
    const text = 'Yesterday Odalys Brennecke sent the draft. On Friday Brennecke said it was late, and later Odalys wanted changes.';
    const b = stubBackend({ 'Odalys Brennecke': 'person' });
    const r = await blindWithNer(b, [text], { seed: 's6', now: NOW });
    const out = r.texts[0] as string;
    expect(out).not.toMatch(/Odalys|Brennecke/);
    expect(back(r)).toBe(text);
    // There is no option to turn this off: the old `propagate: false` is not in the type and changes nothing.
    const off = await blindWithNer(b, [text], { seed: 's6', now: NOW, ner: { propagate: false } as unknown as NerDetectorOptions });
    expect(off.texts).toEqual(r.texts);
  });

  it('C14/N7: with the detector plugged in, round trips hold and no name survives for 40 seeds', async () => {
    const text = 'Re: factura\nAna Ruiz escribió:\n> Gracias Pilar. Hablamos con Talleres Norte en Sevilla.\nPilar\n';
    const b = stubBackend({ 'Ana Ruiz': 'person', Pilar: 'person', 'Talleres Norte': 'organization', Sevilla: 'location' });
    for (let i = 0; i < 40; i++) {
      const r = await blindWithNer(b, [text], { seed: `seed-${i}`, now: NOW });
      const out = r.texts[0] as string;
      expect(out, `seed ${i}`).not.toMatch(/Ruiz|Pilar|Talleres|Sevilla/);
      expect(back(r), `seed ${i}`).toBe(text);
    }
  });

  it('C14/N8: the same seed and input give the same output with the detector plugged in', async () => {
    const text = 'Hola Ana Ruiz de Gestoría Norte, desde Valencia.';
    const b = stubBackend({ 'Ana Ruiz': 'person', 'Gestoría Norte': 'organization', Valencia: 'location' });
    const a = await blindWithNer(b, [text], { seed: 'same', now: NOW });
    const c = await blindWithNer(b, [text], { seed: 'same', now: NOW });
    const d = await blindWithNer(b, [text], { seed: 'other', now: NOW });
    expect(c.texts).toEqual(a.texts);
    expect(d.texts).not.toEqual(a.texts);
  });

  it('several texts in one call share fakes', async () => {
    const texts = ['Hola Ana Ruiz.', 'Adiós, Ana Ruiz.'];
    const b = stubBackend({ 'Ana Ruiz': 'person' });
    const det = await createNerDetector(b).prepare(texts);
    const r = blind(texts, { seed: 'm', now: NOW, detectors: [det] });
    const fake = (r.texts[0] as string).replace('Hola ', '').replace('.', '');
    expect(r.texts[1]).toContain(fake);
  });

  it('does not propagate a token the text also writes in lower case', async () => {
    const text = 'Rose Hill firmó. La rose del jardín. Rose volvió.';
    const b = stubBackend({ 'Rose Hill': 'person' });
    const det = await createNerDetector(b).prepare([text]);
    const spans = det.detect(text, { dateOrder: 'dmy', isAllowedHost: () => false });
    const got = spans.map((s) => text.slice(s.start, s.end));
    expect(got).toContain('Rose Hill');
    expect(got.filter((g) => g === 'Rose')).toEqual([]);
  });

  it('strips a greeting from the front of a person span', async () => {
    const text = 'Estimada Lucía, gracias.';
    const b = stubBackend({ 'Estimada Lucía': 'person' });
    const det = (await createNerDetector(b).prepare([text])) as Detector;
    const spans = det.detect(text, { dateOrder: 'dmy', isAllowedHost: () => false });
    expect(text.slice(spans[0]!.start, spans[0]!.end)).toBe('Lucía');
  });

  it('splits words with a Unicode-aware pattern', () => {
    expect(splitWords('Gestoría Norte, S.L.').map((w) => w.text)).toEqual(['Gestoría', 'Norte', ',', 'S', '.', 'L', '.']);
    expect(splitWords('Ana-María Núñez').map((w) => w.text)).toEqual(['Ana-María', 'Núñez']);
  });

  it('keeps the highest-scoring span when spans overlap', () => {
    const got = greedyFlat([
      { start: 0, end: 8, label: 'person', score: 0.6 },
      { start: 4, end: 12, label: 'organization', score: 0.9 },
      { start: 20, end: 24, label: 'location', score: 0.5 },
    ]);
    expect(got.map((g) => g.label)).toEqual(['organization', 'location']);
  });

  it('C16/N9: the package source imports nothing that opens a socket or a process', () => {
    const dir = join(NER_ROOT, 'src');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
      expect(forbiddenIn(readFileSync(join(dir, f), 'utf8')), f).toEqual([]);
    }
  });
});
