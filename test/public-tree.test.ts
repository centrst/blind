import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './support/corpus.js';

// Generic disclosure checks. Private project and person names belong in a
// separate local audit, never in the public scanner or its fixtures.

interface Rule {
  name: string;
  test: (line: string, file: string) => boolean;
}

const RULES: Rule[] = [
  { name: 'absolute home path', test: (line) => /(?:\/Users\/|\/home\/)[A-Za-z0-9_.-]+\//.test(line) },
  { name: 'literal account_id', test: (line) => /\baccount_id\s*=\s*"/.test(line) },
  {
    name: 'personal owner',
    test: (line, file) => {
      if (!/\.ya?ml$/.test(file)) return false;
      const m = /^\s*owner:\s*(.*?)\s*$/.exec(line);
      return m !== null && m[1]!.replace(/^["']|["']$/g, '').toLowerCase() !== 'centrst';
    },
  },
];

function findings(file: string, text: string): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) if (rule.test(line, file)) out.push(`${file}:${i + 1} ${rule.name}`);
  });
  return out;
}

// A link into this repository's tree names a branch and a path. Branch names
// can hold slashes, so the link passes when some split of it leaves a path
// that exists at HEAD.
const TREE_LINK = /github\.com\/centrst\/blind\/(?:blob|tree)\/([^\s)"'<>#?]+)/g;

function inTree(path: string): boolean {
  try {
    execFileSync('git', ['cat-file', '-e', `HEAD:${path}`], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function brokenTreeLinks(file: string, text: string, exists: (path: string) => boolean): string[] {
  const out: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(TREE_LINK)) {
      const parts = m[1]!.replace(/\/$/, '').split('/');
      const found = parts.slice(1).some((_, k) => exists(parts.slice(k + 1).join('/')));
      if (!found) out.push(`${file}:${i + 1} links ${m[1]} but no such path is in the tree`);
    }
  });
  return out;
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f !== '');
}

describe('public tree', () => {
  it('the scanner flags each kind of private reference', () => {
    expect(findings('a.md', '/Us' + 'ers/example-person/project')).toHaveLength(1);
    expect(findings('a.md', '/ho' + 'me/example-person/project')).toHaveLength(1);
    expect(findings('a.md', 'served at centrst.com/blind/')).toHaveLength(0);
    expect(findings('w.toml', 'account' + '_id = "0123abcd"')).toHaveLength(1);
    expect(findings('.pre-merge.yml', '  owner: Someone')).toHaveLength(1);
    expect(findings('.pre-merge.yml', '  owner: Centrst')).toHaveLength(0);
    expect(findings('t.ts', 'function f(owner: Party) {}')).toHaveLength(0);
    expect(findings('w.toml', '# Wrangler reads CLOUDFLARE_ACCOUNT_ID')).toHaveLength(0);
  });

  it('no tracked file contains a literal home path or account configuration', () => {
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const file of files) {
      const path = join(ROOT, file);
      if (!existsSync(path)) continue;
      const buf = readFileSync(path);
      if (buf.includes(0)) continue; // binary
      hits.push(...findings(file, buf.toString('utf8')));
    }
    expect(hits).toEqual([]);
  });

  it('a link to a file in this repository points at a path in the tree', () => {
    const base = 'https://github.com/centrst/' + 'blind/blob/';
    const has = (path: string) => path === 'docs/a.md';
    expect(brokenTreeLinks('a.md', `[x](${base}main/docs/a.md)`, has)).toEqual([]);
    expect(brokenTreeLinks('a.md', `[x](${base}release/x/docs/a.md#top)`, has)).toEqual([]);
    expect(brokenTreeLinks('a.md', `[x](${base}main/docs/b.md)`, has)).toHaveLength(1);
    expect(brokenTreeLinks('a.md', `see ${base}main`, has)).toHaveLength(1);

    const hits: string[] = [];
    let documents = 0;
    for (const file of trackedFiles()) {
      if (!/\.(md|html)$/.test(file) || !existsSync(join(ROOT, file))) continue;
      const text = readFileSync(join(ROOT, file), 'utf8');
      documents++;
      hits.push(...brokenTreeLinks(file, text, inTree));
    }
    // Relative links are valid too; a public tree need not contain absolute links.
    expect(documents).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});
