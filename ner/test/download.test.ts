import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHash, download, entryUrl, LICENCE, licenceLine, MANIFEST, sha256Hex, type Entry, type Fetcher } from '../scripts/download-model.js';

const enc = new TextEncoder();
const CARD = '---\nlanguage: multilingual\nlicense: apache-2.0\n---\n\n# Stub card\n';

/** Stub bytes for each entry: the card gets front matter, the rest a marker. */
const stubBytes = (e: Entry): Uint8Array => enc.encode(e.dest === 'upstream/README.md' ? CARD : `stub ${e.dest}\n`);

/** The real manifest with each hash swapped for the hash of its stub bytes. Absences stay absent. */
const stubManifest = (): Entry[] => MANIFEST.map((e) => ({ ...e, sha256: e.sha256 === null ? null : sha256Hex(stubBytes(e)) }));

/** Serves stub bytes by URL and 404 for absent entries. `tamper` replaces one file's bytes. */
function stubFetch(manifest: Entry[], tamper?: string): Fetcher & { calls: string[] } {
  const byUrl = new Map(manifest.map((e) => [entryUrl(e), e]));
  const calls: string[] = [];
  const f = async (url: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const e = byUrl.get(url);
    if (!e || e.sha256 === null) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    const bytes = e.dest === tamper ? enc.encode('tampered\n') : stubBytes(e);
    return { ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer };
  };
  return Object.assign(f, { calls });
}

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'blind-ner-download-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('model download manifest, offline', () => {
  it('C47: the tracked Apache-2.0 text matches its pinned SHA-256', () => {
    expect(sha256Hex(new Uint8Array(readFileSync(LICENCE.file)))).toBe(LICENCE.sha256);
    expect(readFileSync(LICENCE.file, 'utf8')).toContain('Apache License\n                           Version 2.0, January 2004');
  });

  it('C47: the hash check rejects a wrong hash and the bad file is not kept', async () => {
    expect(() => checkHash('x', enc.encode('a'), sha256Hex(enc.encode('b')))).toThrow(/checksum mismatch/);
    expect(() => checkHash('x', enc.encode('a'), sha256Hex(enc.encode('a')))).not.toThrow();
    const target = tmp();
    const manifest = stubManifest();
    await expect(download(stubFetch(manifest, 'tokenizer.json'), target, manifest)).rejects.toThrow(/tokenizer\.json: checksum mismatch/);
    expect(existsSync(join(target, 'tokenizer.json'))).toBe(false);
    expect(existsSync(join(target, 'tokenizer.json.part'))).toBe(false);
    expect(existsSync(join(target, 'PROVENANCE.md'))).toBe(false);
  });

  it('C47: an absent entry that the server does have stops the download', async () => {
    const manifest = stubManifest();
    const f: Fetcher = async (url, init) => (init?.method === 'HEAD' ? { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } : stubFetch(manifest)(url, init));
    await expect(download(f, tmp(), manifest)).rejects.toThrow(/expected absent, got HTTP 200/);
  });

  it('C47: the licence text lands beside the weights and PROVENANCE.md lists every entry, the absent ones included', async () => {
    const target = tmp();
    const manifest = stubManifest();
    const fetcher = stubFetch(manifest);
    const records = await download(fetcher, target, manifest);
    expect(records.map((r) => r.outcome)).toEqual(MANIFEST.map((e) => (e.sha256 === null ? 'absent' : 'fetched')));
    // Absences are checked with HEAD, files fetched with GET, nothing else.
    expect(fetcher.calls.sort()).toEqual(MANIFEST.map((e) => `${e.sha256 === null ? 'HEAD' : 'GET'} ${entryUrl(e)}`).sort());

    for (const e of manifest) if (e.sha256 !== null) expect(readFileSync(join(target, e.dest))).toEqual(Buffer.from(stubBytes(e)));
    expect(readFileSync(join(target, 'LICENSE'))).toEqual(readFileSync(LICENCE.file));
    expect(existsSync(join(target, 'upstream', 'LICENSE'))).toBe(false);

    const prov = readFileSync(join(target, 'PROVENANCE.md'), 'utf8');
    const rows = prov.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| File') && !l.startsWith('| ---'));
    expect(rows).toHaveLength(MANIFEST.length + 1);
    for (const e of manifest) {
      const row = rows.find((r) => r.includes(entryUrl(e)));
      expect(row, e.dest).toBeDefined();
      expect(row).toContain(e.source.revision);
      if (e.sha256 === null) expect(row).toMatch(/\| none \| absent at the pinned revision/);
      else expect(row).toContain(e.sha256);
    }
    expect(rows.find((r) => r.includes(LICENCE.url))).toContain(LICENCE.sha256);
    expect(prov).toContain('```\nlicense: apache-2.0\n```');
    expect(prov).toContain('urchade/gliner_multi-v2.1 at revision 443d26d654e0324125a96bebd8e796c14ff2efe6');

    // A second run keeps the checked files and fetches only the absences again.
    const again = stubFetch(manifest);
    expect((await download(again, target, manifest)).map((r) => r.outcome)).toEqual(MANIFEST.map((e) => (e.sha256 === null ? 'absent' : 'present')));
    expect(again.calls.every((c) => c.startsWith('HEAD '))).toBe(true);
  });

  it('C47: a card whose front matter does not say apache-2.0 stops the download before the licence is written', async () => {
    expect(licenceLine(CARD)).toBe('license: apache-2.0');
    expect(licenceLine('# no front matter\nlicense: mit\n')).toBeNull();
    const target = tmp();
    const other = (e: Entry): Uint8Array => enc.encode(e.dest === 'upstream/README.md' ? '---\nlicense: cc-by-nc-4.0\n---\n' : `stub ${e.dest}\n`);
    const manifest = MANIFEST.map((e) => ({ ...e, sha256: e.sha256 === null ? null : sha256Hex(other(e)) }));
    const byUrl = new Map(manifest.map((e) => [entryUrl(e), e]));
    const f: Fetcher = async (url) => {
      const e = byUrl.get(url);
      if (!e || e.sha256 === null) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
      return { ok: true, status: 200, arrayBuffer: async () => other(e).slice().buffer };
    };
    await expect(download(f, target, manifest)).rejects.toThrow(/expected `license: apache-2.0`.*found `license: cc-by-nc-4.0`/);
    expect(existsSync(join(target, 'LICENSE'))).toBe(false);
    expect(existsSync(join(target, 'PROVENANCE.md'))).toBe(false);
  });

  it('C47: every manifest entry names a pinned 40-character revision and a SHA-256 or an absence', () => {
    for (const e of MANIFEST) {
      expect(e.source.revision).toMatch(/^[0-9a-f]{40}$/);
      if (e.sha256 !== null) expect(e.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(MANIFEST.filter((e) => e.sha256 === null).map((e) => e.dest)).toEqual(['LICENSE', 'upstream/LICENSE']);
  });
});
