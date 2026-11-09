/**
 * pnpm verify: the release gate for the published core package, in CI order.
 * Stops at the first failure. It checks only what ships: no NER model, no NER
 * package and no mutation run, so it takes minutes, not hours.
 *
 * `--full` also runs the NER package (typecheck, build and tests, which need the
 * model) and mutation testing, and makes the claims step check their claims.
 * Run it when the NER package or the test suite itself is the change.
 * `--fast` skips the 20,000-case property run (test:deep).
 */
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../test/support/corpus.js';

const full = process.argv.includes('--full');
const fast = process.argv.includes('--fast');

const modelDir = process.env.BLIND_NER_MODEL ?? join(ROOT, 'ner', 'models', 'gliner_multi-v2.1');
if (full && !existsSync(join(modelDir, 'onnx', 'model.onnx'))) {
  console.error(`verify --full needs the NER model for claims C15 to C18 and found none at ${modelDir}.\nRun \`pnpm ner:download\` once, or set BLIND_NER_MODEL.`);
  process.exit(1);
}

const bin = (name: string): string => join(ROOT, 'node_modules', '.bin', name);
const seed = process.env.SEED ?? String(randomInt(2 ** 31));
const coreLint = ['src', 'test', 'scripts', 'examples'];
const nerLint = ['ner/src', 'ner/test', 'ner/scripts'];

interface Step {
  name: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  /** Why the step does not run in this mode, if it does not. */
  skip?: string | false;
}

const fullOnly = full ? false : 'needs --full';
const steps: Step[] = [
  { name: 'secrets', cmd: process.execPath, args: ['scripts/secrets.mjs'] },
  { name: 'audit:python', cmd: 'python3', args: ['scripts/audit-python.py'] },
  { name: 'typecheck', cmd: bin('tsc'), args: ['--noEmit'] },
  { name: 'typecheck:ner', cmd: bin('tsc'), args: ['--noEmit', '-p', 'ner/tsconfig.json'], skip: fullOnly },
  { name: 'lint', cmd: bin('eslint'), args: full ? [...coreLint, ...nerLint] : coreLint },
  { name: 'build', cmd: bin('tsc'), args: ['-p', 'tsconfig.build.json'] },
  { name: 'build:bins', cmd: process.execPath, args: ['scripts/chmod-bins.mjs'] },
  { name: 'build:ner', cmd: bin('tsc'), args: ['-p', 'ner/tsconfig.build.json'], skip: fullOnly },
  { name: 'test', cmd: bin('vitest'), args: ['run'] },
  { name: 'test:ner', cmd: bin('vitest'), args: ['run', '-c', 'ner/vitest.config.ts'], env: { SKIP_BUILD: '1' }, skip: fullOnly },
  {
    name: 'test:deep',
    cmd: bin('vitest'),
    args: ['run', 'test/properties', 'test/no-network.test.ts'],
    env: { NUM_RUNS: '20000', VITEST_NO_JSON: '1', SKIP_BUILD: '1' },
    skip: fast ? '--fast' : false,
  },
  { name: 'corpus', cmd: bin('tsx'), args: ['scripts/corpus.ts'] },
  { name: 'mutation', cmd: bin('stryker'), args: ['run'], skip: fullOnly },
  { name: 'claims', cmd: bin('tsx'), args: ['scripts/claims.ts', '--strict', ...(full ? ['--full'] : [])] },
  {
    name: 'evidence',
    cmd: bin('tsx'),
    args: ['scripts/evidence.ts', ...(full ? ['--full'] : [])],
    env: { EVIDENCE_COMMAND: `pnpm verify${full ? ' --full' : ''}${fast ? ' --fast' : ''} (SEED=${seed})` },
  },
];

const timings: Array<[string, number]> = [];
const started = Date.now();
for (const s of steps) {
  if (s.skip) {
    console.log(`\n== ${s.name}: skipped (${s.skip})`);
    continue;
  }
  console.log(`\n== ${s.name}`);
  const t0 = Date.now();
  const r = spawnSync(s.cmd, s.args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SEED: seed, ...s.env } });
  const secs = (Date.now() - t0) / 1000;
  timings.push([s.name, secs]);
  if (r.status !== 0) {
    console.error(`\nverify failed at ${s.name} after ${secs.toFixed(0)}s`);
    process.exit(r.status ?? 1);
  }
}
console.log(`\nverify${full ? ' --full' : ''} passed`);
for (const [name, secs] of timings) console.log(`  ${name.padEnd(10)} ${secs.toFixed(0)}s`);
console.log(`  total      ${((Date.now() - started) / 1000).toFixed(0)}s`);
