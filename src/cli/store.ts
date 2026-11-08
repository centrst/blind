/**
 * The run store: one JSON file per run under $BLIND_HOME/runs, readable only
 * by the owner. The files hold real values, so they never leave this machine.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPLACE_MODES } from '../replace.js';
import type { Mapping, ReplaceWith } from '../types.js';
import type { IO } from './io.js';

export interface RunFile {
  version: 1;
  runId: string;
  createdAt: string;
  /** How the run replaced values. `unblind` reads the same mode from the mapping. */
  replaceWith: ReplaceWith;
  mapping: Mapping;
}

const ISO_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export function blindHome(io: IO): string {
  const env = io.env.BLIND_HOME;
  return env && env.trim() ? env : join(io.homedir, '.blind');
}

export function runsDir(io: IO): string {
  return join(blindHome(io), 'runs');
}

export function validRunId(id: string): boolean {
  return RUN_ID.test(id) && !id.includes('..');
}

export function newRunId(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${stamp}-${randomBytes(4).toString('hex')}`;
}

/**
 * Makes `dir` an owner-only directory. A new one is created 0700. An existing one must be a
 * directory owned by the current user; if its group or others have any access it is tightened
 * to 0700 and the path is reported on stderr. Without a user id (Windows) the mode and owner
 * cannot be checked, so only the directory itself is ensured.
 */
function ensurePrivateDir(io: IO, dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    return;
  }
  const st = statSync(dir);
  if (!st.isDirectory()) throw new Error(`${dir} is not a directory; refusing to store runs there`);
  if (io.uid === undefined) return;
  if (st.uid !== io.uid) throw new Error(`${dir} is owned by another user; refusing to store runs there`);
  if ((st.mode & 0o077) !== 0) {
    chmodSync(dir, 0o700);
    io.stderr(`blind: ${dir} was readable by others, set it to 0700\n`);
  }
}

export function saveRun(io: IO, mapping: Mapping, now: Date = new Date()): string {
  ensurePrivateDir(io, blindHome(io));
  ensurePrivateDir(io, runsDir(io));
  const runId = newRunId(now);
  const file: RunFile = { version: 1, runId, createdAt: now.toISOString(), replaceWith: mapping.replaceWith ?? 'fake', mapping };
  const path = join(runsDir(io), `${runId}.json`);
  writeFileSync(path, `${JSON.stringify(file)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return runId;
}

export function loadRun(io: IO, runId: string): RunFile | null {
  if (!validRunId(runId)) return null;
  const path = join(runsDir(io), `${runId}.json`);
  if (!existsSync(path)) return null;
  let parsed: RunFile;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as RunFile;
  } catch {
    // A parser message would quote the file, and the file holds real values.
    throw new Error(`run ${runId} is damaged and cannot be read`);
  }
  if (!parsed || !parsed.mapping || parsed.version !== 1) return null;
  // A run saved before modes existed holds a fake mapping. A mapping without a mode takes the run's.
  parsed.replaceWith ??= parsed.mapping.replaceWith ?? 'fake';
  parsed.mapping.replaceWith ??= parsed.replaceWith;
  return parsed;
}

export type RunSummary = { runId: string; createdAt: string; replaceWith: ReplaceWith } | { runId: string; damaged: true };

/** Every saved run, oldest first, with its creation time and mode. Never the mapping. */
export function listRuns(io: IO): RunSummary[] {
  const dir = runsDir(io);
  if (!existsSync(dir)) return [];
  const ids = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter(validRunId)
    .sort();
  return ids.map((runId) => {
    try {
      const run = loadRun(io, runId);
      // Only a timestamp and a known mode are printed, so a hand-edited file cannot put other text on stdout.
      if (run && typeof run.createdAt === 'string' && ISO_TIME.test(run.createdAt) && REPLACE_MODES.includes(run.replaceWith)) {
        return { runId, createdAt: run.createdAt, replaceWith: run.replaceWith };
      }
    } catch {
      // A damaged run is listed as damaged; its content stays unread.
    }
    return { runId, damaged: true };
  });
}

export function forgetRun(io: IO, runId: string): boolean {
  if (!validRunId(runId)) return false;
  const path = join(runsDir(io), `${runId}.json`);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

