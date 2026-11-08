/** Corpus loading, lint and scoring. Shared by the vitest suites and `pnpm corpus`. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { builtinDetectors, findSpans, knownDetector } from '../../src/detect.js';
import { gluedPrefixBefore } from '../../src/script.js';
import { blind, unblind } from '../../src/index.js';
import { DEFAULT_ALLOW_DOMAINS, PARTICLES } from '../../src/names.js';
import type { Detector, KnownValue, Span } from '../../src/types.js';
import { parseAnnotated, type Annotated } from './annotate.js';
import { reservedPhone, unownableMailbox } from './values.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CORPUS_DIR = join(ROOT, 'corpus');

export interface CorpusFile {
  name: string;
  group: 'generated' | 'handwritten';
  category: string;
  lang: string;
  source: string;
  parsed: Annotated;
}

export function loadCorpus(): CorpusFile[] {
  const out: CorpusFile[] = [];
  for (const group of ['generated', 'handwritten'] as const) {
    const dir = join(CORPUS_DIR, group);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt')).sort()) {
      const source = readFileSync(join(dir, f), 'utf8');
      const m = /^\d+-([a-z]+)-([a-z]+)\.txt$/.exec(f);
      out.push({ name: `${group}/${f}`, group, category: m?.[1] ?? 'misc', lang: m?.[2] ?? 'en', source, parsed: parseAnnotated(source) });
    }
  }
  return out;
}

// -------------------------------------------------------------------- lint

const PUBLIC = new Set([...DEFAULT_ALLOW_DOMAINS, 'yahoo.es', 'hotmail.es', 'booksy.com']);
const isPublic = (host: string): boolean => {
  const h = host.toLowerCase();
  return [...PUBLIC].some((d) => h === d || h.endsWith(`.${d}`));
};

interface Finding {
  message: string;
  /** The text the message is about, for allow-lists in tests. Never printed. */
  value: string;
  start: number;
  end: number;
}

function lintFindings(text: string): Finding[] {
  const bad: Finding[] = [];
  const hosts = new Map<string, number>();
  for (const m of text.matchAll(/([A-Za-z0-9._%+-]+)(?:@|%40)((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g)) {
    const host = m[2] as string;
    if (!hosts.has(host)) hosts.set(host, m.index + m[0].length - host.length);
    const h = host.toLowerCase().replace(/[.,;:]+$/, '');
    // A private host is reported below. A public one must carry a mailbox no one can own.
    if (isPublic(h) && !unownableMailbox(m[1] as string, h)) {
      bad.push({ message: `mailbox someone could own at ${host.toLowerCase()}`, value: m[0], start: m.index, end: m.index + m[0].length });
    }
  }
  for (const m of text.matchAll(/(?:https?:\/\/|www\.)((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/gi)) {
    const host = m[1] as string;
    if (!hosts.has(host)) hosts.set(host, m.index + m[0].length - host.length);
  }
  for (const [h, start] of hosts) {
    const l = h.toLowerCase().replace(/[.,;:]+$/, '');
    if (l.endsWith('.example') || isPublic(l)) continue;
    bad.push({ message: `non-.example private domain: ${l}`, value: h, start, end: start + h.length });
  }
  for (const sp of resolvedSpans(text, []).filter((x) => x.kind === 'phone')) {
    const value = text.slice(sp.start, sp.end);
    if (!reservedPhone(value)) bad.push({ message: `phone outside the reserved ranges at offset ${sp.start}`, value, start: sp.start, end: sp.end });
  }
  return bad;
}

/**
 * Returns a message per private-looking host that is not under `.example`, per
 * mailbox someone could own (see `unownableMailbox`), and per phone outside the
 * reserved ranges (see `reservedPhone`). Messages carry the kind, not the value.
 */
export function lintCorpusText(text: string): string[] {
  return lintFindings(text).map((f) => f.message);
}

export interface CodeLint {
  /** 1-based line of the string literal. */
  line: number;
  message: string;
  /** The flagged text, for an allow-list. Do not print it. */
  value: string;
}

/**
 * `lintCorpusText` for code: each string literal, and each literal part of a
 * template, is linted on its own, so the numbers in the code around it are not
 * read as phones. A finding next to an interpolation, or one separator away, is
 * dropped, since the interpolation completes it at run time.
 */
/** What may sit between a phone and the interpolation that continues it. */
const SEPARATORS = /^[ .()-]?$/;

export function lintCodeText(source: string, fileName = 'code.ts'): CodeLint[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: CodeLint[] = [];
  const visit = (node: ts.Node): void => {
    const opensAfter = ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
    const closesAt = ts.isTemplateHead(node) || ts.isTemplateMiddle(node);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || opensAfter || closesAt) {
      const text = (node as ts.LiteralLikeNode).text;
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      for (const f of lintFindings(text)) {
        if ((opensAfter && SEPARATORS.test(text.slice(0, f.start))) || (closesAt && SEPARATORS.test(text.slice(f.end)))) continue;
        out.push({ line, message: f.message, value: f.value });
      }
    }
    node.forEachChild(visit);
  };
  visit(sf);
  return out;
}

// ----------------------------------------------------------------- scoring

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const WORDCH = /[\p{L}\p{N}_]/u;

export function containsWord(hay: string, needle: string): boolean {
  const h = norm(hay);
  const n = norm(needle);
  if (!n) return false;
  for (let from = 0; ; ) {
    const i = h.indexOf(n, from);
    if (i < 0) return false;
    from = i + 1;
    const before = h[i - 1];
    const after = h[i + n.length];
    // A Hebrew or Arabic value behind a glued prefix (`לדוד`) is still the word.
    if ((before !== undefined && WORDCH.test(before) && WORDCH.test(n[0] as string) && !gluedPrefixBefore(h, i, n)) || (after !== undefined && WORDCH.test(after) && WORDCH.test(n[n.length - 1] as string))) continue;
    return true;
  }
}

/** True when the annotated value still shows in the blind text. */
export function survives(kind: string, value: string, output: string): boolean {
  if (kind === 'person') {
    const toks = value.split(/\s+/).filter((t) => t.length >= 3 && !PARTICLES.has(t.toLowerCase()));
    return toks.some((t) => containsWord(output, t));
  }
  return containsWord(output, value);
}

export const SCORED_KINDS = ['person', 'org', 'place', 'email', 'url', 'phone', 'iban', 'id', 'amount', 'date'] as const;
export type ScoredKind = (typeof SCORED_KINDS)[number];
export type Mode = 'bare' | 'known';

export interface KindScore {
  annotated: number;
  /** Annotations no replaced span fully covered. A diagnostic, not the recall. */
  missed: number;
  /** Strict recall: share of annotated values gone from the blind text. */
  recall: number;
  /** Diagnostic: share of annotations a detector span fully covered. Overstates recall. */
  coverage: number;
  replaced: number;
  correct: number;
  precision: number;
  /** Annotated values still present somewhere in the blind text. Recall is computed from this. */
  survivors: number;
}

export interface Scorecard {
  mode: Mode;
  files: number;
  perKind: Record<ScoredKind, KindScore>;
  roundTrip: { ok: number; total: number; failures: string[] };
  safetyNet: { filesWithMisses: number; flagged: number; falseAlarms: number };
  missSamples: Array<{ file: string; kind: string; value: string }>;
}

export const FIXED_NOW = new Date('2026-06-01T00:00:00Z');

/** The spans `blind` will replace, found the way `blind` finds them. */
export function resolvedSpans(text: string, known: KnownValue[], dateOrder: 'dmy' | 'mdy' = 'dmy', extra: Detector[] = []): Span[] {
  const allow = DEFAULT_ALLOW_DOMAINS;
  const ctx = { dateOrder, isAllowedHost: (h: string) => allow.some((d) => h === d || h.endsWith(`.${d}`)) };
  return findSpans([text], { ...ctx, known }, [...builtinDetectors, knownDetector(known), ...extra])[0] as Span[];
}

/** Characters of an annotation that must sit inside a replaced span for it to count as replaced. */
export function required(kind: string, value: string, start: number): number[] {
  const re = kind === 'amount' ? /\d/u : kind === 'person' || kind === 'org' || kind === 'place' ? /\p{L}/u : /[\p{L}\p{N}]/u;
  const out: number[] = [];
  [...value].forEach((ch, i) => {
    if (re.test(ch)) out.push(start + i);
  });
  return out;
}

/** `extraDetectors` adds detectors for one file, for example a prepared NER detector. */
export function scoreCorpus(files: CorpusFile[], mode: Mode, extraDetectors?: (f: CorpusFile) => Detector[]): Scorecard {
  const acc = Object.fromEntries(SCORED_KINDS.map((k) => [k, { annotated: 0, missed: 0, replaced: 0, correct: 0, survivors: 0 }])) as Record<ScoredKind, { annotated: number; missed: number; replaced: number; correct: number; survivors: number }>;
  const rt = { ok: 0, total: 0, failures: [] as string[] };
  const net = { filesWithMisses: 0, flagged: 0, falseAlarms: 0 };
  const missSamples: Scorecard['missSamples'] = [];

  for (const f of files) {
    const { text, spans, known, dateOrder } = f.parsed;
    const useKnown = mode === 'known' ? known : [];
    const extra = extraDetectors?.(f) ?? [];
    const res = blind([text], { known: useKnown, seed: f.name, now: FIXED_NOW, dateOrder, detectors: extra });
    const out = res.texts[0] as string;
    const found = resolvedSpans(text, useKnown, dateOrder, extra);
    const covered = new Set<number>();
    for (const r of found) for (let i = r.start; i < r.end; i++) covered.add(i);
    let missed = 0;
    for (const sp of spans) {
      const k = sp.kind as ScoredKind;
      if (!acc[k]) continue;
      acc[k].annotated++;
      if (!required(sp.kind, sp.value, sp.start).every((i) => covered.has(i))) {
        acc[k].missed++;
        missed++;
        if (missSamples.length < 5000) missSamples.push({ file: f.name, kind: sp.kind, value: sp.value });
      }
      if (survives(sp.kind, sp.value, out)) acc[k].survivors++;
    }
    for (const r of found) {
      const k = r.kind as ScoredKind;
      if (!acc[k]) continue;
      acc[k].replaced++;
      if (spans.some((s) => s.kind === k && s.start < r.end && r.start < s.end)) acc[k].correct++;
    }
    rt.total++;
    const back = unblind(out, res.mapping).text;
    if (back === text) rt.ok++;
    else rt.failures.push(f.name);
    if (missed > 0) {
      net.filesWithMisses++;
      if (!res.leaks.ok) net.flagged++;
    } else if (!res.leaks.ok) net.falseAlarms++;
  }

  const pct = (a: number, b: number): number => (b === 0 ? 100 : Math.round((a / b) * 10000) / 100);
  const perKind = Object.fromEntries(
    SCORED_KINDS.map((k) => {
      const a = acc[k];
      return [k, { annotated: a.annotated, missed: a.missed, recall: pct(a.annotated - a.survivors, a.annotated), coverage: pct(a.annotated - a.missed, a.annotated), replaced: a.replaced, correct: a.correct, precision: pct(a.correct, a.replaced), survivors: a.survivors }];
    }),
  ) as Record<ScoredKind, KindScore>;
  return { mode, files: files.length, perKind, roundTrip: rt, safetyNet: net, missSamples };
}

// ------------------------------------------------------------------ floors

export interface Floors {
  bare: FloorSet;
  known: FloorSet;
}
export interface FloorSet {
  recall: Record<string, number>;
  precision: Record<string, number>;
  roundTrip: number;
}

export function loadFloors(): Floors | null {
  const p = join(CORPUS_DIR, 'floors.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as Floors) : null;
}

export function floorsFrom(card: Scorecard, prev?: FloorSet): FloorSet {
  const down = (n: number): number => Math.floor(n + 1e-9);
  const recall: Record<string, number> = {};
  const precision: Record<string, number> = {};
  for (const k of SCORED_KINDS) {
    recall[k] = Math.max(down(card.perKind[k].recall), prev?.recall[k] ?? 0);
    precision[k] = Math.max(down(card.perKind[k].precision), prev?.precision[k] ?? 0);
  }
  const rt = card.roundTrip.total === 0 ? 100 : down((card.roundTrip.ok / card.roundTrip.total) * 100);
  return { recall, precision, roundTrip: Math.max(rt, prev?.roundTrip ?? 0) };
}

export function belowFloors(card: Scorecard, floors: FloorSet): string[] {
  const bad: string[] = [];
  for (const k of SCORED_KINDS) {
    if (card.perKind[k].recall < (floors.recall[k] ?? 0)) bad.push(`${card.mode} recall ${k}: ${card.perKind[k].recall} < ${floors.recall[k]}`);
    if (card.perKind[k].precision < (floors.precision[k] ?? 0)) bad.push(`${card.mode} precision ${k}: ${card.perKind[k].precision} < ${floors.precision[k]}`);
  }
  const rt = card.roundTrip.total === 0 ? 100 : (card.roundTrip.ok / card.roundTrip.total) * 100;
  if (rt < floors.roundTrip) bad.push(`${card.mode} round trip: ${rt} < ${floors.roundTrip}`);
  return bad;
}
