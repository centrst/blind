import { defineConfig } from 'vitest/config';

/**
 * What Stryker runs against each mutant: the suites that exercise src in
 * process. No network patches, no build checks, no spawned CLI. Properties run
 * at a lower count with a fixed seed so every mutant faces the same inputs.
 */
export default defineConfig({
  test: {
    include: ['test/blind.test.ts', 'test/technical.test.ts', 'test/detect.test.ts', 'test/corpus.test.ts', 'test/adversarial.test.ts', 'test/properties/*.test.ts', 'test/replace.test.ts', 'test/cli.test.ts', 'test/safety.test.ts', 'test/receipt.test.ts', 'test/roundtrip.test.ts', 'test/pairlog.test.ts', 'test/surrogates.test.ts', 'test/language.test.ts'],
    testTimeout: 120_000,
    env: { MUTATION: '1', NUM_RUNS: '60', SEED: '20261008' },
  },
});
