/**
 * pnpm verify: everything, in the order CI runs it. Stops at the first failure.
 * `--fast` skips the 20,000-case property run (test:deep). The claims step is
 * strict, so the NER model must be present: claims C15 to C18 are published
 * and their tests only run with the weights.
 */
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../test/support/corpus.js';

const modelDir = process.env.BLIND_NER_MODEL ?? join(ROOT, 'ner', 'models', 'gliner_multi-v2.1');
if (!existsSync(join(modelDir, 'onnx', 'model.onnx'))) {
  console.error(`verify needs the NER model for claims C15 to C18 and found none at ${modelDir}.\nRun \`pnpm ner:download\` once, or set BLIND_NER_MODEL.`);
  process.exit(1);
}

const bin = (name: string): string => join(ROOT, 'node_modules', '.bin', name);
const fast = process.argv.includes('--fast');
const seed = process.env.SEED ?? String(randomInt(2 ** 31));

interface Step {
  name: string;
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  skip?: boolean;
}

const steps: Step[] = [
  { name: 'secrets', cmd: process.execPath, args: ['scripts/secrets.mjs'] },
  { name: 'audit:python', cmd: 'python3', args: ['scripts/audit-python.py'] },
  { name: 'typecheck', cmd: bin('tsc'), args: ['--noEmit'] },
  { name: 'typecheck:ner', cmd: bin('tsc'), args: ['--noEmit', '-p', 'ner/tsconfig.json'] },
  { name: 'lint', cmd: bin('eslint'), args: ['src', 'test', 'scripts', 'examples', 'ner/src', 'ner/test', 'ner/scripts'] },
  { name: 'build', cmd: bin('tsc'), args: ['-p', 'tsconfig.build.json'] },
  { name: 'build:bins', cmd: process.execPath, args: ['scripts/chmod-bins.mjs'] },
  { name: 'build:ner', cmd: bin('tsc'), args: ['-p', 'ner/tsconfig.build.json'] },
  { name: 'test', cmd: bin('vitest'), args: ['run'] },
  { name: 'test:ner', cmd: bin('vitest'), args: ['run', '-c', 'ner/vitest.config.ts'], env: { SKIP_BUILD: '1' } },
  {
    name: 'test:deep',
    cmd: bin('vitest'),
    args: ['run', 'test/properties', 'test/no-network.test.ts'],
    env: { NUM_RUNS: '20000', VITEST_NO_JSON: '1', SKIP_BUILD: '1' },
    skip: fast,
  },
  { name: 'corpus', cmd: bin('tsx'), args: ['scripts/corpus.ts'] },
  { name: 'mutation', cmd: bin('stryker'), args: ['run'] },
  { name: 'claims', cmd: bin('tsx'), args: ['scripts/claims.ts', '--strict'] },
  { name: 'evidence', cmd: bin('tsx'), args: ['scripts/evidence.ts'], env: { EVIDENCE_COMMAND: `pnpm verify${fast ? ' --fast' : ''} (SEED=${seed})` } },
];

const timings: Array<[string, number]> = [];
const started = Date.now();
for (const s of steps) {
  if (s.skip) {
    console.log(`\n== ${s.name}: skipped (--fast)`);
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
console.log('\nverify passed');
for (const [name, secs] of timings) console.log(`  ${name.padEnd(10)} ${secs.toFixed(0)}s`);
console.log(`  total      ${((Date.now() - started) / 1000).toFixed(0)}s`);
