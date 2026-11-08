import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blind, unblind } from '../src/index.js';
import { FIXED_NOW, loadCorpus, ROOT } from './support/corpus.js';
import { forbiddenIn } from './support/forbidden.js';
import { hits, installPatches, removePatches, type Fn } from './support/network-guard.js';
import {
  p1RoundTrip, p2NoSurvivors, p3KnownAndDeny, p4Relations, p5Dates, p6Determinism, p7Shape, p8LeakCheckClean,
  p9TypedIds, p10Conversation, p11Streaming, p12Placeholders, p13OtherModesRoundTrip, p14OtherModesConversation, p15OtherModesLeakCheck,
  p16AmountsApart, p17Spellings,
} from './support/properties.js';

const require = createRequire(import.meta.url);

describe('N1: no network, no sockets, no child processes', () => {
  let savedRuns: string | undefined;

  beforeAll(() => {
    savedRuns = process.env.NUM_RUNS;
    // Properties run again under the patches, at a tenth of the usual count.
    process.env.NUM_RUNS = String(Math.max(100, Math.floor(Number(savedRuns ?? 2000) / 10)));
    installPatches();
  });

  afterAll(() => {
    removePatches();
    if (savedRuns === undefined) delete process.env.NUM_RUNS;
    else process.env.NUM_RUNS = savedRuns;
  });

  it('C7/N1: the patches are live', async () => {
    await expect(Promise.resolve().then(() => (globalThis as { fetch: Fn }).fetch('http://corpus.example'))).rejects.toThrow(/N1: blocked fetch/);
    expect(() => (require('node:child_process') as { spawn: Fn }).spawn('true')).toThrow(/N1: blocked/);
    expect(() => (require('node:net') as { connect: Fn }).connect(80, 'x.example')).toThrow(/N1: blocked/);
    expect(() => (require('node:dns') as { lookup: Fn }).lookup('x.example', () => undefined)).toThrow(/N1: blocked/);
    expect(() => (require('node:dgram') as { createSocket: Fn }).createSocket('udp4')).toThrow(/N1: blocked/);
    expect(() => (require('node:worker_threads') as { Worker: Fn }).Worker('x')).toThrow(/N1: blocked/);
    hits.length = 0;
  });

  it('C7/N1: the whole corpus blinds and unblinds without touching the network', () => {
    const files = loadCorpus();
    for (const f of files) {
      const res = blind([f.parsed.text], { known: f.parsed.known, seed: f.name, now: FIXED_NOW, dateOrder: f.parsed.dateOrder });
      unblind(res.texts[0] as string, res.mapping);
    }
    expect(files.length).toBeGreaterThan(300);
    expect(hits).toEqual([]);
  });

  it('C7/N1: every property runs without touching the network', () => {
    p1RoundTrip();
    p2NoSurvivors();
    p3KnownAndDeny();
    p4Relations();
    p5Dates();
    p6Determinism();
    p7Shape();
    p8LeakCheckClean();
    p9TypedIds();
    p10Conversation();
    p11Streaming();
    p12Placeholders();
    p13OtherModesRoundTrip();
    p14OtherModesConversation();
    p15OtherModesLeakCheck();
    p16AmountsApart();
    p17Spellings();
    expect(hits).toEqual([]);
  }, 1_800_000);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('N1: static check', () => {
  it('C7/N1: nothing under src/ imports a network, socket or process module', () => {
    const files = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(forbiddenIn(readFileSync(f, 'utf8')), f).toEqual([]);
  });

  it('C7/N1: the static check catches what it is meant to catch', () => {
    expect(forbiddenIn("import http from 'node:http';")).toHaveLength(1);
    expect(forbiddenIn("import { spawn } from 'child_process';")).toHaveLength(1);
    expect(forbiddenIn("const w = await import('node:worker_threads');")).toHaveLength(1);
    expect(forbiddenIn("const n = require('node:net');")).toHaveLength(1);
    expect(forbiddenIn("await fetch('https://x.example')")).toHaveLength(1);
    expect(forbiddenIn("import { randomUUID } from 'node:crypto'; const refetch = 1;")).toEqual([]);
  });
});
