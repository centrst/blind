import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertStableVersion, checkRelease, nextVersion, setVersion, syncVersion } from '../scripts/lib/release.js';
import { ROOT } from './support/corpus.js';

const sha = 'a'.repeat(40);

describe('release channels', () => {
  it('continues the date counter without reusing older versions or matching another base', () => {
    const published = ['0.4.0-next.20260812.1', '0.4.0-next.20260812.8', '0.4.0-next.20260811.99',
      '0.5.0-next.20260812.30', '0.4.0-next.20260812.9-extra', '0.4.0-next.20260812.01', '0.4.0'];
    expect(nextVersion('0.4.0', published, new Date('2026-08-12T23:59:00Z'))).toBe('0.4.0-next.20260812.9');
    expect(nextVersion('0.4.0', published, new Date('2026-08-13T00:00:00Z'))).toBe('0.4.0-next.20260813.1');
  });

  it('rejects invalid stable bases and unsafe counters', () => {
    for (const value of ['v0.4.0', '01.4.0', '0.4', '0.4.0-next.1', '0.4.0+build', "0.4.0'\n"]) {
      expect(() => assertStableVersion(value)).toThrow();
    }
    expect(() => nextVersion('0.4.0', ['0.4.0-next.20260812.9007199254740991'], new Date('2026-08-12'))).toThrow();
  });

  it('accepts explicit channels only on the verified main commit', () => {
    for (const channel of ['next', 'stable']) {
      const input = { version: '0.4.0', channel, event: 'workflow_dispatch', ref: 'refs/heads/main', sha, verifiedSha: sha };
      expect(() => checkRelease(input)).not.toThrow();
      expect(() => checkRelease({ ...input, verifiedSha: 'b'.repeat(40) })).toThrow();
      expect(() => checkRelease({ ...input, verifiedSha: undefined })).toThrow();
      expect(() => checkRelease({ ...input, ref: 'refs/heads/topic' })).toThrow();
      expect(() => checkRelease({ ...input, channel: 'latest' })).toThrow();
    }
  });

  it('accepts stable tags that match the source and rejects prerelease tags', () => {
    const input = { version: '0.4.0', channel: 'stable', event: 'push', ref: 'refs/tags/v0.4.0', sha };
    expect(() => checkRelease(input)).not.toThrow();
    for (const change of [{ ref: 'refs/tags/v0.5.0' }, { channel: 'next' }, { version: '0.4.0-next.20260812.1' }, { event: 'pull_request' }]) {
      expect(() => checkRelease({ ...input, ...change })).toThrow();
    }
  });
});

describe('release versioning', () => {
  it('versions the workspace root with the real Changesets CLI and keeps NER private', () => {
    const root = mkdtempSync(join(tmpdir(), 'blind-version-'));
    try {
      mkdirSync(join(root, '.changeset'));
      mkdirSync(join(root, 'src'));
      mkdirSync(join(root, 'ner'));
      cpSync(join(ROOT, '.changeset', 'config.json'), join(root, '.changeset', 'config.json'));
      cpSync(join(ROOT, 'pnpm-workspace.yaml'), join(root, 'pnpm-workspace.yaml'));
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@centrst/blind', version: '0.4.0', packageManager: 'pnpm@12.6.0' }));
      writeFileSync(join(root, 'ner', 'package.json'), JSON.stringify({ name: '@centrst/blind-ner', version: '0.4.0', private: true, peerDependencies: { '@centrst/blind': 'workspace:*' } }));
      writeFileSync(join(root, '.changeset', 'invented-note.md'), '---\n"@centrst/blind": patch\n---\n\nFix an invented parsing case.\n');
      execFileSync(process.execPath, [join(ROOT, 'node_modules', '@changesets', 'cli', 'bin.js'), 'version'], { cwd: root, stdio: 'pipe' });
      syncVersion(root);
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.4.1');
      expect(readFileSync(join(root, 'src', 'version.ts'), 'utf8')).toContain("export const VERSION = '0.4.1';");
      expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf8')).toContain('Fix an invented parsing case.');
      expect(existsSync(join(root, '.changeset', 'invented-note.md'))).toBe(false);
      expect(JSON.parse(readFileSync(join(root, 'ner', 'package.json'), 'utf8'))).toMatchObject({ version: '0.4.0', private: true });

      setVersion(root, '0.4.1-next.20260812.1');
      expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.4.1-next.20260812.1');
      expect(readFileSync(join(root, 'src', 'version.ts'), 'utf8')).toContain("export const VERSION = '0.4.1-next.20260812.1';");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
