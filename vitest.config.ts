import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Examples import the package by name, as a builder would.
  resolve: { alias: { '@centrst/blind': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**'],
    globalSetup: ['test/support/global-setup.ts'],
    // Every CPU. The default keeps one for the main process, which on the 2-CPU GitHub runner leaves one worker and the files running one after another.
    maxWorkers: availableParallelism(),
    testTimeout: 120_000,
    reporters: process.env.VITEST_NO_JSON ? ['default'] : ['default', 'json'],
    outputFile: { json: 'reports/vitest.json' },
  },
});
