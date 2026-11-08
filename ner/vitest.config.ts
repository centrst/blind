import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // The package imports the public entry of the core. Tests read the source of it, so no build is needed.
    alias: { '@centrst/blind': join(here, '..', 'src', 'index.ts') },
  },
  test: {
    root: here,
    include: ['test/**/*.test.ts'],
    testTimeout: 900_000,
    hookTimeout: 900_000,
    reporters: process.env.VITEST_NO_JSON ? ['default'] : ['default', 'json'],
    outputFile: { json: join(here, '..', 'reports', 'vitest-ner.json') },
  },
});
