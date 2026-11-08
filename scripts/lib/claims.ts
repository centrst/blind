/** Claim bookkeeping shared by `pnpm claims` and `pnpm evidence`. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../../test/support/corpus.js';
import { mutationScore, type MutationReport } from '../../test/support/mutation.js';

export interface TestRecord {
  title: string;
  fullName: string;
  status: string;
}

export interface Claim {
  id: string;
  text: string;
  evidence: string;
  tests: TestRecord[];
  passed: number;
  failed: number;
  skipped: number;
  /** Hard failures. Any of these fails `pnpm claims`. */
  problems: string[];
  /** Soft notes on a NER claim whose tests did not run. `--strict` turns them into problems. */
  notes: string[];
}

export type ClaimStatus = 'pass' | 'fail' | 'skipped';

const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const idNum = (id: string): number => Number(id.slice(1));

/** Claim rows from the table in TESTING.md. */
export function declaredClaims(): Array<{ id: string; text: string; evidence: string }> {
  const rows: Array<{ id: string; text: string; evidence: string }> = [];
  for (const line of read('TESTING.md').split('\n')) {
    const m = /^\|\s*(C\d+)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (m) rows.push({ id: m[1] as string, text: m[2] as string, evidence: m[3] as string });
  }
  return rows;
}

/** Every claim ID mentioned in the README or in TESTING.md. */
export function referencedClaimIds(): string[] {
  const ids = new Set<string>();
  for (const f of ['README.md', 'TESTING.md']) for (const m of read(f).matchAll(/\bC\d{1,2}\b/g)) ids.add(m[0]);
  return [...ids].sort((a, b) => idNum(a) - idNum(b));
}

export function claimIdsOfTitle(title: string): string[] {
  const head = title.split(':')[0] as string;
  return [...head.matchAll(/\bC\d{1,2}\b/g)].map((m) => m[0]);
}

interface VitestJson {
  testResults: Array<{ assertionResults: Array<{ title: string; fullName: string; status: string }> }>;
}

/** Core tests, plus the NER package tests when `pnpm test:ner` has written its report. */
export function loadTests(): TestRecord[] | null {
  const p = join(ROOT, 'reports', 'vitest.json');
  if (!existsSync(p)) return null;
  const out: TestRecord[] = [];
  for (const f of ['vitest.json', 'vitest-ner.json']) {
    const path = join(ROOT, 'reports', f);
    if (!existsSync(path)) continue;
    const json = JSON.parse(readFileSync(path, 'utf8')) as VitestJson;
    out.push(...json.testResults.flatMap((r) => r.assertionResults.map((a) => ({ title: a.title, fullName: a.fullName, status: a.status }))));
  }
  return out;
}

export function loadMutation(): { report: MutationReport; score: number } | null {
  const p = join(ROOT, 'reports', 'mutation', 'mutation.json');
  if (!existsSync(p)) return null;
  const report = JSON.parse(readFileSync(p, 'utf8')) as MutationReport;
  return { report, score: mutationScore(report) };
}

export function mutationFloor(): number {
  const cfg = JSON.parse(read('stryker.config.json')) as { thresholds: { break: number } };
  return cfg.thresholds.break;
}

export interface ClaimsResult {
  claims: Claim[];
  problems: string[];
  testCount: number;
}

/**
 * Claims whose evidence cell in TESTING.md starts with "NER" live in the NER
 * package. Their tests skip without the model, so without `strict` they count
 * as skipped rather than failed, and CLAIMS.md says so.
 */
export function evaluateClaims(opts: { strict?: boolean } = {}): ClaimsResult {
  const tests = loadTests();
  const problems: string[] = [];
  if (!tests) return { claims: [], problems: ['reports/vitest.json is missing. Run `pnpm test` first.'], testCount: 0 };
  const nerReport = existsSync(join(ROOT, 'reports', 'vitest-ner.json'));
  const declared = declaredClaims();
  const ids = new Set<string>([...declared.map((d) => d.id), ...referencedClaimIds()]);
  const claims: Claim[] = [...ids]
    .sort((a, b) => idNum(a) - idNum(b))
    .map((id) => {
      const d = declared.find((x) => x.id === id);
      // Sorted by title: the report lists files in the order they finished, which changes from run to run.
      const mine = tests.filter((t) => claimIdsOfTitle(t.title).includes(id)).sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
      const c: Claim = {
        id,
        text: d?.text ?? '(not in the TESTING.md table)',
        evidence: d?.evidence ?? '',
        tests: mine,
        passed: mine.filter((t) => t.status === 'passed').length,
        failed: mine.filter((t) => t.status === 'failed').length,
        skipped: mine.filter((t) => t.status !== 'passed' && t.status !== 'failed').length,
        problems: [],
        notes: [],
      };
      const ner = (d?.evidence ?? '').startsWith('NER');
      if (!d) c.problems.push('not declared in the TESTING.md claims table');
      if (c.failed > 0) c.problems.push(`${c.failed} test(s) failed`);
      if (ner && !nerReport) c.notes.push('not run: `pnpm test:ner` has written no report');
      else if (mine.length === 0) c.problems.push('no test carries this claim ID');
      else if (c.passed === 0) {
        if (ner) c.notes.push('skipped: the model is not present, run `pnpm ner:download`');
        else c.problems.push('no passing test');
      }
      if (opts.strict) {
        c.problems.push(...c.notes);
        c.notes = [];
      }
      if (id === 'C11') {
        const m = loadMutation();
        if (!m) c.problems.push('reports/mutation/mutation.json is missing. Run `pnpm mutation`.');
        else if (m.score < mutationFloor()) c.problems.push(`mutation score ${m.score.toFixed(2)} is below the floor ${mutationFloor()}`);
      }
      for (const p of c.problems) problems.push(`${c.id}: ${p}`);
      return c;
    });
  return { claims, problems, testCount: tests.length };
}

export function claimStatus(c: Claim): ClaimStatus {
  if (c.problems.length) return 'fail';
  return c.notes.length ? 'skipped' : 'pass';
}
