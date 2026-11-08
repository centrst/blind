/**
 * Packs the package the way `npm publish` would, installs the tarball into a
 * fresh project with no registry access, and uses it from there: the library
 * by name and both bins. Relies on the `dist/` that the global setup builds.
 * A second check packs a copy of the project that has no `dist/`, with
 * lifecycle scripts on, so `prepack` has to build it.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string; scripts: Record<string, string> };
const INPUT = 'Hola Marta Quintero, el pago de 1.240,50 € a Talleres Brisa del Norte S.L. vence el 14 de mayo de 2026. Escribe a marta@brisanorte.example.\n';
const KNOWN = [
  { kind: 'person', value: 'Marta Quintero' },
  { kind: 'org', value: 'Talleres Brisa del Norte S.L.' },
];
const REAL = ['Marta', 'Quintero', 'Brisa', 'marta@brisanorte.example', '1.240,50'];
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let tmp = '';
let app = '';

/** Environment without the npm_config_* variables pnpm passes down, and with a private npm cache. */
function npmEnv(root = tmp): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.toLowerCase().startsWith('npm_config_')) env[k] = v;
  env.npm_config_cache = join(root, 'npm-cache');
  env.npm_config_update_notifier = 'false';
  return env;
}

function run(cmd: string, args: string[], input?: string): string {
  return execFileSync(cmd, args, {
    cwd: app,
    env: { ...npmEnv(), BLIND_HOME: join(tmp, 'blind-home') },
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
}

describe('C37/K1: the packed tarball installs and runs', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'blind-pack-'));
    app = join(tmp, 'app');
    mkdirSync(app);
    const packed = execFileSync(NPM, ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], {
      cwd: ROOT,
      env: npmEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: process.platform === 'win32',
    });
    const tarball = join(tmp, (JSON.parse(packed) as Array<{ filename: string }>)[0]!.filename);
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'pack-check', version: '1.0.0', private: true, type: 'module' }));
    run(NPM, ['install', tarball, '--offline', '--no-audit', '--no-fund', '--no-package-lock']);
  }, 120_000);

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('C37/K1: npm pack rebuilds dist first, and the build marks the bins executable without a shell chmod', () => {
    expect(pkg.scripts.prepack).toBe('pnpm build');
    expect(pkg.scripts.build).not.toMatch(/(^|&&\s*)chmod\s/);
    expect(pkg.scripts.build).toContain('node scripts/chmod-bins.mjs');
    const bins = ['blind.js', 'unblind.js'].map((b) => join(ROOT, 'dist', 'cli', b));
    const posix = process.platform !== 'win32';
    if (posix) for (const b of bins) chmodSync(b, 0o644);
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'chmod-bins.mjs')], { cwd: ROOT, stdio: 'ignore' });
    if (posix) for (const b of bins) expect(statSync(b).mode & 0o111, b).toBe(0o111);
  });

  it('C37/K1: the installed package is the version in package.json and holds only what was packed', () => {
    const installed = JSON.parse(readFileSync(join(app, 'node_modules', pkg.name, 'package.json'), 'utf8')) as { version: string };
    expect(installed.version).toBe(pkg.version);
    expect(statSync(join(app, 'node_modules', pkg.name, 'dist', 'index.js')).isFile()).toBe(true);
    expect(() => statSync(join(app, 'node_modules', pkg.name, 'src'))).toThrow();
  });

  it('C37/K1: blind, unblind and assertNoLeaks import by package name and round trip', () => {
    writeFileSync(
      join(app, 'check.mjs'),
      `import { blind, unblind, assertNoLeaks } from '${pkg.name}';
const input = ${JSON.stringify(INPUT)};
const r = blind([input], { seed: 'pack', known: ${JSON.stringify(KNOWN)} });
assertNoLeaks(r);
const back = unblind(r.texts[0], r.mapping).text;
process.stdout.write(JSON.stringify({ changed: r.texts[0] !== input, leaked: ${JSON.stringify(REAL)}.filter((v) => r.texts[0].includes(v)), same: back === input, ok: r.leaks.ok }));
`,
    );
    expect(JSON.parse(run(process.execPath, ['check.mjs']))).toEqual({ changed: true, leaked: [], same: true, ok: true });
  });

  it('C37/K1: the installed blind and unblind bins run, the same seed gives the same output, and the answer maps back', () => {
    const bin = (name: string): string => join(app, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
    writeFileSync(join(app, 'known.json'), JSON.stringify(KNOWN));
    const args = ['--seed', 'pack', '--known', 'known.json', '--json'];
    const first = JSON.parse(run(bin('blind'), args, INPUT)) as { runId: string; texts: string[] };
    const second = JSON.parse(run(bin('blind'), args, INPUT)) as { runId: string; texts: string[] };
    expect(first.texts).toHaveLength(1);
    const blinded = first.texts[0]!;
    expect(blinded).not.toBe(INPUT);
    for (const real of REAL) expect(blinded).not.toContain(real);
    expect(second.texts).toEqual(first.texts);
    expect(run(bin('unblind'), ['--run', first.runId], blinded)).toBe(INPUT);
  });
});

describe('C37/K1: npm pack builds dist/ through prepack', () => {
  let copyTmp = '';

  afterAll(() => {
    if (copyTmp) rmSync(copyTmp, { recursive: true, force: true });
  });

  // A copy, so the build never rewrites the dist/ that other test files read.
  // It holds what `pnpm build` and `files` need, and links the installed node_modules.
  it('C37/K1: npm pack with lifecycle scripts on, in a copy with no dist/, ships the built entry and both bins', () => {
    copyTmp = mkdtempSync(join(tmpdir(), 'blind-prepack-'));
    const project = join(copyTmp, 'project');
    mkdirSync(project);
    for (const entry of ['package.json', 'tsconfig.json', 'tsconfig.build.json', 'src', join('scripts', 'chmod-bins.mjs'), 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md']) {
      cpSync(join(ROOT, entry), join(project, entry), { recursive: true });
    }
    symlinkSync(join(ROOT, 'node_modules'), join(project, 'node_modules'), 'junction');
    rmSync(join(project, 'dist'), { recursive: true, force: true });
    expect(existsSync(join(project, 'dist'))).toBe(false);

    const packed = execFileSync(NPM, ['pack', '--json', '--pack-destination', copyTmp], {
      cwd: project,
      env: npmEnv(copyTmp),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    const json = packed.slice(packed.indexOf('['));
    const files = new Map((JSON.parse(json) as Array<{ files: Array<{ path: string; mode: number }> }>)[0]!.files.map((f) => [f.path, f.mode]));
    for (const f of ['dist/index.js', 'dist/index.d.ts', 'dist/cli/blind.js', 'dist/cli/unblind.js']) expect(files.has(f), f).toBe(true);
    if (process.platform !== 'win32') {
      for (const b of ['dist/cli/blind.js', 'dist/cli/unblind.js']) expect(files.get(b)! & 0o111, b).toBe(0o111);
    }
    expect(existsSync(join(project, 'dist', 'index.js'))).toBe(true);
  }, 300_000);
});
