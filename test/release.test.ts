import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertStableVersion, checkRelease, nextVersion, pendingChangesets, releaseTag, setVersion, syncVersion,
  type ReleaseCheck,
} from '../scripts/lib/release.js';
import { ROOT } from './support/corpus.js';

const sha = 'a'.repeat(40);
const temps: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'blind-release-'));
  temps.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('prerelease versions', () => {
  const published = ['0.4.0-next.20260812.1', '0.4.0-next.20260812.8', '0.4.0-next.20260811.99',
    '0.5.0-next.20260812.30', '0.4.0-next.20260812.9-extra', '0.4.0-next.20260812.01', '0.3.0'];

  it('continues the date counter without reusing older versions or matching another base', () => {
    expect(nextVersion('0.4.0', published, new Date('2026-08-12T23:59:00Z'))).toBe('0.4.0-next.20260812.9');
    expect(nextVersion('0.4.0', published, new Date('2026-08-13T00:00:00Z'))).toBe('0.4.0-next.20260813.1');
  });

  it('dates the counter in UTC whatever the local time zone', () => {
    const before = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      expect(nextVersion('0.4.0', [], new Date('2026-08-12T23:59:00Z'))).toBe('0.4.0-next.20260812.1');
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('counts a published version with build metadata as taken', () => {
    expect(nextVersion('0.4.0', ['0.4.0-next.20260812.9+ci.1'], new Date('2026-08-12'))).toBe('0.4.0-next.20260812.10');
  });

  it('refuses a base that is already published, since its preview would sort below it', () => {
    expect(() => nextVersion('0.4.0', [...published, '0.4.0'], new Date('2026-08-12'))).toThrow(/already published/);
  });

  it('rejects invalid stable bases and stops at the largest safe counter', () => {
    for (const value of ['v0.4.0', '01.4.0', '0.4', '0.4.0-next.1', '0.4.0+build', "0.4.0'\n", '']) {
      expect(() => assertStableVersion(value)).toThrow();
    }
    expect(nextVersion('0.4.0', ['0.4.0-next.20260812.9007199254740990'], new Date('2026-08-12'))).toBe('0.4.0-next.20260812.9007199254740991');
    expect(() => nextVersion('0.4.0', ['0.4.0-next.20260812.9007199254740991'], new Date('2026-08-12'))).toThrow();
  });
});

describe('release checks', () => {
  const base: ReleaseCheck = {
    version: '0.4.0', channel: 'next', event: 'workflow_dispatch', ref: 'refs/heads/main',
    sha, verifiedSha: sha, mainSha: sha, runAttempt: '1', published: ['0.3.0'], pendingNotes: false,
  };

  it('accepts a fresh dispatch of the verified main head on either channel', () => {
    expect(checkRelease(base)).toBe('next');
    expect(checkRelease({ ...base, channel: 'stable' })).toBe('stable');
  });

  it('maps the stable channel to latest and the preview channel to next', () => {
    expect(releaseTag('stable')).toBe('latest');
    expect(releaseTag('next')).toBe('next');
  });

  it('refuses every run that is not a fresh dispatch of the verified main head', () => {
    const refused: Array<Partial<ReleaseCheck>> = [
      { verifiedSha: 'b'.repeat(40) },
      { verifiedSha: undefined },
      { verifiedSha: sha.slice(0, 7) },
      { sha: '', verifiedSha: '', mainSha: '' },
      { sha: sha.toUpperCase(), verifiedSha: sha.toUpperCase(), mainSha: sha.toUpperCase() },
      { ref: 'refs/heads/topic' },
      { ref: 'refs/tags/v0.4.0' },
      { event: 'push', ref: 'refs/tags/v0.4.0' },
      { event: 'push' },
      { channel: 'latest' },
      { mainSha: 'b'.repeat(40) },
      { runAttempt: '2' },
      { runAttempt: '' },
      { version: '0.4.0-next.20260812.1' },
    ];
    for (const change of refused) expect(() => checkRelease({ ...base, ...change }), JSON.stringify(change)).toThrow();
  });

  it('refuses a version that is already published on either channel', () => {
    for (const channel of ['next', 'stable']) {
      expect(() => checkRelease({ ...base, channel, published: ['0.3.0', '0.4.0'] })).toThrow(/already published/);
    }
  });

  it('holds a stable release while changesets are pending, but lets a preview through', () => {
    expect(() => checkRelease({ ...base, channel: 'stable', pendingNotes: true })).toThrow(/Merge the release PR/);
    expect(checkRelease({ ...base, pendingNotes: true })).toBe('next');
  });

  it('counts only unconsumed notes as pending changesets', () => {
    const dir = temp();
    writeFileSync(join(dir, 'README.md'), 'Changesets readme\n');
    writeFileSync(join(dir, 'config.json'), '{}\n');
    expect(pendingChangesets(dir)).toBe(false);
    writeFileSync(join(dir, 'invented-note.md'), '---\n"@centrst/blind": patch\n---\n\nFix an invented case.\n');
    expect(pendingChangesets(dir)).toBe(true);
    expect(() => pendingChangesets(join(dir, 'missing'))).toThrow();
  });
});

describe('release versioning', () => {
  it('writes nothing when given a version it does not support', () => {
    const root = temp();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), '{\n  "name": "@centrst/blind",\n  "version": "0.4.0"\n}\n');
    writeFileSync(join(root, 'src', 'version.ts'), "export const VERSION = '0.4.0';\n");
    for (const value of ["0.4.0';x", '0.4.0+build', '0.4.0-rc.1']) expect(() => setVersion(root, value)).toThrow(/Unsupported/);
    expect(readFileSync(join(root, 'package.json'), 'utf8')).toContain('"version": "0.4.0"');
    expect(readFileSync(join(root, 'src', 'version.ts'), 'utf8')).toBe("export const VERSION = '0.4.0';\n");
    writeFileSync(join(root, 'package.json'), '{"version": "0.4.0-rc.1"}\n');
    expect(() => syncVersion(root)).toThrow(/Unsupported/);
  });

  it('versions the workspace root with the real Changesets CLI, above the newest entry, and keeps NER private', () => {
    const root = temp();
    mkdirSync(join(root, '.changeset'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'ner'));
    for (const file of ['.changeset/config.json', '.changeset/README.md', 'pnpm-workspace.yaml', 'ner/package.json']) {
      cpSync(join(ROOT, file), join(root, file));
    }
    const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { packageManager: string; scripts: Record<string, string> };
    const nerVersion = (JSON.parse(readFileSync(join(ROOT, 'ner', 'package.json'), 'utf8')) as { version: string }).version;
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@centrst/blind', version: '0.4.0', packageManager: rootPkg.packageManager }));
    writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n\nInvented intro.\n\n## 0.4.0\n\n- An invented earlier entry.\n');
    writeFileSync(join(root, '.changeset', 'invented-note.md'), '---\n"@centrst/blind": patch\n---\n\nFix an invented parsing case.\n');
    execFileSync(process.execPath, [join(ROOT, 'node_modules', '@changesets', 'cli', 'bin.js'), 'version'], { cwd: root, stdio: 'pipe', timeout: 60_000 });
    syncVersion(root);

    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.4.1');
    expect(readFileSync(join(root, 'src', 'version.ts'), 'utf8')).toContain("export const VERSION = '0.4.1';");
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('Fix an invented parsing case.');
    expect(changelog.indexOf('## 0.4.1')).toBeGreaterThan(-1);
    expect(changelog.indexOf('## 0.4.1')).toBeLessThan(changelog.indexOf('## 0.4.0'));
    expect(existsSync(join(root, '.changeset', 'invented-note.md'))).toBe(false);
    expect(existsSync(join(root, '.changeset', 'README.md'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'ner', 'package.json'), 'utf8')).version).toBe(nerVersion);
    expect(rootPkg.scripts['version:release']).toContain('pnpm version:sync');

    setVersion(root, '0.4.1-next.20260812.1');
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.4.1-next.20260812.1');
    expect(readFileSync(join(root, 'src', 'version.ts'), 'utf8')).toContain("export const VERSION = '0.4.1-next.20260812.1';");
  });
});
