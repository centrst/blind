/**
 * D1: runs the built library under Deno. Spawns `deno run` on a small script
 * that imports `dist/index.js`, blinds and unblinds one synthetic text, and
 * prints the result. Relies on the `dist/` that the global setup builds.
 * Skips when `deno` is not on PATH. Bun has no such test.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';

const INPUT = 'Hola Marta Quintero, el pago de 1.240,50 € a Talleres Brisa del Norte S.L. vence el 14 de mayo de 2026. Escribe a marta@brisanorte.example.';
const REAL = ['Marta', 'Quintero', 'Brisa', 'marta@brisanorte.example', '1.240,50'];
const ENTRY = join(ROOT, 'dist', 'index.js');

const DENO = spawnSync('deno', ['--version'], { stdio: 'ignore' }).status === 0;
if (!DENO) console.warn('D1: deno is not on PATH, so the Deno smoke test is skipped');

describe('D1: Deno smoke test', () => {
  it.skipIf(!DENO)('D1: the built library blinds and unblinds a text under Deno', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'blind-deno-'));
    try {
      const script = join(tmp, 'smoke.mjs');
      writeFileSync(
        script,
        `import { blind, unblind } from ${JSON.stringify(pathToFileURL(ENTRY).href)};
const input = ${JSON.stringify(INPUT)};
const r = blind([input], {
  seed: 7,
  known: [{ kind: 'person', value: 'Marta Quintero' }, { kind: 'org', value: 'Talleres Brisa del Norte S.L.' }],
});
const back = unblind(r.texts[0], r.mapping).text;
console.log(JSON.stringify({ runtime: typeof Deno, blind: r.texts[0], back, ok: r.leaks.ok }));
`,
      );
      const out = execFileSync('deno', ['run', '--no-config', '--no-lock', '--no-prompt', `--allow-read=${join(ROOT, 'dist')}`, script], {
        cwd: tmp,
        env: { ...process.env, DENO_DIR: join(tmp, 'deno-dir'), NO_COLOR: '1' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const res = JSON.parse(out) as { runtime: string; blind: string; back: string; ok: boolean };
      expect(res.runtime).toBe('object');
      expect(res.ok).toBe(true);
      for (const v of REAL) expect(res.blind.includes(v), 'a real value survived under Deno').toBe(false);
      expect(res.back).toBe(INPUT);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
