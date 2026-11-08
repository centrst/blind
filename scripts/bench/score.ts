/**
 * Step 3 of `pnpm bench:presidio` and `pnpm bench:llmguard`: score Presidio, LLM Guard and
 * blind side by side on the labelled corpus.
 *
 * Reads reports/presidio-raw.json (scripts/bench/presidio.py) and, when it exists,
 * reports/llmguard-raw.json (scripts/bench/llm_guard.py). Scores every Presidio and LLM Guard
 * configuration with blind's own scorer (strict recall per kind through `survives`,
 * precision as the share of replaced spans that overlap an annotation of the same kind),
 * runs blind in bare and known mode on the same files, and adds an offline measure of
 * whether amounts and dates are still usable for reasoning after the rewrite.
 * When the GLiNER weights are in ner/models/gliner_multi-v2.1, blind also runs with the
 * NER detector plugged in through `detectors`, the way ner/scripts/eval.ts does it, at the
 * detector's default threshold and, in bare mode, once more at ALT_NER_THRESHOLD.
 * Each `--tc <name>=<dir>[,<file>[,<threshold>]]` adds a token-classification model (ner/TRAINED.md)
 * the same way, in bare and known mode. `--out` names the report, default reports/presidio-bench.json.
 * Run it with `tsx --tsconfig ner/tsconfig.json` so the ner package resolves `@centrst/blind`
 * to src/, the same core the rest of this script scores.
 * Writes the report and prints the tables RESULTS.md quotes.
 */
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { detectAmounts, parseNumber } from '../../src/amounts.js';
import { dateKey, detectDates, shiftOcc } from '../../src/dates.js';
import { blind } from '../../src/index.js';
import type { Mapping } from '../../src/types.js';
import { FIXED_NOW, loadCorpus, ROOT, SCORED_KINDS, survives, type CorpusFile } from '../../test/support/corpus.js';
import { argValue, blindSpans, cell, collapsedPlaceholders, coverage, ENTITY_TO_KIND, loadNer, loadTc, tcSpecs, timeBlind, MODEL_DIR, pct, readRaw, scoreBlind, scoreExternal, type Card, type ExtFile, type Extra, type Raw } from './lib.js';

const raw: Raw | null = readRaw(join(ROOT, 'reports', 'presidio-raw.json'));
const llmGuard: Raw | null = readRaw(join(ROOT, 'reports', 'llmguard-raw.json'));
const files = loadCorpus();
/** The second GLiNER threshold the + GLiNER 0.5 column runs at. ner/CANDIDATES.md suggests it as the cheapest precision gain. */
const ALT_NER_THRESHOLD = 0.5;
const ALT_ID = `blind:bare+gliner@${ALT_NER_THRESHOLD}`;
const LANGS = ['en', 'es', 'mixed'] as const;

/** The raw output of one external tool configuration, by tool id such as `presidio:default`. */
function external(id: string): (f: CorpusFile) => ExtFile | undefined {
  const [tool, cfg] = id.split(':') as [string, string];
  const src = tool === 'presidio' ? raw : llmGuard;
  return (f) => src?.configs[cfg]?.files[f.name];
}

// ------------------------------------------------- amounts and dates for LLM use

/**
 * Per annotated amount or date, what a model reading the rewritten text gets:
 *   consistent  hidden, and rewritten by one rule for the whole text (blind: one factor
 *               for every amount, one whole-week shift for every date), so sums, ratios,
 *               percentages and intervals computed on the rewritten values map back
 *   clear       left as written, among values that are all as written: usable, not hidden
 *   mixed       left as written in a text where other values of the kind were rewritten,
 *               so arithmetic across them is off by the factor or the shift
 *   lost        replaced by a placeholder or broken, no value left to reason with
 *   other       hidden, but not by the per-text rule (should be zero for blind)
 */
type Fate = 'consistent' | 'clear' | 'mixed' | 'lost' | 'other';
interface Usability {
  annotated: number;
  hidden: number;
  usable: number;
  hiddenAndUsable: number;
  fates: Record<Fate, number>;
  pctHidden: number | null;
  pctUsable: number | null;
  pctHiddenAndUsable: number | null;
}

const newFates = (): Record<Fate, number> => ({ consistent: 0, clear: 0, mixed: 0, lost: 0, other: 0 });

/**
 * `hidden` is the strict scorer's verdict. `hiddenUsable` counts values rewritten by the
 * per-text rule that the scorer also sees as gone: a shifted date whose fake happens to equal
 * another date's real string is consistent but not hidden.
 */
function summarize({ fates, hidden, hiddenUsable }: { fates: Record<Fate, number>; hidden: number; hiddenUsable: number }): Usability {
  const annotated = Object.values(fates).reduce((a, b) => a + b, 0);
  const usable = fates.consistent + fates.clear;
  return {
    annotated,
    hidden,
    usable,
    hiddenAndUsable: hiddenUsable,
    fates,
    pctHidden: pct(hidden, annotated),
    pctUsable: pct(usable, annotated),
    pctHiddenAndUsable: pct(hiddenUsable, annotated),
  };
}

const amountNumber = (value: string): { minor: number; decimals: number } | null => {
  const occ = detectAmounts(value)[0];
  if (occ) return occ;
  const m = /\d[\d.,]*/.exec(value);
  return m ? parseNumber(m[0]) : null;
};
const asNumber = (o: { minor: number; decimals: number }): number => o.minor / 10 ** o.decimals;

/** True when `fake` is `real` times the call's factor, allowing for blind re-deriving sums and percentages from rounded operands. */
function scaledByFactor(real: string, fake: string, factor: number): boolean {
  const r = parseNumber(real);
  const f = parseNumber(fake);
  if (!r || !f) return false;
  const want = asNumber(r) * factor;
  return Math.abs(asNumber(f) - want) <= Math.max(0.05, Math.abs(want) * 0.005);
}

function shiftedByWeeks(real: string, fake: string, m: Mapping): boolean {
  const r = detectDates(real, m.dateOrder)[0];
  const f = detectDates(fake, m.dateOrder)[0];
  if (!r || !f || m.dayShift % 7 !== 0 || m.dayShift === 0) return false;
  return dateKey(shiftOcc(r.occ, m.dayShift, m.refYear)) === dateKey(f.occ);
}

function usabilityBlind(subset: CorpusFile[], mode: 'bare' | 'known', extra?: Extra): { amount: Usability; date: Usability } {
  const out = { amount: { fates: newFates(), hidden: 0, hiddenUsable: 0 }, date: { fates: newFates(), hidden: 0, hiddenUsable: 0 } };
  for (const f of subset) {
    const { text, spans, known, dateOrder } = f.parsed;
    const res = blind([text], { known: mode === 'known' ? known : [], seed: f.name, now: FIXED_NOW, dateOrder, detectors: extra?.(f) ?? [] });
    const text0 = res.texts[0] as string;
    const m = res.mapping;
    for (const kind of ['amount', 'date'] as const) {
      const pairs = m.pairs.filter((p) => p.kind === kind);
      for (const sp of spans.filter((s) => s.kind === kind)) {
        const acc = out[kind];
        const hidden = !survives(kind, sp.value, text0);
        if (hidden) acc.hidden++;
        let pair;
        if (kind === 'amount') {
          const n = amountNumber(sp.value);
          pair = n ? pairs.find((p) => sp.value.includes(p.real) && parseNumber(p.real)?.minor === n.minor) : undefined;
        } else {
          // A span can be a character wider or narrower than the annotation ("22 May." against "22 May").
          pair = pairs.find((p) => p.real === sp.value) ?? pairs.find((p) => sp.value.includes(p.real) || p.real.includes(sp.value));
        }
        if (pair) {
          const ok = kind === 'amount' ? scaledByFactor(pair.real, pair.fake, m.factor) : shiftedByWeeks(pair.real, pair.fake, m);
          acc.fates[ok ? 'consistent' : 'other']++;
          if (ok && hidden) acc.hiddenUsable++;
        } else if (!hidden) acc.fates[pairs.length > 0 ? 'mixed' : 'clear']++;
        else acc.fates.lost++;
      }
    }
  }
  return { amount: summarize(out.amount), date: summarize(out.date) };
}

/**
 * Presidio's replace operator and LLM Guard's placeholders keep no value a model can compute
 * with: a hidden amount or date is lost, a visible one is clear. LLM Guard's vault maps an
 * answer back, but the model only ever sees `[REDACTED_DATE_TIME_1]`.
 */
function usabilityPlaceholders(subset: CorpusFile[], get: (f: CorpusFile) => ExtFile | undefined): { amount: Usability; date: Usability } {
  const out = { amount: { fates: newFates(), hidden: 0, hiddenUsable: 0 }, date: { fates: newFates(), hidden: 0, hiddenUsable: 0 } };
  for (const f of subset) {
    const p = get(f) as ExtFile;
    for (const kind of ['amount', 'date'] as const) {
      for (const sp of f.parsed.spans.filter((s) => s.kind === kind)) {
        const acc = out[kind];
        if (survives(kind, sp.value, p.anonymized)) acc.fates.clear++;
        else {
          acc.hidden++;
          acc.fates.lost++;
        }
      }
    }
  }
  return { amount: summarize(out.amount), date: summarize(out.date) };
}

// -------------------------------------------------------------------- run

const PRESIDIO = raw ? Object.keys(raw.configs) : [];
const LLM_GUARD = llmGuard ? Object.keys(llmGuard.configs) : [];
// The handwritten files did not come from the generator's templates, which the token-classification models were trained on (ner/TRAINED.md).
const subsets: Record<string, CorpusFile[]> = { all: files, ...Object.fromEntries(LANGS.map((l) => [l, files.filter((f) => f.lang === l)])), handwritten: files.filter((f) => f.group === 'handwritten') };

type AnyCard = Card & { roundTrip?: { ok: number; total: number } };
const tools: Record<string, { label: string; card: (s: CorpusFile[]) => AnyCard; use: (s: CorpusFile[]) => { amount: Usability; date: Usability } }> = {};
for (const cfg of PRESIDIO) {
  const get = external(`presidio:${cfg}`);
  tools[`presidio:${cfg}`] = { label: `Presidio ${cfg}`, card: (s) => scoreExternal(s, get, `presidio-raw.json ${cfg}`), use: (s) => usabilityPlaceholders(s, get) };
}
for (const cfg of LLM_GUARD) {
  const get = external(`llmguard:${cfg}`);
  tools[`llmguard:${cfg}`] = { label: `LLM Guard ${cfg}`, card: (s) => scoreExternal(s, get, `llmguard-raw.json ${cfg}`), use: (s) => usabilityPlaceholders(s, get) };
}
if (!raw) console.log('no reports/presidio-raw.json, skipping the Presidio columns (pnpm bench:presidio)');
if (!llmGuard) console.log('no reports/llmguard-raw.json, skipping the LLM Guard columns (pnpm bench:llmguard)');
tools['blind:bare'] = { label: 'blind bare', card: (s) => scoreBlind(s, 'bare'), use: (s) => usabilityBlind(s, 'bare') };
tools['blind:known'] = { label: 'blind known', card: (s) => scoreBlind(s, 'known'), use: (s) => usabilityBlind(s, 'known') };
const gliner = await loadNer(files);
// A second detector threshold, scored beside the default and not instead of it.
const glinerAlt = gliner ? await loadNer(files, { threshold: ALT_NER_THRESHOLD }) : null;
if (gliner) {
  tools['blind:bare+gliner'] = { label: 'blind bare + GLiNER', card: (s) => scoreBlind(s, 'bare', gliner.extra), use: (s) => usabilityBlind(s, 'bare', gliner.extra) };
  if (glinerAlt) tools[ALT_ID] = { label: `blind bare + GLiNER ${ALT_NER_THRESHOLD}`, card: (s) => scoreBlind(s, 'bare', glinerAlt.extra), use: (s) => usabilityBlind(s, 'bare', glinerAlt.extra) };
  tools['blind:known+gliner'] = { label: 'blind known + GLiNER', card: (s) => scoreBlind(s, 'known', gliner.extra), use: (s) => usabilityBlind(s, 'known', gliner.extra) };
} else console.log(`no GLiNER model at ${MODEL_DIR}, skipping the + GLiNER columns (pnpm ner:download)`);
const tcs: Record<string, Awaited<ReturnType<typeof loadTc>>> = {};
for (const spec of tcSpecs()) {
  const tc = await loadTc(files, spec);
  if (!tc) {
    console.log(`no model at ${spec.dir}/${spec.file}, skipping ${spec.name}`);
    continue;
  }
  tcs[spec.name] = tc;
  tools[`blind:bare+tc:${spec.name}`] = { label: `blind bare + ${spec.name}`, card: (s) => scoreBlind(s, 'bare', tc.extra), use: (s) => usabilityBlind(s, 'bare', tc.extra) };
  tools[`blind:known+tc:${spec.name}`] = { label: `blind known + ${spec.name}`, card: (s) => scoreBlind(s, 'known', tc.extra), use: (s) => usabilityBlind(s, 'known', tc.extra) };
}

/** LLM Guard keeps a vault, so its round trip is measured: Deanonymize on the sanitized text gave back the input. */
function llmGuardRoundTrip(cfg: string): Record<string, unknown> {
  const out = Object.values(llmGuard?.configs[cfg]?.files ?? {});
  return {
    possible: true,
    ok: out.filter((r) => r.roundTrip).length,
    total: out.length,
    how: 'Deanonymize(vault).scan(text, sanitized) === the text LLM Guard scanned',
    // llm_guard.py counts these over the text LLM Guard scanned, so the .example rewrite cannot split a value.
    collapsed: { files: out.filter((r) => r.collapsedPlaceholders?.length).length, filesWithReplacements: out.filter((r) => r.replaced.length).length },
    filesWithOutsideChanges: out.filter((r) => r.outsideChanges).length,
  };
}

/** The spans each tool replaced, for the coverage diagnostic. Known mode is left out of it. */
const replacedBy = (id: string): ((f: CorpusFile) => Array<{ start: number; end: number }>) | null => {
  if (id === 'blind:bare') return blindSpans();
  if (id === 'blind:bare+gliner') return gliner ? blindSpans(gliner.extra) : null;
  if (id === ALT_ID) return glinerAlt ? blindSpans(glinerAlt.extra) : null;
  if (id.startsWith('blind:bare+tc:')) return blindSpans(tcs[id.slice('blind:bare+tc:'.length)]?.extra);
  if (id.startsWith('blind')) return null;
  const get = external(id);
  return (f) => get(f)?.replaced ?? [];
};

const results: Record<string, { label: string; cards: Record<string, Card>; usability: { amount: Usability; date: Usability }; roundTrip: Record<string, unknown>; coverage: ReturnType<typeof coverage> | null }> = {};
for (const [id, t] of Object.entries(tools)) {
  const cards = Object.fromEntries(Object.entries(subsets).map(([k, s]) => [k, t.card(s)]));
  const all = cards.all as AnyCard;
  const roundTrip = id.startsWith('blind')
    ? { possible: true, ok: all.roundTrip?.ok, total: all.roundTrip?.total, how: 'unblind(output, mapping) === stripped input' }
    : id.startsWith('llmguard:')
      ? llmGuardRoundTrip(id.slice('llmguard:'.length))
      : { possible: false, ok: 0, total: files.length, how: 'replace keeps no mapping; placeholders are shared across values', collapsed: collapsedPlaceholders(files, external(id)) };
  const spans = replacedBy(id);
  results[id] = { label: t.label, cards, usability: t.use(files), roundTrip, coverage: spans ? coverage(files, spans) : null };
}
const blindMsPerFile = {
  bare: timeBlind(files),
  ...(gliner ? { 'bare+gliner core': timeBlind(files, gliner.extra), 'gliner model per uncached file': gliner.meta.msPerCall } : {}),
  ...(glinerAlt ? { [`gliner model per uncached file at ${ALT_NER_THRESHOLD}`]: glinerAlt.meta.msPerCall } : {}),
  ...Object.fromEntries(Object.entries(tcs).map(([n, tc]) => [`${n} model per uncached file`, tc?.meta.msPerCall])),
};

const git = (cmd: string): string => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
const report = {
  generatedAt: new Date().toISOString(),
  commit: git('git rev-parse HEAD'),
  srcDirty: git('git status --porcelain -- src') !== '',
  node: process.version,
  corpus: { files: files.length, byLang: Object.fromEntries(LANGS.map((l) => [l, subsets[l]?.length ?? 0])) },
  gliner: gliner?.meta ?? null,
  glinerAlt: glinerAlt?.meta ?? null,
  tokenClassifiers: Object.fromEntries(Object.entries(tcs).map(([n, tc]) => [n, tc?.meta])),
  presidio: raw ? { meta: raw.meta, seconds: Object.fromEntries(PRESIDIO.map((c) => [c, raw.configs[c]?.seconds])) } : null,
  llmGuard: llmGuard ? { meta: llmGuard.meta, seconds: Object.fromEntries(LLM_GUARD.map((c) => [c, llmGuard.configs[c]?.seconds])), secondsPerFile: Object.fromEntries(LLM_GUARD.map((c) => [c, llmGuard.configs[c]?.secondsPerFile])) } : null,
  entityToKind: ENTITY_TO_KIND,
  blindMsPerFile,
  results,
};
const outPath = argValue('--out', join('reports', 'presidio-bench.json'));
writeFileSync(resolve(ROOT, outPath), `${JSON.stringify(report, null, 2)}\n`);

// ------------------------------------------------------------------ print

const ids = Object.keys(results);
const head = `| kind | annotated | ${ids.map((i) => results[i]?.label).join(' | ')} |`;
const rule = `| --- | --- | ${ids.map(() => '---').join(' | ')} |`;
for (const sub of Object.keys(subsets)) {
  console.log(`\nStrict recall, ${sub} (${subsets[sub]?.length} files)\n\n${head}\n${rule}`);
  for (const k of SCORED_KINDS) console.log(`| ${k} | ${results[ids[0] as string]?.cards[sub]?.perKind[k].annotated} | ${ids.map((i) => cell(results[i]?.cards[sub]?.perKind[k].recall)).join(' | ')} |`);
}
console.log(`\nPrecision, all files (correct of replaced)\n\n| kind | ${ids.map((i) => results[i]?.label).join(' | ')} |\n| --- | ${ids.map(() => '---').join(' | ')} |`);
for (const k of SCORED_KINDS) {
  console.log(`| ${k} | ${ids.map((i) => { const r = results[i]?.cards.all?.perKind[k]; return r ? `${cell(r.precision)} (${r.correct}/${r.replaced})` : ''; }).join(' | ')} |`);
}
console.log(`| any kind | ${ids.map((i) => { const r = results[i]?.cards.all?.anyKind; return r ? `${cell(r.precision)} (${r.overlapping}/${r.replaced})` : ''; }).join(' | ')} |`);
console.log('\nUnmapped entities:', ids.map((i) => `${i} ${JSON.stringify(results[i]?.cards.all?.unmapped)}`).join(', '));
console.log(`\nAmounts and dates for LLM use, all files\n\n| tool | amounts hidden | amounts usable | amounts hidden and usable | dates hidden | dates usable | dates hidden and usable | round trip |\n| --- | --- | --- | --- | --- | --- | --- | --- |`);
for (const i of ids) {
  const r = results[i];
  if (!r) continue;
  const u = r.usability;
  const rt = r.roundTrip as { possible: boolean; ok: number; total: number };
  console.log(`| ${r.label} | ${cell(u.amount.pctHidden)} | ${cell(u.amount.pctUsable)} | ${cell(u.amount.pctHiddenAndUsable)} | ${cell(u.date.pctHidden)} | ${cell(u.date.pctUsable)} | ${cell(u.date.pctHiddenAndUsable)} | ${rt.possible ? `${rt.ok}/${rt.total}` : 'not possible'} |`);
}
console.log('\nFates:', ids.map((i) => `\n  ${i} amount ${JSON.stringify(results[i]?.usability.amount.fates)} date ${JSON.stringify(results[i]?.usability.date.fates)}`).join(''));
for (const i of ids.filter((x) => !x.startsWith('blind'))) console.log(`${i} collapsed placeholders:`, JSON.stringify((results[i]?.roundTrip as { collapsed: unknown }).collapsed));
for (const i of ids.filter((x) => x.startsWith('llmguard'))) console.log(`${i} files with changes outside placeholders:`, (results[i]?.roundTrip as { filesWithOutsideChanges: number }).filesWithOutsideChanges);
const covIds = ids.filter((i) => results[i]?.coverage);
console.log(`\nFully covered (diagnostic), all files\n\n| kind | ${covIds.map((i) => results[i]?.label).join(' | ')} |\n| --- | ${covIds.map(() => '---').join(' | ')} |`);
for (const k of SCORED_KINDS) console.log(`| ${k} | ${covIds.map((i) => cell(results[i]?.coverage?.[k].pct)).join(' | ')} |`);
console.log('\nblind ms per file:', JSON.stringify(blindMsPerFile));
if (llmGuard) console.log('\nLLM Guard seconds per file:', LLM_GUARD.map((c) => `${c} ${llmGuard.configs[c]?.secondsPerFile}`).join(', '), `on ${String(llmGuard.meta.device)}`);
console.log(`\nwrote ${outPath}`);
