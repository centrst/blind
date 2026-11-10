/**
 * Packs this package the way the release workflow does, with `pnpm pack`, and
 * checks what ships. Then puts the tarball in a fresh project beside the core,
 * with no registry access, and uses it from there by package name. Relies on
 * the two dist folders the global setup builds.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LICENCE, sha256Hex } from '../src/download.js';
import { NER_ROOT } from './support.js';

const ROOT = join(NER_ROOT, '..');
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const read = (path: string): string => readFileSync(path, 'utf8');

interface Manifest {
  name: string;
  version: string;
  private?: boolean;
  bin?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const source = JSON.parse(read(join(NER_ROOT, 'package.json'))) as Manifest;
const core = JSON.parse(read(join(ROOT, 'package.json'))) as Manifest;

let tmp = '';
let app = '';
let installed = '';
let files: string[] = [];
let packed: Manifest;

describe('C53: the packed NER tarball', () => {
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'blind-ner-pack-'));
    const out = execFileSync(PNPM, ['pack', '--json', '--pack-destination', tmp], {
      cwd: NER_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    const result = JSON.parse(out.slice(out.indexOf('{'))) as { filename: string; files: Array<{ path: string }> };
    files = result.files.map((f) => f.path).sort();
    const tarball = join(tmp, basename(result.filename));

    // A project with the tarball unpacked where npm would put it, the core
    // beside it, and the two runtime libraries from this workspace's store.
    app = join(tmp, 'app');
    installed = join(app, 'node_modules', '@centrst', 'blind-ner');
    mkdirSync(installed, { recursive: true });
    mkdirSync(join(app, 'node_modules', '@huggingface'));
    execFileSync('tar', ['-xzf', tarball, '-C', installed, '--strip-components', '1']);
    symlinkSync(ROOT, join(app, 'node_modules', '@centrst', 'blind'), 'junction');
    for (const dep of Object.keys(source.dependencies ?? {})) {
      symlinkSync(realpathSync(join(NER_ROOT, 'node_modules', dep)), join(app, 'node_modules', dep), 'junction');
    }
    writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'ner-pack-check', version: '1.0.0', private: true, type: 'module' }));
    packed = JSON.parse(read(join(installed, 'package.json'))) as Manifest;
  }, 120_000);

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it('C53: the tarball holds the build, the licence texts, the notices and the README, and nothing else', () => {
    for (const f of files) {
      expect(['LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json', 'licenses/APACHE-2.0.txt'].includes(f) || f.startsWith('dist/'), f).toBe(true);
    }
    for (const must of ['LICENSE', 'README.md', 'THIRD-PARTY-NOTICES.md', 'package.json', 'licenses/APACHE-2.0.txt', 'dist/index.js', 'dist/index.d.ts', 'dist/cli/download.js']) {
      expect(files, must).toContain(must);
    }
    // pnpm copies the workspace licence in. The Apache text is the one the download command checks and copies.
    expect(read(join(installed, 'LICENSE'))).toBe(read(join(ROOT, 'LICENSE')));
    expect(sha256Hex(new Uint8Array(readFileSync(join(installed, 'licenses', 'APACHE-2.0.txt'))))).toBe(LICENCE.sha256);
    const notices = read(join(installed, 'THIRD-PARTY-NOTICES.md'));
    for (const [name, version] of Object.entries(packed.dependencies ?? {})) expect(notices, name).toContain(`## ${name}\n\n- Version: ${version}`);
  });

  it('C53: the packed manifest is public, names the core it was built with as a caret peer range, and pins its two libraries', () => {
    expect(packed.name).toBe('@centrst/blind-ner');
    expect(packed.version).toBe(source.version);
    expect(packed.private).toBeUndefined();
    // pnpm links the workspace core and writes a caret range on its version in place of `workspace:^`.
    expect(source.peerDependencies).toEqual({ '@centrst/blind': 'workspace:^' });
    expect(packed.peerDependencies).toEqual({ '@centrst/blind': `^${core.version}` });
    expect(Object.keys(packed.dependencies ?? {}).sort()).toEqual(['@huggingface/tokenizers', 'onnxruntime-node']);
    for (const version of Object.values(packed.dependencies ?? {})) expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(packed.devDependencies).toBeUndefined();
    expect(packed.optionalDependencies).toBeUndefined();
    expect(JSON.stringify(packed)).not.toContain('workspace:');
    for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) expect(packed.scripts?.[hook], hook).toBeUndefined();
    // pnpm pack would run a pack lifecycle script, and the release workflow packs with scripts on.
    expect(Object.keys(source.scripts ?? {})).toEqual(['build']);
  });

  it('C53: beside the core, with no registry, it imports by package name, blinds names a stub backend finds and round trips', () => {
    writeFileSync(
      join(app, 'check.mjs'),
      `import { blindWithNer, createNerDetector } from '@centrst/blind-ner';
import { unblind } from '@centrst/blind';
const input = 'Yesterday Odalys Brennick wrote to Varnholt Ledgerworks about the Quillmere depot.';
const names = { 'Odalys Brennick': 'person', 'Varnholt Ledgerworks': 'organization', Quillmere: 'location' };
const backend = { async predict(text) {
  const out = [];
  for (const [value, label] of Object.entries(names)) {
    const start = text.indexOf(value);
    if (start >= 0) out.push({ start, end: start + value.length, label, score: 0.99 });
  }
  return out.sort((a, b) => a.start - b.start);
} };
const r = await blindWithNer(backend, [input], { seed: 'pack' });
process.stdout.write(JSON.stringify({
  detector: typeof createNerDetector,
  left: Object.keys(names).filter((v) => r.texts[0].includes(v)),
  same: unblind(r.texts[0], r.mapping).text === input,
  ok: r.leaks.ok,
}));
`,
    );
    const out = execFileSync(process.execPath, ['check.mjs'], { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(JSON.parse(out)).toEqual({ detector: 'function', left: [], same: true, ok: true });
  });

  it('C53: the download command ships executable, prints its usage without a directory, and the entry never loads it', () => {
    expect(packed.bin).toEqual({ 'blind-ner-download': 'dist/cli/download.js' });
    const bin = join(installed, 'dist', 'cli', 'download.js');
    expect(read(bin).startsWith('#!/usr/bin/env node\n')).toBe(true);
    if (process.platform !== 'win32') expect(statSync(bin).mode & 0o111).toBe(0o111);
    for (const args of [[], ['--help'], ['a', 'b']]) {
      const r = spawnSync(process.execPath, [bin, ...args], { cwd: app, encoding: 'utf8' });
      expect(r.status, args.join(' ')).toBe(2);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('Usage: blind-ner-download <directory>');
    }
    // Only the command and its module fetch. Nothing the entry imports reaches them.
    for (const f of files.filter((path) => path.endsWith('.js') && !['dist/cli/download.js', 'dist/download.js'].includes(path))) {
      const code = read(join(installed, f));
      expect(code, f).not.toMatch(/['"][^'"\n]*download(\.js)?['"]/);
      expect(code, f).not.toMatch(/\bfetch\s*\(/);
    }
  });
});
