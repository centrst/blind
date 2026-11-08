import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';
import { forbiddenIn, importedSpecifiers } from './support/forbidden.js';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, unknown>;
const DIST = join(ROOT, 'dist');

/** Built-ins the shipped code may use. The library entry may only use node:crypto. */
const ALLOWED_BUILTINS = new Set(['node:crypto', 'node:fs', 'node:path', 'node:os', 'node:process', 'node:url']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function closure(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const spec of importedSpecifiers(readFileSync(entry, 'utf8'))) {
    if (spec.startsWith('.')) closure(join(entry, '..', spec), seen);
  }
  return seen;
}

describe('B1: build checks', () => {
  it('C8/B1: package.json declares no runtime dependencies', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
    expect(pkg.optionalDependencies ?? {}).toEqual({});
    expect(pkg.bundleDependencies ?? []).toEqual([]);
    expect(Object.keys((pkg.devDependencies as object) ?? {}).length).toBeGreaterThan(0);
  });

  it('C8/B1: npm pack ships only dist, README.md, LICENSE, THIRD-PARTY-NOTICES.md and package.json', () => {
    expect(existsSync(DIST), 'dist/ must be built first').toBe(true);
    const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const files = (JSON.parse(out)[0].files as Array<{ path: string }>).map((f) => f.path);
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      expect(f === 'README.md' || f === 'LICENSE' || f === 'THIRD-PARTY-NOTICES.md' || f === 'package.json' || f.startsWith('dist/'), f).toBe(true);
    }
    for (const must of ['README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md', 'package.json', 'dist/index.js', 'dist/index.d.ts', 'dist/cli/blind.js', 'dist/cli/unblind.js']) {
      expect(files, must).toContain(must);
    }
  });

  it('C8/B1: dist imports only itself and allowed Node built-ins', () => {
    const js = walk(DIST).filter((f) => f.endsWith('.js'));
    expect(js.length).toBeGreaterThan(5);
    for (const f of js) {
      const src = readFileSync(f, 'utf8');
      expect(forbiddenIn(src), f).toEqual([]);
      for (const spec of importedSpecifiers(src)) {
        const ok = spec.startsWith('./') || spec.startsWith('../') || ALLOWED_BUILTINS.has(spec);
        expect(ok, `${f} imports ${spec}`).toBe(true);
      }
    }
  });

  it('C19/B2: the library entry imports no Node built-in and uses no Node-only global', () => {
    const files = closure(join(DIST, 'index.js'));
    expect(files.size).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const spec of importedSpecifiers(src)) {
        expect(spec.startsWith('.'), `${f} imports ${spec}`).toBe(true);
      }
      const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const name of ['process', 'Buffer', 'require', '__dirname', '__filename', 'global', 'setImmediate']) {
        expect(new RegExp(String.raw`(?<![\w.$])${name}(?![\w$])`).test(code), `${f} uses ${name}`).toBe(false);
      }
    }
  });

  it('C19/B2: the library entry runs in a bare JavaScript realm with only Web Crypto and the web encoding globals', async () => {
    const { runInBareRealm } = await import('./support/bare-realm.js');
    const out = await runInBareRealm(join(DIST, 'index.js'), `
      const r = lib.blind(['Ana Ruiz <ana@gestoria.example> pagó 247,80 € el 3 de marzo de 2026.']);
      const back = lib.unblind(r.texts[0], r.mapping).text;
      const keys = await lib.generateReceiptKeys();
      const receipt = await lib.signReceipt({ result: r, returned: back, runtime: 'test', ...keys });
      const valid = await lib.verifyReceipt(receipt, keys.publicKey, { sent: r.texts, returned: back });
      return { changed: r.texts[0] !== back, back, ok: r.leaks.ok, valid };
    `);
    expect(out).toEqual({ changed: true, back: 'Ana Ruiz <ana@gestoria.example> pagó 247,80 € el 3 de marzo de 2026.', ok: true, valid: true });
  });

  it('C19/B2: the version constant matches package.json', async () => {
    const { VERSION } = await import('../src/version.js');
    expect(VERSION).toBe(pkg.version);
  });

  it('C8/B1: src holds TypeScript sources only, so tests and Stryker never load stale build output', () => {
    const stray = walk(join(ROOT, 'src')).filter((f) => !f.endsWith('.ts') || f.endsWith('.d.ts'));
    expect(stray).toEqual([]);
  });

  it('C8/B1: both bin entries exist, start with a shebang and point into dist', () => {
    const bin = pkg.bin as Record<string, string>;
    expect(Object.keys(bin).sort()).toEqual(['blind', 'unblind']);
    for (const target of Object.values(bin)) {
      expect(target.startsWith('dist/')).toBe(true);
      expect(readFileSync(join(ROOT, target), 'utf8').startsWith('#!/usr/bin/env node\n'), target).toBe(true);
    }
  });
});
