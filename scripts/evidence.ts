/**
 * pnpm evidence: write reports/evidence.html, one self-contained page with the
 * claims, the corpus scorecard against its floors, the mutation score, the
 * known misses, ten side-by-side examples and the commit, seed and command.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadAdversarial } from '../test/support/adversarial.js';
import { FIXED_NOW, loadCorpus, loadFloors, ROOT, SCORED_KINDS, scoreCorpus, type Mode, type Scorecard } from '../test/support/corpus.js';
import { survivors } from '../test/support/mutation.js';
import { blind } from '../src/index.js';
import { claimStatus, evaluateClaims, loadMutation, mutationFloor } from './lib/claims.js';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const git = (...args: string[]): string => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
};

const commit = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain') !== '';
const seedPath = join(ROOT, 'reports', 'seed.txt');
const seed = existsSync(seedPath) ? readFileSync(seedPath, 'utf8').trim() : 'not recorded (run pnpm test)';
const command = process.env.EVIDENCE_COMMAND ?? 'pnpm verify';

const { claims, problems, testCount } = evaluateClaims({ full: process.argv.includes('--full') });
const files = loadCorpus();
const floors = loadFloors();
const cards: Record<Mode, Scorecard> = { bare: scoreCorpus(files, 'bare'), known: scoreCorpus(files, 'known') };
const mutation = loadMutation();
const adv = loadAdversarial();

const cell = (value: number, floor: number | undefined): string => {
  const ok = floor === undefined || value >= floor;
  return `<td class="num ${ok ? 'ok' : 'bad'}">${value.toFixed(2)}%</td><td class="num dim">${floor ?? '-'}%</td>`;
};

function scoreTable(mode: Mode, title: string, blurb: string): string {
  const c = cards[mode];
  const f = floors?.[mode];
  const rows = SCORED_KINDS.map((k) => {
    const s = c.perKind[k];
    return `<tr><td>${k}</td><td class="num">${s.annotated}</td>${cell(s.recall, f?.recall[k])}<td class="num dim">${s.coverage.toFixed(2)}%</td><td class="num">${s.replaced}</td>${cell(s.precision, f?.precision[k])}</tr>`;
  }).join('');
  return `<h3>${esc(title)}</h3><p class="note">${esc(blurb)}</p>
<table><thead><tr><th>kind</th><th>annotated</th><th>recall</th><th>floor</th><th>span coverage</th><th>replaced</th><th>precision</th><th>floor</th></tr></thead><tbody>${rows}</tbody></table>
<p class="note">Round trip ${c.roundTrip.ok} of ${c.roundTrip.total} files. The leak check flagged ${c.safetyNet.flagged} of the ${c.safetyNet.filesWithMisses} files that still hold an undetected value, with ${c.safetyNet.falseAlarms} false alarms.</p>`;
}

const claimRows = claims
  .map((c) => `<tr class="${claimStatus(c)}"><td>${c.id}</td><td>${esc(c.text)}</td><td class="num">${c.passed}/${c.tests.length}</td><td>${claimStatus(c)}${c.problems.length || c.notes.length ? `<br><span class="dim">${esc([...c.problems, ...c.notes].join('; '))}</span>` : ''}</td></tr>`)
  .join('');

const safety = mutation ? survivors(mutation.report, /src\/(leaks|amounts|dates)\.ts$/) : [];
const survivorRows = safety
  .map((s) => `<tr><td>${esc(s.file.replace(/^.*src\//, 'src/'))}:${s.line}</td><td>${esc(s.mutator)}</td><td><code>${esc(s.original)}</code></td><td><code>${esc(s.replacement)}</code></td><td>${s.status === 'NoCoverage' ? 'no coverage' : 'survived'}</td></tr>`)
  .join('');

const misses = adv.flatMap((f) => f.cases.filter((c) => c.expect === 'silent').map((c) => ({ ...c, category: f.category })));
const caughtCount = adv.flatMap((f) => f.cases).filter((c) => c.expect !== 'silent').length;
const missRows = misses
  .map((m) => `<tr><td>${m.id}</td><td>${m.category}</td><td><code>${esc(JSON.stringify(m.text))}</code></td><td>${esc(m.why ?? '')}</td></tr>`)
  .join('');

// Ten examples, spread over categories, from the corpus with the owner's known values.
const wanted = ['booking', 'invoice', 'tax', 'forward', 'newsletter', 'security', 'thread', 'invoice', 'tax', 'booking'];
const used = new Set<string>();
const examples = wanted
  .map((cat, i) => {
    const pool = files.filter((f) => f.category === cat && !used.has(f.name));
    return pool[(i * 7) % Math.max(1, pool.length)] ?? null;
  })
  .filter((f): f is NonNullable<typeof f> => f !== null)
  .map((f) => {
    used.add(f.name);
    const res = blind([f.parsed.text], { known: f.parsed.known, seed: `evidence-${f.name}`, now: FIXED_NOW, dateOrder: f.parsed.dateOrder });
    return `<div class="pair"><div><h4>${esc(f.name)} <span class="dim">real</span></h4><pre>${esc(f.parsed.text)}</pre></div><div><h4>${esc(f.category)} <span class="dim">blind${res.leaks.ok ? '' : ', leak check flagged'}</span></h4><pre>${esc(res.texts[0] as string)}</pre></div></div>`;
  })
  .join('');

// Optional NER package: the last `pnpm ner:eval`, if there is one.
const nerPath = join(ROOT, 'reports', 'ner-corpus.json');
interface NerMode { base: { perKind: Record<string, { recall: number; precision: number }>; roundTrip: { ok: number; total: number } }; ner: { perKind: Record<string, { recall: number; precision: number }>; roundTrip: { ok: number; total: number } } }
const nerRun = existsSync(nerPath) ? (JSON.parse(readFileSync(nerPath, 'utf8')) as { model: string; threshold: number; bare: NerMode; known: NerMode }) : null;
const nerSection = nerRun
  ? `<h2>Optional NER detector</h2>
<p class="note">Last <code>pnpm ner:eval</code>: ${esc(nerRun.model)}, threshold ${nerRun.threshold}. Strict recall and precision per kind, blind alone against blind with the detector. Claims C13 to C18 cover it. The corpus is synthetic, so read these as a ceiling.</p>
${(['known', 'bare'] as const)
  .map((m) => {
    const r = nerRun[m];
    const rows = SCORED_KINDS.map((k) => `<tr><td>${k}</td><td class="num">${r.base.perKind[k]?.recall.toFixed(1)}%</td><td class="num">${r.ner.perKind[k]?.recall.toFixed(1)}%</td><td class="num">${r.base.perKind[k]?.precision.toFixed(1)}%</td><td class="num">${r.ner.perKind[k]?.precision.toFixed(1)}%</td></tr>`).join('');
    return `<h3>${m === 'known' ? 'With known values' : 'With no known values'}, round trip ${r.ner.roundTrip.ok} of ${r.ner.roundTrip.total}</h3><table><thead><tr><th>kind</th><th>recall before</th><th>recall after</th><th>precision before</th><th>precision after</th></tr></thead><tbody>${rows}</tbody></table>`;
  })
  .join('')}`
  : '';

const allOk = problems.length === 0;
const notRun = claims.filter((c) => c.notes.length).length;
const backedText = notRun ? `${claims.length - notRun} claims backed, ${notRun} not run in this gate` : 'all claims backed';
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>blind evidence report</title>
<style>
:root{--bg:#fbfaf8;--fg:#1c1b19;--dim:#6b6860;--line:#dedbd3;--ok:#1d6b3a;--bad:#a1291f;--card:#fff;--code:#f2efe8}
@media (prefers-color-scheme:dark){:root{--bg:#161614;--fg:#ecebe6;--dim:#9a978e;--line:#34322d;--ok:#6bcb8b;--bad:#ff8a7d;--card:#1f1e1b;--code:#262521}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}h1{font-size:28px;margin:0 0 4px}h2{margin:40px 0 8px;font-size:20px;border-bottom:1px solid var(--line);padding-bottom:6px}h3{margin:24px 0 4px;font-size:16px}h4{margin:0 0 4px;font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);font-size:14px}th,td{padding:6px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{font-weight:600;color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
td.num{text-align:right;font-variant-numeric:tabular-nums}.ok{color:var(--ok)}.bad{color:var(--bad)}.dim,.note{color:var(--dim)}.note{margin:4px 0 8px;font-size:13px}
tr.fail td:first-child{border-left:3px solid var(--bad)}tr.pass td:first-child{border-left:3px solid var(--ok)}
code,pre{font:12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code)}code{padding:1px 4px;border-radius:3px;word-break:break-word}
pre{margin:0;padding:10px;border:1px solid var(--line);white-space:pre-wrap;word-break:break-word;border-radius:4px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0 0 20px}@media (max-width:760px){.pair{grid-template-columns:1fr}}
.meta{display:grid;grid-template-columns:max-content 1fr;gap:2px 16px;font-size:14px}.meta dt{color:var(--dim)}.meta dd{margin:0;word-break:break-all}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:13px;border:1px solid currentColor}details{margin:8px 0}summary{cursor:pointer;color:var(--dim)}
.scroll{overflow-x:auto}
</style></head><body><main>
<h1>blind evidence report</h1>
<p><span class="badge ${allOk ? 'ok' : 'bad'}">${allOk ? backedText : `${problems.length} problem(s)`}</span></p>
<dl class="meta">
<dt>commit</dt><dd>${esc(commit)}${dirty ? ' (working tree had uncommitted changes)' : ''}</dd>
<dt>property seed</dt><dd>${esc(seed)}</dd>
<dt>command</dt><dd><code>${esc(command)}</code></dd>
<dt>node</dt><dd>${esc(process.version)}</dd>
<dt>tests in report</dt><dd>${testCount}</dd>
</dl>

<h2>Claims</h2>
<p class="note">Each row is a promise. Tests carry the claim ID in their name, so this table is built from the test report and cannot drift from it. The full list of tests per claim is in CLAIMS.md.</p>
<div class="scroll"><table><thead><tr><th>ID</th><th>Claim</th><th>Tests passing</th><th>Result</th></tr></thead><tbody>${claimRows}</tbody></table></div>

<h2>Detection on the labeled corpus</h2>
<p class="note">${files.length} synthetic emails (${files.filter((f) => f.group === 'generated').length} generated by a committed script, ${files.filter((f) => f.group === 'handwritten').length} handwritten). Recall is the share of annotated values that are gone from the blind text. The span coverage column is the share a detector span fully covered, kept as a diagnostic because it overstates recall. Precision is the share of replaced spans that overlap an annotation of the same kind. Floors move up as detection improves. The one reset, when recall switched to the strict definition, is recorded in TESTING.md.</p>
${scoreTable('known', 'With the owner\'s known values', 'The owner passes their own names, orgs and places. This is how the CLI is meant to be used.')}
${scoreTable('bare', 'With no known values', 'The worst case. Names, orgs and places are only found next to an email address until a NER detector is plugged in, so person recall is low and the floor says so.')}

${nerSection}

<h2>Mutation testing</h2>
${
  mutation
    ? `<p>Score <strong>${mutation.score.toFixed(2)}%</strong> against a floor of ${mutationFloor()}%. Stryker changes the code in src/ and checks that a test fails. Surviving mutants in the three files that carry the safety claims are listed below for review.</p>
<p class="note">${safety.length} surviving or uncovered mutants in leaks.ts, amounts.ts and dates.ts.</p>
<details><summary>Show the ${safety.length} mutants</summary><div class="scroll"><table><thead><tr><th>where</th><th>mutator</th><th>original</th><th>mutant</th><th>status</th></tr></thead><tbody>${survivorRows}</tbody></table></div></details>`
    : '<p class="bad">No mutation report. Run <code>pnpm mutation</code>.</p>'
}

<h2>Known misses</h2>
<p class="note">${misses.length} adversarial inputs slip through silently and ${caughtCount} are caught, either replaced or reported by the leak check. Every miss has a test marked expected-to-fail, so a fix shows up as a failing build until the list is updated.</p>
<div class="scroll"><table><thead><tr><th>ID</th><th>category</th><th>input</th><th>what slips and why</th></tr></thead><tbody>${missRows}</tbody></table></div>

<h2>Ten examples</h2>
<p class="note">Real on the left, blind on the right. Both are invented. The right side is what a lab model sees.</p>
${examples}
</main></body></html>
`;
mkdirSync(join(ROOT, 'reports'), { recursive: true });
writeFileSync(join(ROOT, 'reports', 'evidence.html'), html);
console.log(`reports/evidence.html written (${(html.length / 1024).toFixed(0)} KB). ${problems.length ? `${problems.length} claim problem(s).` : `${backedText[0]?.toUpperCase()}${backedText.slice(1)}.`}`);
