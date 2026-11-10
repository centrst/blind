import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { blind, createUnblinder, unblind } from '../src/index.js';
import { everyKnownDetector } from '../src/detect.js';
import type { KnownValue } from '../src/types.js';
import { loadCorpus, ROOT } from './support/corpus.js';

it('C41: a known organization with a long whitespace run finishes within the process deadline', () => {
  // A subprocess bounds the regression even when a synchronous regex stalls.
  const script = `
    import { blind } from './dist/index.js';
    const value = 'Example' + ' '.repeat(200_000) + 'X';
    const result = blind(['Unrelated text.'], { known: [{ kind: 'org', value }], seed: 'suffix-perf' });
    process.stdout.write(JSON.stringify(result.texts));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', timeout: 5000,
  });
  expect(result.error?.message).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('["Unrelated text."]');
});

it('C41: a megabyte of three-digit groups split by spaces, with no currency, finishes within the process deadline', () => {
  // An open count of spaced groups would be read again from every group: time that grows with the square of the run.
  const script = `
    import { blind } from './dist/index.js';
    const text = '1' + ' 234'.repeat(260_000) + ' end, then 1 240,80 €';
    const result = blind([text], { seed: 'spaced-perf' });
    process.stdout.write(JSON.stringify([result.replaced, result.texts[0].startsWith('1 234 234')]));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', timeout: 10_000,
  });
  expect(result.error?.message).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('[{"amount":1},true]');
});

it('C55: a text that repeats a key 1,000 known entries share runs in a 64 MB heap', () => {
  // Every occurrence of every entry's key was kept, one copy per entry: about 22 million offsets here.
  const script = `
    import { blind } from './dist/index.js';
    const known = Array.from({ length: 1000 }, (_, i) => ({ kind: 'person', value: 'Al' + i + ' Johnsonia' }));
    const result = blind(['johnsonia'.repeat(22_000)], { known, seed: 'shared-key' });
    process.stdout.write(String(result.texts[0].length));
  `;
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', script], {
    cwd: ROOT, encoding: 'utf8', timeout: 20_000,
  });
  expect(result.error?.message).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('198000');
});

/**
 * Time grows about linearly with the text. CPU time, not wall time, so other
 * work on the machine counts less, and a bound of 1.5 times linear so a loaded
 * machine does not fail it. `BLIND_SKIP_PERF=1` skips it.
 */
describe.skipIf(process.env.BLIND_SKIP_PERF)('time against text length', () => {
  const parts = loadCorpus().map((f) => f.parsed.text);
  /** Corpus texts one after another, blank line between, cut to `length`. */
  const text = (length: number): string => {
    let s = '';
    for (let i = 0; s.length < length; i++) s += `${parts[i % parts.length]}\n\n`;
    return s.slice(0, length);
  };
  /** CPU seconds of one call of `fn`. */
  const once = (fn: () => unknown): number => {
    const before = process.cpuUsage();
    fn();
    const d = process.cpuUsage(before);
    return (d.user + d.system) / 1e6;
  };
  /** CPU seconds of one `blind` call, after one warm-up call on the same text. */
  const cpu = (t: string): number => {
    blind([t], { seed: 'perf' });
    return once(() => blind([t], { seed: 'perf' }));
  };
  /** The least CPU seconds of three calls of `fn`, after one warm-up call. */
  const best = (fn: () => unknown): number => {
    fn();
    return Math.min(once(fn), once(fn), once(fn));
  };

  it('C41: an 800 KB text takes at most 1.5 times four times the CPU time of a 200 KB text', () => {
    const small = cpu(text(200 * 1024));
    const large = cpu(text(800 * 1024));
    expect(large, `200 KB ${small.toFixed(2)} s, 800 KB ${large.toFixed(2)} s`).toBeLessThanOrEqual(1.5 * 4 * small);
  });

  it('C41: with paranoid: true, an 800 KB text takes at most 1.5 times four times the CPU time of a 200 KB text', () => {
    const run = (t: string): number => {
      blind([t], { seed: 'perf', paranoid: true });
      return once(() => blind([t], { seed: 'perf', paranoid: true }));
    };
    const small = run(text(200 * 1024));
    const large = run(text(800 * 1024));
    expect(large, `200 KB ${small.toFixed(2)} s, 800 KB ${large.toFixed(2)} s`).toBeLessThanOrEqual(1.5 * 4 * small);
  });

  it('C49: unblind of an 800 KB answer takes at most 1.5 times four times a 200 KB one with the same 4,000-pair mapping and no more than the blind that made it, and streaming it in 200-character chunks at most 1.5 times one-shot', () => {
    const source = text(800 * 1024);
    let made: ReturnType<typeof blind> | undefined;
    const blinding = once(() => (made = blind([source], { seed: 'perf' })));
    const { texts, mapping } = made as ReturnType<typeof blind>;
    expect(mapping.pairs.length).toBeGreaterThanOrEqual(4000);
    const large = texts[0] as string;
    const small = large.slice(0, 200 * 1024);
    const oneSmall = best(() => unblind(small, mapping));
    const oneLarge = best(() => unblind(large, mapping));
    expect(oneLarge, `200 KB ${oneSmall.toFixed(3)} s, 800 KB ${oneLarge.toFixed(3)} s`).toBeLessThanOrEqual(1.5 * 4 * oneSmall);
    // The cost once grew with the answer times the pairs: 800 KB took several times the blind of it.
    expect(oneLarge, `blind ${blinding.toFixed(3)} s, unblind ${oneLarge.toFixed(3)} s`).toBeLessThanOrEqual(blinding);
    const stream = (): string => {
      const u = createUnblinder(mapping);
      let out = '';
      for (let i = 0; i < large.length; i += 200) out += u.push(large.slice(i, i + 200));
      return out + u.end().text;
    };
    expect(stream()).toBe(unblind(large, mapping).text);
    const streamed = best(stream);
    expect(streamed, `one-shot ${oneLarge.toFixed(3)} s, streamed ${streamed.toFixed(3)} s`).toBeLessThanOrEqual(1.5 * oneLarge);
  });
});

/**
 * A known list the text does not contain. Each entry used to cost its own
 * compiled pattern and a scan of the text on every call. The reference here is
 * that work alone: the matcher that tries every entry, on the same text, after
 * `blind`, so neither run finds patterns the engine compiled before.
 */
describe.skipIf(process.env.BLIND_SKIP_PERF)('time against the size of known', () => {
  const once = (fn: () => unknown): number => {
    const before = process.cpuUsage();
    fn();
    const d = process.cpuUsage(before);
    return (d.user + d.system) / 1e6;
  };
  const text = 'The meeting moved to nine, see you there.';
  /** `n` invented people and companies the text does not write, under a prefix of their own so no other test compiled them. */
  const absent = (prefix: string, n: number): KnownValue[] =>
    Array.from({ length: n }, (_, i) => (i % 4 === 3 ? { kind: 'org', value: `${prefix}${i} Vandermeer Logistics` } : { kind: 'person', value: `${prefix}${i} Vandermeer${i}` }));

  it('C55: with 8,000 known entries the text does not contain, blind on a short text takes at most a quarter of the CPU time of compiling and running one pattern per entry', () => {
    const known = absent('Ostrava', 8000);
    blind([text], { known: absent('Warmup', 200), seed: 'perf' });
    let out: ReturnType<typeof blind> | undefined;
    const fast = once(() => (out = blind([text], { known, seed: 'perf' })));
    expect(out?.texts[0]).toBe(text);
    const every = once(() => everyKnownDetector(known).detect(text, { dateOrder: 'dmy', isAllowedHost: () => false }));
    expect(fast, `blind ${fast.toFixed(3)} s, one pattern per entry ${every.toFixed(3)} s`).toBeLessThanOrEqual(every / 4);
  });
});
