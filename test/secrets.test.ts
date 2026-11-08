import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';

describe('secret scanning gate', () => {
  let dir: string;
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };
  const write = (path: string, text: string): void => writeFileSync(join(dir, path), text);
  const scan = (): number | null => spawnSync(process.execPath, ['scripts/secrets.mjs'], { cwd: dir, encoding: 'utf8' }).status;
  // Invented locally. Never contacts a provider or represents an account.
  const token = ['gh', 'p_', 'aB9cD2eF7gH4iJ6kL1mN8oP3qR5sT0uV2wX9'].join('');

  beforeEach(() => {
    mkdirSync(join(ROOT, '.local'), { recursive: true });
    dir = mkdtempSync(join(ROOT, '.local', 'secret-test-'));
    for (const path of ['scripts', 'ner/train']) mkdirSync(join(dir, path), { recursive: true });
    copyFileSync(join(ROOT, 'scripts/secrets.mjs'), join(dir, 'scripts/secrets.mjs'));
    copyFileSync(join(ROOT, '.gitleaks.toml'), join(dir, '.gitleaks.toml'));
    write('.gitignore', '.local/\n.env\n');
    git('init', '-b', 'test/scan');
    git('config', 'user.name', 'Example Maintainer');
    git('config', 'user.email', 'maintainer@example.example');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-m', 'Initialize scanner fixture');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('accepts the three public model checksums in their reviewed paths', () => {
    for (const path of ['ner/train/sources.py', 'ner/CANDIDATES.md']) copyFileSync(join(ROOT, path), join(dir, path));
    git('add', '.');
    git('commit', '-m', 'Add model checksum fixtures');
    expect(scan()).toBe(0);
  });

  it('does not allow the same checksum under an unrelated path', () => {
    const line = readFileSync(join(ROOT, 'ner/train/sources.py'), 'utf8').split('\n').find((s) => s.includes('tokenizer_config.json'))!;
    write('credentials.py', line);
    expect(scan()).toBe(1);
  });

  it.each([
    ['ner/train/sources.py', 'tokenizer_config.json'],
    ['ner/CANDIDATES.md', 'tokenizer.json'],
    ['ner/CANDIDATES.md', 'tokenizer_config.json'],
  ])('rejects a different token at %s under %s', (path, key) => {
    const value = 'b37d6ac9f14e8025'.repeat(4);
    write(path, `"${key}": "${value}"\n`);
    expect(scan()).toBe(1);
  });

  it('rejects untracked secrets even with an inline suppression comment', () => {
    write('credentials.txt', `token=${token} # gitleaks:allow\n`);
    expect(scan()).toBe(1);
  });

  it('rejects a secret in the index after the working copy is cleaned', () => {
    write('credentials.txt', `token=${token}\n`);
    git('add', 'credentials.txt');
    write('credentials.txt', 'removed\n');
    expect(scan()).toBe(1);
  });

  it('rejects a deleted secret still present in history', () => {
    write('credentials.txt', `token=${token}\n`);
    git('add', 'credentials.txt');
    git('commit', '-m', 'Add synthetic detection fixture');
    git('rm', 'credentials.txt');
    git('commit', '-m', 'Remove detection fixture');
    expect(scan()).toBe(1);
  });

  it('scans a force-added file even when its path is ignored', () => {
    write('.env', `token=${token}\n`);
    git('add', '--force', '.env');
    expect(scan()).toBe(1);
  });
});
