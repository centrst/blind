import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';

// Optional module URL lets the same fixture measure a saved baseline build.
const api = await import(process.argv[2] ?? '../../dist/index.js');
const options = { seed: 'issue-6', replaceWith: 'placeholder', now: new Date('2026-01-01') };
const measure = (run) => {
  run();
  const samples = Array.from({ length: 3 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return Math.round(samples[1]);
};

console.log(JSON.stringify({ node: process.version, cpu: cpus()[0].model, samples: 3, statistic: 'median wall ms after warmup' }));
for (const count of [625, 1250, 2500, 5000]) {
  const texts = Array.from({ length: count }, (_, i) => i % 2 === 0
    ? `Invoice ${7301 + i} from Lenora Veldren`
    : `Tavia Norwick <tavia${i}@host${i % 7}.example>`);
  const joined = [texts.join('\n')];
  const made = api.blind(texts, options);
  assert.equal(made.leaks.ok, true);
  const separateMs = measure(() => api.blind(texts, options));
  const joinedMs = measure(() => api.blind(joined, options));
  // Measure restoration separately. Each field keeps its own boundaries.
  const restore = (run) => made.texts.forEach((text, i) => assert.equal(run(text).text, texts[i]));
  const unblindMs = measure(() => restore((text) => api.unblind(text, made.mapping)));
  const preparedMs = api.prepareUnblinder ? measure(() => {
    const prepared = api.prepareUnblinder(made.mapping);
    restore((text) => prepared.unblind(text));
  }) : null;
  console.log(JSON.stringify({ count, pairs: made.mapping.pairs.length, separateMs, joinedMs, unblindMs, preparedMs }));
}
