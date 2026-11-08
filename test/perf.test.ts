import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { blind, createUnblinder, unblind } from '../src/index.js';
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
