import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';
import { mutationScore, type MutationReport } from './support/mutation.js';

/** MUTATION_REPORT_REQUIRED=true, =1 or any other value counts as set; empty, 0 and false do not. */
function isSet(value: string | undefined): boolean {
  return value !== undefined && !['', '0', 'false'].includes(value.toLowerCase());
}

describe('C11: mutation testing', () => {
  const config = JSON.parse(readFileSync(join(ROOT, 'stryker.config.json'), 'utf8')) as { thresholds: { break: number } };

  it('C11: the Stryker config carries a break floor above zero', () => {
    expect(config.thresholds.break).toBeGreaterThan(0);
  });

  it('C11: the last Stryker report is at or above the floor', (ctx) => {
    const path = join(ROOT, 'reports', 'mutation', 'mutation.json');
    if (!existsSync(path)) {
      // pnpm mutation writes it. A missing report shows as skipped, never as passed, and fails
      // when the job that runs Stryker sets MUTATION_REPORT_REQUIRED.
      if (isSet(process.env.MUTATION_REPORT_REQUIRED)) throw new Error('C11: reports/mutation/mutation.json is missing and MUTATION_REPORT_REQUIRED is set. Run pnpm mutation before this test.');
      ctx.skip('no mutation report; run pnpm mutation');
    }
    const score = mutationScore(JSON.parse(readFileSync(path, 'utf8')) as MutationReport);
    expect(score).toBeGreaterThanOrEqual(config.thresholds.break);
  });

  it('C11: the score counts timeouts as kills and ignores compile errors', () => {
    const report: MutationReport = { files: { a: { mutants: [{ status: 'Killed' }, { status: 'Timeout' }, { status: 'Survived' }, { status: 'NoCoverage' }, { status: 'CompileError' }, { status: 'Ignored' }] } } };
    expect(mutationScore(report)).toBe(50);
  });
});
