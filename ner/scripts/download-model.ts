/**
 * The one place this package touches the network, and only when you run it.
 *   tsx scripts/download-model.ts [target dir]
 * Fetches onnx-community/gliner_multi-v2.1 at a pinned revision, checks every
 * file against a SHA-256, and writes it to models/gliner_multi-v2.1. Beside
 * the weights it keeps the export's model card and the upstream
 * urchade/gliner_multi-v2.1 card (in upstream/), which is where the
 * Apache-2.0 licence is stated. Neither repository ships a LICENSE file, so
 * the script copies the Apache-2.0 text tracked in ner/licenses/ to LICENSE
 * and writes PROVENANCE.md, which lists every file, its source, revision and
 * hash, and the files recorded absent. The detector never imports this file.
 * After the download, inference is offline.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPORT = { repo: 'onnx-community/gliner_multi-v2.1', revision: '6ddaeb9413b0e71ad8457da1aab378a165b24058' };
const UPSTREAM = { repo: 'urchade/gliner_multi-v2.1', revision: '443d26d654e0324125a96bebd8e796c14ff2efe6' };

export interface Entry {
  source: { repo: string; revision: string };
  path: string;
  dest: string;
  /** null records that the file does not exist at the pinned revision. */
  sha256: string | null;
}

export const MANIFEST: Entry[] = [
  { source: EXPORT, path: 'gliner_config.json', dest: 'gliner_config.json', sha256: '1ef59c57fe6816a155697a5670ca8d0faf0babe13f199a2c2b5b65113399ed72' },
  { source: EXPORT, path: 'tokenizer.json', dest: 'tokenizer.json', sha256: '914bd3c8fb7b525af9e23b60d0ec7b1248ddb2b99014efd9c02ebeb022f8cab7' },
  { source: EXPORT, path: 'tokenizer_config.json', dest: 'tokenizer_config.json', sha256: '78f866883daf7ee2bc400200a155cdbe9116ed0a6ed597ff573ea2c9862a89a6' },
  { source: EXPORT, path: 'onnx/model.onnx', dest: 'onnx/model.onnx', sha256: '57af7f3d8d72a3ca4e5619c247344b4b5ee362a5ebcf307c0634d67b65e721c0' },
  // The export's card names its base model and carries no licence field of its own.
  { source: EXPORT, path: 'README.md', dest: 'README.md', sha256: '279eb794bcc89846eadff0512fdf306822a2258f78151b2909ba2ff96f60c1f6' },
  { source: EXPORT, path: 'LICENSE', dest: 'LICENSE', sha256: null },
  // The upstream card's front matter says `license: apache-2.0`. Upstream ships no LICENSE file.
  { source: UPSTREAM, path: 'README.md', dest: 'upstream/README.md', sha256: '820125f2ea897716cc38645d94f73f390ec9dfd392980c436be1d25c2e106b55' },
  { source: UPSTREAM, path: 'LICENSE', dest: 'upstream/LICENSE', sha256: null },
];

/** The manifest entry whose front matter is the source of the licence claim. */
export const LICENCE_CARD = 'upstream/README.md';

/** The Apache-2.0 text, fetched once from `url` and tracked in the repository. */
export const LICENCE = {
  url: 'https://www.apache.org/licenses/LICENSE-2.0.txt',
  file: join(import.meta.dirname, '..', 'licenses', 'APACHE-2.0.txt'),
  repoPath: 'ner/licenses/APACHE-2.0.txt',
  sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  dest: 'LICENSE',
};

/** The part of `fetch` the script uses, so a test can pass stub bytes. */
export type Fetcher = (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

export type Outcome = 'fetched' | 'present' | 'absent';

export interface FileRecord {
  entry: Entry;
  url: string;
  outcome: Outcome;
}

export const sha256Hex = (buf: Uint8Array): string => createHash('sha256').update(buf).digest('hex');
export const entryUrl = (e: Entry): string => `https://huggingface.co/${e.source.repo}/resolve/${e.source.revision}/${e.path}`;
const labelOf = (e: Entry): string => `${e.source.repo}@${e.source.revision.slice(0, 8)}/${e.path}`;

/** Throws unless `buf` hashes to `want`. */
export function checkHash(label: string, buf: Uint8Array, want: string): void {
  if (sha256Hex(buf) !== want) throw new Error(`${label}: checksum mismatch, refusing to keep it`);
}

/** The `license:` line of a model card's YAML front matter, or null. */
export function licenceLine(card: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(card);
  if (!fm) return null;
  const line = (fm[1] as string).split(/\r?\n/).find((l) => /^license:\s*\S/.test(l));
  return line?.trim() ?? null;
}

const writeAtomic = (dest: string, buf: Uint8Array): void => {
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(`${dest}.part`, buf);
  renameSync(`${dest}.part`, dest);
};

/** Fetches every entry into `target`, checking hashes and absences. Skips a file already there with the right hash. */
export async function fetchAll(fetcher: Fetcher, target: string, manifest: Entry[] = MANIFEST, log: (line: string) => void = () => {}): Promise<FileRecord[]> {
  const out: FileRecord[] = [];
  for (const entry of manifest) {
    const label = labelOf(entry);
    const url = entryUrl(entry);
    const dest = join(target, entry.dest);
    if (entry.sha256 === null) {
      const res = await fetcher(url, { method: 'HEAD' });
      if (res.status !== 404) throw new Error(`${label}: expected absent, got HTTP ${res.status}; update the manifest`);
      log(`absent   ${label} (not present at the pinned revision)`);
      out.push({ entry, url, outcome: 'absent' });
      continue;
    }
    if (existsSync(dest) && sha256Hex(readFileSync(dest)) === entry.sha256) {
      log(`ok       ${entry.dest}`);
      out.push({ entry, url, outcome: 'present' });
      continue;
    }
    const res = await fetcher(url);
    if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    checkHash(label, buf, entry.sha256);
    writeAtomic(dest, buf);
    log(`fetched  ${entry.dest} (${buf.length} bytes)`);
    out.push({ entry, url, outcome: 'fetched' });
  }
  return out;
}

/** Copies the tracked licence text to `target`/LICENSE after checking its hash. */
export function writeLicence(target: string): void {
  const buf = new Uint8Array(readFileSync(LICENCE.file));
  checkHash(LICENCE.repoPath, buf, LICENCE.sha256);
  writeAtomic(join(target, LICENCE.dest), buf);
}

/** PROVENANCE.md for the files in `records`. `claim` is the quoted `license:` line. */
export function provenance(records: FileRecord[], claim: string): string {
  const card = records.find((r) => r.entry.dest === LICENCE_CARD);
  const cardSource = card ? `${card.entry.source.repo} at revision ${card.entry.source.revision}, saved here as \`${LICENCE_CARD}\`` : `\`${LICENCE_CARD}\``;
  const lines = [
    '# Provenance',
    '',
    'Written by `pnpm ner:download` (`ner/scripts/download-model.ts` in @centrst/blind). Every file below was checked against the SHA-256 pinned in that script.',
    '',
    '## Licence',
    '',
    `Apache-2.0. The source of that claim is the front matter of the upstream model card, ${cardSource}, which says:`,
    '',
    '```',
    claim,
    '```',
    '',
    `\`${LICENCE.dest}\` here is the Apache-2.0 text from ${LICENCE.url}, tracked in the repository as \`${LICENCE.repoPath}\`. Neither model repository ships a LICENSE file at its pinned revision; the absent rows below record that.`,
    '',
    '## Files',
    '',
    '| File | Source | Revision | SHA-256 | Status |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const { entry, url, outcome } of records) {
    const file = outcome === 'absent' ? 'not written' : entry.dest;
    const status = outcome === 'absent' ? 'absent at the pinned revision (HTTP 404)' : 'hash checked';
    lines.push(`| ${file} | ${url} | ${entry.source.revision} | ${entry.sha256 ?? 'none'} | ${status} |`);
  }
  lines.push(`| ${LICENCE.dest} | ${LICENCE.url} | \`${LICENCE.repoPath}\` | ${LICENCE.sha256} | copied from the repository, hash checked |`);
  return `${lines.join('\n')}\n`;
}

/** The whole download: fetch, licence text, provenance. */
export async function download(fetcher: Fetcher, target: string, manifest: Entry[] = MANIFEST, log: (line: string) => void = () => {}): Promise<FileRecord[]> {
  const records = await fetchAll(fetcher, target, manifest, log);
  const claim = licenceLine(readFileSync(join(target, LICENCE_CARD), 'utf8'));
  if (claim !== 'license: apache-2.0') throw new Error(`${LICENCE_CARD}: expected \`license: apache-2.0\` in the front matter, found ${claim === null ? 'none' : `\`${claim}\``}`);
  writeLicence(target);
  log(`copied   ${LICENCE.dest} (${LICENCE.repoPath})`);
  writeFileSync(join(target, 'PROVENANCE.md'), provenance(records, claim));
  log('wrote    PROVENANCE.md');
  return records;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ?? join(import.meta.dirname, '..', 'models', 'gliner_multi-v2.1');
  await download(fetch, target, MANIFEST, (line) => console.log(line));
}
