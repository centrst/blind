/**
 * Step 4 of `pnpm bench:gretel`: score Presidio, LLM Guard and blind on the Gretel sample.
 *
 * Reads reports/gretel-input.json (gretel_sample.py), reports/gretel-presidio-raw.json
 * (presidio.py) and reports/gretel-llmguard-raw.json (llm_guard.py), skipping a tool whose
 * file is missing. Gretel's labels become the scorer's spans through LABEL_TO_KIND, and every
 * tool is scored with the same rules as on blind's corpus (scripts/bench/lib.ts): strict recall
 * through `survives`, precision as the share of replaced spans that overlap a label of the same
 * kind. Labels with no blind kind are scored apart as "unscored", recall only.
 * blind runs bare, and with the GLiNER detector when the weights are in ner/models, at the
 * detector's default threshold and once more at ALT_NER_THRESHOLD. There is
 * no `known` run: Gretel's documents come with no owner list.
 * Writes reports/gretel-bench.json and prints the tables RESULTS-llmguard-gretel.md quotes.
 *
 * Options, all optional, so `pnpm bench:gretel` runs as before. Paths are relative to the
 * repository root. For comparing GLiNER models see ner/CANDIDATES.md, for trained token
 * classifiers ner/TRAINED.md.
 *   --input <path>     another dataset in the same shape (default reports/gretel-input.json;
 *                      ner/train/prepare.py evalsets writes the held-out ones). Its meta may carry
 *                      its own `labelToKind` and `unscored`, which then replace Gretel's.
 *   --raw-prefix <x>   read reports/<x>-presidio-raw.json and reports/<x>-llmguard-raw.json (default gretel)
 *   --out <path>       where to write the JSON (default reports/gretel-bench.json)
 *   --model <dir>      the GLiNER model directory for both + GLiNER columns (default $BLIND_NER_MODEL,
 *                      then ner/models/gliner_multi-v2.1)
 *   --threshold <t>    the threshold of the first + GLiNER column (default 0.3)
 *   --labels k=v,...   GLiNER labels per kind, over the defaults, for example place=address
 *   --tc <name>=<dir>[,<file>[,<threshold>]]   add a token-classification model column, repeatable.
 *                      Its labels are fixed at training time, so --labels does not apply to it.
 *   --ner-only         leave out Presidio, LLM Guard and blind bare, keeping the NER columns
 * Cards come for the whole set, for each language with files (when the set has more than one),
 * and for two fixed halves, `half-a` and `half-b`: within each language the files alternate in
 * input order. Tune on one half, report the other. An empty half is left out.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { blind } from '../../src/index.js';
import { FIXED_NOW, ROOT, SCORED_KINDS, survives, type CorpusFile, type ScoredKind } from '../../test/support/corpus.js';
import { argValue, blindSpans, cell, coverage, ENTITY_TO_KIND, loadNer, loadTc, MODEL_DIR, readRaw, scoreBlind, scoreExternal, tcSpecs, timeBlind, type BlindCard, type Card, type ExtFile, type Extra, type Raw } from './lib.js';

interface GFile {
  name: string;
  lang: 'en' | 'es';
  documentType: string;
  text: string;
  spans: Array<{ start: number; end: number; label: string }>;
}

/**
 * Gretel labels onto blind's scored kinds. bban goes to id, not iban: a BBAN is a domestic
 * account number with no country code or IBAN check digits, so neither blind's nor Presidio's
 * IBAN recognizer is meant to find it, and every tool types it as an account or id number if at all.
 */
export const LABEL_TO_KIND: Record<string, ScoredKind> = {
  name: 'person',
  first_name: 'person',
  last_name: 'person',
  company: 'org',
  street_address: 'place',
  email: 'email',
  phone_number: 'phone',
  iban: 'iban',
  bban: 'id',
  credit_card_number: 'id',
  ssn: 'id',
  passport_number: 'id',
  driver_license_number: 'id',
  customer_id: 'id',
  employee_id: 'id',
  bank_routing_number: 'id',
  swift_bic_code: 'id',
  ipv4: 'id',
  ipv6: 'id',
  date: 'date',
  date_of_birth: 'date',
  date_time: 'date',
};
/** Labels with no blind kind. Scored for recall only, never folded into the per-kind rows. */
export const UNSCORED = ['time', 'password', 'api_key', 'account_pin', 'credit_card_security_code', 'user_name', 'local_latlng'] as const;

const inputPath = argValue('--input', join('reports', 'gretel-input.json'));
const outPath = resolve(ROOT, argValue('--out', join('reports', 'gretel-bench.json')));
const rawPrefix = argValue('--raw-prefix', 'gretel');
const modelDir = resolve(ROOT, argValue('--model', MODEL_DIR));
const threshold = process.argv.includes('--threshold') ? Number(argValue('--threshold', '')) : undefined;
const nerOnly = process.argv.includes('--ner-only');
const nerLabels = process.argv.includes('--labels') ? Object.fromEntries(argValue('--labels', '').split(',').filter(Boolean).map((kv) => kv.split('=') as [string, string])) : undefined;

const input = JSON.parse(readFileSync(resolve(ROOT, inputPath), 'utf8')) as { meta: Record<string, unknown> & { labelToKind?: Record<string, ScoredKind>; unscored?: string[] }; files: GFile[] };
const labelToKind: Record<string, ScoredKind> = input.meta.labelToKind ?? LABEL_TO_KIND;
const unscoredLabels: readonly string[] = input.meta.unscored ?? UNSCORED;
const unknown = [...new Set(input.files.flatMap((f) => f.spans.map((s) => s.label)))].filter((l) => !labelToKind[l] && !unscoredLabels.includes(l));
if (unknown.length) throw new Error(`Labels with no mapping in ${inputPath}: ${unknown.join(', ')}`);

/** A Gretel row in the corpus scorer's shape. Unscored labels keep a kind the scorer skips. */
const files: CorpusFile[] = input.files.map((g) => ({
  name: g.name,
  group: 'generated',
  category: g.documentType,
  lang: g.lang,
  source: g.text,
  parsed: {
    text: g.text,
    spans: g.spans.map((s) => ({ kind: labelToKind[s.label] ?? `unscored:${s.label}`, value: g.text.slice(s.start, s.end), start: s.start, end: s.end })),
    known: [],
    dateOrder: 'dmy',
  },
}));
/** The second GLiNER threshold the + GLiNER 0.5 column runs at. ner/CANDIDATES.md suggests it as the cheapest precision gain. */
const ALT_NER_THRESHOLD = 0.5;
const byLang = Object.fromEntries((['en', 'es'] as const).map((l) => [l, files.filter((f) => f.lang === l)]));
const half = (h: 0 | 1): CorpusFile[] => Object.values(byLang).flatMap((s) => s.filter((_, i) => i % 2 === h));
const subsets: Record<string, CorpusFile[]> = Object.fromEntries(
  Object.entries({ all: files, ...byLang, 'half-a': half(0), 'half-b': half(1) }).filter(([k, s]) => k === 'all' || (s.length > 0 && (k.startsWith('half-') || s.length < files.length))),
);

// ------------------------------------------------------------------ tools

const presidio = nerOnly ? null : readRaw(join(ROOT, 'reports', `${rawPrefix}-presidio-raw.json`));
const llmGuard = nerOnly ? null : readRaw(join(ROOT, 'reports', `${rawPrefix}-llmguard-raw.json`));
if (!presidio && !nerOnly) console.log(`no reports/${rawPrefix}-presidio-raw.json, skipping Presidio`);
if (!llmGuard && !nerOnly) console.log(`no reports/${rawPrefix}-llmguard-raw.json, skipping LLM Guard`);

interface Tool {
  label: string;
  card: (s: CorpusFile[]) => Card | BlindCard;
  /** The text the tool sends on, per file. */
  output: (f: CorpusFile) => string;
  /** Replaced spans with blind's kind for each (undefined for an entity with no blind kind). */
  spans: (f: CorpusFile) => Array<{ start: number; end: number; kind: string | undefined }>;
  roundTrip: () => Record<string, unknown>;
  msPerFile: () => number | null;
}
const tools: Record<string, Tool> = {};

function addExternal(prefix: string, name: string, raw: Raw | null): void {
  for (const cfg of Object.keys(raw?.configs ?? {})) {
    const c = raw?.configs[cfg];
    const get = (f: CorpusFile): ExtFile | undefined => c?.files[f.name];
    const out = Object.values(c?.files ?? {});
    tools[`${prefix}:${cfg}`] = {
      label: `${name} ${cfg}`,
      card: (s) => scoreExternal(s, get, `${prefix} ${cfg}`),
      output: (f) => (get(f) as ExtFile).anonymized,
      spans: (f) => (get(f) as ExtFile).replaced.map((r) => ({ start: r.start, end: r.end, kind: ENTITY_TO_KIND[r.entity] })),
      roundTrip: () =>
        prefix === 'llmguard'
          ? { possible: true, ok: out.filter((r) => r.roundTrip).length, total: out.length, collapsedFiles: out.filter((r) => r.collapsedPlaceholders?.length).length, filesWithOutsideChanges: out.filter((r) => r.outsideChanges).length }
          : { possible: false },
      msPerFile: () => (c ? Math.round((c.secondsPerFile ?? c.seconds / Math.max(1, out.length)) * 10000) / 10 : null),
    };
  }
}
addExternal('presidio', 'Presidio', presidio);
addExternal('llmguard', 'LLM Guard', llmGuard);

function addBlind(id: string, label: string, extra?: Extra, modelMs?: () => number | null): void {
  const outputs = new Map<string, string>();
  const output = (f: CorpusFile): string => {
    let o = outputs.get(f.name);
    if (o === undefined) {
      o = blind([f.parsed.text], { seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder, detectors: extra?.(f) ?? [] }).texts[0] as string;
      outputs.set(f.name, o);
    }
    return o;
  };
  let card: BlindCard | undefined;
  tools[id] = {
    label,
    card: (s) => {
      const c = scoreBlind(s, 'bare', extra);
      if (s === files) card = c;
      return c;
    },
    output,
    spans: blindSpans(extra),
    roundTrip: () => ({ possible: true, ok: card?.roundTrip.ok, total: card?.roundTrip.total }),
    msPerFile: () => {
      const core = timeBlind(files, extra);
      const model = modelMs?.() ?? 0;
      return Math.round((core + model) * 10) / 10;
    },
  };
}
if (!nerOnly) addBlind('blind:bare', 'blind bare');
const gliner = await loadNer(files, { dir: modelDir, threshold, ...(nerLabels ? { labels: nerLabels } : {}) });
if (gliner) addBlind('blind:bare+gliner', 'blind bare + GLiNER', gliner.extra, () => (gliner.meta.msPerCall as number | null) ?? null);
else console.log(`no GLiNER model at ${modelDir}, skipping blind bare + GLiNER (pnpm ner:download)`);
// A second detector threshold, scored beside the default and not instead of it.
const glinerAlt = gliner ? await loadNer(files, { dir: modelDir, threshold: ALT_NER_THRESHOLD, ...(nerLabels ? { labels: nerLabels } : {}) }) : null;
if (glinerAlt) addBlind(`blind:bare+gliner@${ALT_NER_THRESHOLD}`, `blind bare + GLiNER ${ALT_NER_THRESHOLD}`, glinerAlt.extra, () => (glinerAlt.meta.msPerCall as number | null) ?? null);
const tcMeta: Record<string, Record<string, unknown>> = {};
for (const spec of tcSpecs()) {
  const tc = await loadTc(files, spec);
  if (!tc) {
    console.log(`no model at ${spec.dir}/${spec.file}, skipping ${spec.name}`);
    continue;
  }
  tcMeta[spec.name] = tc.meta;
  addBlind(`blind:bare+tc:${spec.name}`, `blind bare + ${spec.name}`, tc.extra, () => (tc.meta.msPerCall as number | null) ?? null);
}

// ------------------------------------------------------------------ score

/**
 * Gretel's date label also covers durations, frequencies, bare years and phrases ("30 years",
 * "monthly", "2021", "el año anterior"). A diagnostic split, not a rescoring: a date label is
 * "calendar" when it has a day and a month, or a month and a year, as digits or with a month
 * name. The headline date row keeps every label.
 */
const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|ene|abr|ago|dic|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
const CALENDAR = new RegExp(String.raw`\d{1,4}[/.-]\d{1,2}|(?<![\d])\d{8}(?![\d])|\d(?:st|nd|rd|th)?\s*(?:of\s+|de\s+)?(?:${MONTHS})\b|\b(?:${MONTHS})\.?\s*\d|\d{1,2}[/-](?:${MONTHS})\b`, 'iu');
const isCalendar = (value: string): boolean => CALENDAR.test(value);

function dateSplit(t: Tool): Record<'calendar' | 'other', { annotated: number; gone: number; recall: number | null }> {
  const out = { calendar: { annotated: 0, gone: 0, recall: null as number | null }, other: { annotated: 0, gone: 0, recall: null as number | null } };
  for (const f of files) {
    for (const sp of f.parsed.spans.filter((s) => s.kind === 'date')) {
      const a = out[isCalendar(sp.value) ? 'calendar' : 'other'];
      a.annotated++;
      if (!survives('date', sp.value, t.output(f))) a.gone++;
    }
  }
  for (const a of Object.values(out)) a.recall = a.annotated ? Math.round((a.gone / a.annotated) * 10000) / 100 : null;
  return out;
}

/**
 * "Any kind" counts every replaced span. Gretel labels no amounts and no URLs, so a tool that
 * replaces them loses there for doing its job. This variant leaves out spans of kinds Gretel
 * does not label (amount, url, blind's domain, and entities with no blind kind).
 */
function anyLabelledKind(kindOf: (f: CorpusFile) => Array<{ start: number; end: number; kind: string | undefined }>): { replaced: number; overlapping: number; precision: number | null } {
  let replaced = 0;
  let overlapping = 0;
  for (const f of files) {
    for (const r of kindOf(f)) {
      if (!r.kind || r.kind === 'amount' || r.kind === 'url' || r.kind === 'domain') continue;
      replaced++;
      if (f.parsed.spans.some((s) => s.start < r.end && r.start < s.end)) overlapping++;
    }
  }
  return { replaced, overlapping, precision: replaced ? Math.round((overlapping / replaced) * 10000) / 100 : null };
}

/** Strict recall on the labels blind has no kind for, per label. */
function unscored(t: Tool): Record<string, { annotated: number; gone: number; recall: number | null }> {
  const out: Record<string, { annotated: number; gone: number; recall: number | null }> = {};
  for (const label of unscoredLabels) {
    let annotated = 0;
    let gone = 0;
    for (const f of files) {
      for (const sp of f.parsed.spans.filter((s) => s.kind === `unscored:${label}`)) {
        annotated++;
        if (!survives('other', sp.value, t.output(f))) gone++;
      }
    }
    out[label] = { annotated, gone, recall: annotated ? Math.round((gone / annotated) * 10000) / 100 : null };
  }
  return out;
}

const results: Record<string, { label: string; cards: Record<string, Card>; anyLabelledKind: ReturnType<typeof anyLabelledKind>; dates: ReturnType<typeof dateSplit>; coverage: ReturnType<typeof coverage>; unscored: ReturnType<typeof unscored>; roundTrip: Record<string, unknown>; msPerFile: number | null }> = {};
for (const [id, t] of Object.entries(tools)) {
  const cards = Object.fromEntries(Object.entries(subsets).map(([k, s]) => [k, t.card(s)]));
  results[id] = { label: t.label, cards, anyLabelledKind: anyLabelledKind(t.spans), dates: dateSplit(t), coverage: coverage(files, t.spans), unscored: unscored(t), roundTrip: t.roundTrip(), msPerFile: t.msPerFile() };
}

const labelCounts: Record<string, number> = {};
for (const f of input.files) for (const s of f.spans) labelCounts[s.label] = (labelCounts[s.label] ?? 0) + 1;

const git = (cmd: string): string => {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
};
writeFileSync(
  outPath,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      commit: git('git rev-parse HEAD'),
      srcDirty: git('git status --porcelain -- src') !== '',
      node: process.version,
      sample: input.meta,
      input: inputPath,
      byLang: Object.fromEntries(Object.entries(byLang).map(([l, s]) => [l, s.length])),
      halves: { 'half-a': subsets['half-a']?.length ?? 0, 'half-b': subsets['half-b']?.length ?? 0, rule: 'within each language, alternate files in input order: even index half-a, odd half-b' },
      labelCounts,
      labelToKind,
      unscoredLabels,
      dateOrder: 'dmy, blind default, for every file',
      gliner: gliner?.meta ?? null,
      glinerAlt: glinerAlt?.meta ?? null,
      tokenClassifiers: tcMeta,
      presidio: presidio?.meta ?? null,
      llmGuard: llmGuard?.meta ?? null,
      results,
    },
    null,
    2,
  )}\n`,
);

// ------------------------------------------------------------------ print

const ids = Object.keys(results);
const labels = ids.map((i) => results[i]?.label).join(' | ');
const rule = ids.map(() => '---').join(' | ');
for (const sub of Object.keys(subsets)) {
  console.log(`\nStrict recall, Gretel ${sub} (${subsets[sub]?.length} files)\n\n| kind | annotated | ${labels} |\n| --- | --- | ${rule} |`);
  for (const k of SCORED_KINDS) {
    const n = results[ids[0] as string]?.cards[sub]?.perKind[k].annotated;
    if (!n) continue;
    console.log(`| ${k} | ${n} | ${ids.map((i) => cell(results[i]?.cards[sub]?.perKind[k].recall)).join(' | ')} |`);
  }
}
console.log(`\nPrecision, Gretel all (correct of replaced)\n\n| kind | ${labels} |\n| --- | ${rule} |`);
for (const k of SCORED_KINDS) {
  console.log(`| ${k} | ${ids.map((i) => { const r = results[i]?.cards.all?.perKind[k]; return r ? `${cell(r.precision)} (${r.correct}/${r.replaced})` : ''; }).join(' | ')} |`);
}
console.log(`| any kind | ${ids.map((i) => { const r = results[i]?.cards.all?.anyKind; return r ? `${cell(r.precision)} (${r.overlapping}/${r.replaced})` : ''; }).join(' | ')} |`);
console.log(`| any labelled kind | ${ids.map((i) => { const r = results[i]?.anyLabelledKind; return r ? `${cell(r.precision)} (${r.overlapping}/${r.replaced})` : ''; }).join(' | ')} |`);
const d0 = results[ids[0] as string]?.dates;
console.log(`\nDate labels split (diagnostic), Gretel all\n\n| date labels | annotated | ${labels} |\n| --- | --- | ${rule} |`);
for (const k of ['calendar', 'other'] as const) console.log(`| ${k} | ${d0?.[k].annotated} | ${ids.map((i) => cell(results[i]?.dates[k].recall)).join(' | ')} |`);
console.log(`\nFully covered (diagnostic), Gretel all\n\n| kind | ${labels} |\n| --- | ${rule} |`);
for (const k of SCORED_KINDS) {
  if (!results[ids[0] as string]?.coverage[k].annotated) continue;
  console.log(`| ${k} | ${ids.map((i) => cell(results[i]?.coverage[k].pct)).join(' | ')} |`);
}
console.log(`\nUnscored labels, strict recall, Gretel all\n\n| label | annotated | ${labels} |\n| --- | --- | ${rule} |`);
for (const l of unscoredLabels) console.log(`| ${l} | ${results[ids[0] as string]?.unscored[l]?.annotated} | ${ids.map((i) => cell(results[i]?.unscored[l]?.recall)).join(' | ')} |`);
console.log('\nUnmapped entities:', ids.map((i) => `${i} ${JSON.stringify(results[i]?.cards.all?.unmapped)}`).join(', '));
console.log('\nRound trip:', ids.map((i) => `\n  ${i} ${JSON.stringify(results[i]?.roundTrip)}`).join(''));
console.log('\nms per file:', ids.map((i) => `${i} ${results[i]?.msPerFile}`).join(', '));
console.log(`\nwrote ${outPath}`);
