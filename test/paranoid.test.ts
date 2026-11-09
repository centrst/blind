import { mkdtempSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IO } from '../src/cli/io.js';
import { blindMain } from '../src/cli/run-blind.js';
import { assertNoLeaks, blind, BlindError, LeakError } from '../src/index.js';
import type { Suspect } from '../src/types.js';
import { loadAdversarial } from './support/adversarial.js';
import { FIXED_NOW, loadCorpus, survives } from './support/corpus.js';

// Every name, number and domain is invented.
const NOTE = [
  'Hola Lucía,',
  'Patient Ana Ruiz was seen on Tuesday and sent home.',
  'Reference 123 45 6789 is on the form. Follow @AnaRuiz_Design for updates.',
  'Write to ana at gestoria dot example before Friday.',
  'Payload: UGFyYSBBbmEgUnVpeg==',
].join('\n');

const slices = (text: string, suspects: Suspect[]): string[] => suspects.map((s) => `${s.kind}:${text.slice(s.start, s.end)}`);

describe('paranoid mode', () => {
  it('C50: flags each kind of value left as written, by kind and input offsets, and makes the report fail', () => {
    const res = blind([NOTE], { seed: 'p', now: FIXED_NOW, paranoid: true });
    const got = slices(NOTE, res.leaks.suspects ?? []);
    expect(got).toEqual([
      'name:Lucía',
      'name:Patient Ana Ruiz',
      'number:123 45 6789',
      'handle:@AnaRuiz_Design',
      'address:at gestoria dot example',
      'encoded:UGFyYSBBbmEgUnVpeg==',
    ]);
    expect(res.leaks.ok).toBe(false);
    for (const s of res.leaks.suspects ?? []) expect(Object.keys(s).sort()).toEqual(['end', 'kind', 'start', 'textIndex']);
  });

  it('C50: assertNoLeaks throws a LeakError that names kinds and text indices, never a value', () => {
    const res = blind(['Nothing here.', NOTE], { seed: 'p', now: FIXED_NOW, paranoid: true });
    expect(() => assertNoLeaks(res)).toThrow(LeakError);
    let message = '';
    try {
      assertNoLeaks(res);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/^blind: 6 suspect\(s\) in paranoid mode in text 1 \(kinds: name, number, handle, address, encoded\)$/);
    for (const real of ['Lucía', 'Ruiz', '6789', 'gestoria', 'UGFy']) expect(message).not.toContain(real);
  });

  it('C50: changes nothing in the blind copy or the mapping, and is off by default', () => {
    for (const replaceWith of ['fake', 'placeholder', 'random'] as const) {
      const plain = blind([NOTE], { seed: 'p', now: FIXED_NOW, replaceWith });
      const paranoid = blind([NOTE], { seed: 'p', now: FIXED_NOW, replaceWith, paranoid: true });
      expect(paranoid.texts, replaceWith).toEqual(plain.texts);
      expect(paranoid.mapping, replaceWith).toEqual(plain.mapping);
      expect(plain.leaks.suspects, replaceWith).toBeUndefined();
      expect(paranoid.leaks.suspects?.length, replaceWith).toBeGreaterThan(0);
    }
  });

  it('C50: never flags what blind replaces, and reads past a replaced name beside an unfound one', () => {
    const text = 'From: Cedric Maddox <cedric@maddox-studio.example>\n\nGracias a Cedric Maddox y Paloma Maddox por todo.';
    const res = blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true });
    expect(slices(text, res.leaks.suspects ?? [])).toEqual(['name:Paloma']);
  });

  it('C50: leaves sentence starts, common words, subject lines and public platforms alone', () => {
    const text = 'From: Booksy <citas@salon-lirio.example>\nSubject: Re: Presupuesto\n\nDear customer,\nThanks for booking on Monday 4 March. Best regards';
    const res = blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true });
    expect(res.leaks.suspects).toEqual([]);
    expect(res.leaks.ok).toBe(true);
  });

  it('C51: allow clears a suspect whole, in any case and without accents, and known turns one into a replacement', () => {
    const text = 'Gracias, Lucía. Patient Ana Ruiz was seen.';
    const first = blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true });
    expect(slices(text, first.leaks.suspects ?? [])).toEqual(['name:Lucía', 'name:Patient Ana Ruiz']);
    const cleared = blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true, allow: ['LUCIA'], known: [{ kind: 'person', value: 'Ana Ruiz' }] });
    expect(cleared.leaks).toEqual({ ok: true, hits: [], unenforced: [], suspects: [] });
    expect(cleared.texts[0]).not.toContain('Ruiz');
    // A part of a run is not the run: allowing "Patient" alone does not clear "Patient Ana Ruiz".
    const part = blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true, allow: ['Lucía', 'Patient'] });
    expect(slices(text, part.leaks.suspects ?? [])).toEqual(['name:Patient Ana Ruiz']);
  });

  it('C51: a cleared suspect is not read again by a later pattern', () => {
    const res = blind(['Follow @Lucía for updates.'], { seed: 'p', now: FIXED_NOW, paranoid: true, allow: ['@Lucía'] });
    expect(res.leaks.suspects).toEqual([]);
  });

  it('C51: an allow list that is not an array of strings throws invalid-option with the index only', () => {
    expect(() => blind(['x'], { paranoid: true, allow: 'Lucía' as unknown as string[] })).toThrow(/^blind: allow must be an array of strings$/);
    let err: unknown;
    try {
      blind(['x'], { paranoid: true, allow: ['ok', 7 as unknown as string] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BlindError);
    expect((err as BlindError).kind).toBe('invalid-option');
    expect((err as Error).message).toBe('blind: allow entry 1 is not a string');
  });

  it('C50: spaces before a name do not make it a sentence start', () => {
    for (const gap of [' ', '    ', '\t\t\t\t']) {
      const text = `Please send${gap}Lucía the file.`;
      const res = blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true });
      expect(slices(text, res.leaks.suspects ?? []), JSON.stringify(gap)).toEqual(['name:Lucía']);
    }
  });

  it('C41/C50: the sweep stays linear on inputs built to make its patterns backtrack, and reports any number of suspects', () => {
    const inputs = [
      `x ${'1'.repeat(100_000)}²`,
      `x ${'1 '.repeat(50_000)}²`,
      `${'Ab '.repeat(50_000)}_`,
      `a at b${' dot c'.repeat(20_000)} dot`,
      `x${' '.repeat(200_000)}Lucía`,
      `${'Aa1+'.repeat(50_000)}==a`,
    ];
    for (const text of inputs) {
      const start = performance.now();
      blind([text], { seed: 'p', now: FIXED_NOW, paranoid: true });
      expect(performance.now() - start, text.slice(0, 12)).toBeLessThan(3000);
    }
    const many = blind(['@a '.repeat(150_000)], { seed: 'p', now: FIXED_NOW, paranoid: true });
    expect(many.leaks.suspects).toHaveLength(150_000);
  });

  it('C52: flags at least 99% of the annotated corpus values that survive in the blind text, in bare and known mode', () => {
    for (const mode of ['bare', 'known'] as const) {
      let survivors = 0;
      let flagged = 0;
      for (const f of loadCorpus()) {
        const { text, spans, known, dateOrder } = f.parsed;
        const res = blind([text], { known: mode === 'known' ? known : [], seed: f.name, now: FIXED_NOW, dateOrder, paranoid: true });
        const out = res.texts[0] as string;
        for (const a of spans) {
          // Amounts and dates are scaled and shifted, not replaced, so their survival is not a miss.
          if (a.kind === 'amount' || a.kind === 'date' || !survives(a.kind, text.slice(a.start, a.end), out)) continue;
          survivors++;
          if ((res.leaks.suspects ?? []).some((s) => s.start < a.end && a.start < s.end)) flagged++;
        }
      }
      expect(survivors, mode).toBeGreaterThan(400);
      expect(flagged / survivors, mode).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('C52: flags the value itself in these known misses', () => {
    const caught: string[] = [];
    for (const file of loadAdversarial()) {
      for (const c of file.cases.filter((x) => x.expect === 'silent')) {
        const res = blind([c.text], { known: c.known, deny: c.deny, seed: c.seed, now: FIXED_NOW, paranoid: true });
        const at: Array<[number, number]> = [];
        for (const sec of c.secrets) for (let i = c.text.indexOf(sec); i >= 0; i = c.text.indexOf(sec, i + 1)) at.push([i, i + sec.length]);
        if ((res.leaks.suspects ?? []).some((s) => at.some(([a, b]) => s.start < b && a < s.end))) caught.push(c.id);
      }
    }
    expect(caught.sort()).toEqual(['E3', 'E4', 'F13', 'F14', 'O1', 'O3', 'O4', 'S2', 'S5', 'S6', 'X7', 'X8'].sort());
  });
});

describe('paranoid mode in the CLI', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'blind-paranoid-'));
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  const io = (stdin: string): IO & { out: string; err: string } => {
    const o = {
      out: '',
      err: '',
      readStdin: async () => stdin,
      stdout: (t: string) => void (o.out += t),
      stderr: (t: string) => void (o.err += t),
      env: { BLIND_HOME: join(work, 'home') } as Record<string, string | undefined>,
      homedir: join(work, 'userhome'),
      stdinIsTty: false,
      uid: process.getuid?.(),
    };
    return o;
  };
  const runs = (): string[] => (existsSync(join(work, 'home', 'runs')) ? readdirSync(join(work, 'home', 'runs')) : []);

  it('C50: --paranoid exits 2 with kinds and input offsets only, writes nothing and saves no run', async () => {
    const text = 'Hola Lucía, the code is 123 45 6789.\n';
    const o = io(text);
    expect(await blindMain(['--paranoid', '--seed', 'p'], o)).toBe(2);
    expect(o.out).toBe('');
    expect(o.err).toContain(`text 1, input offsets ${text.indexOf('Lucía')}-${text.indexOf('Lucía') + 5}, suspect name`);
    expect(o.err).toContain(`text 1, input offsets ${text.indexOf('123')}-${text.indexOf('6789') + 4}, suspect number`);
    for (const real of ['Lucía', '6789']) expect(o.err).not.toContain(real);
    expect(runs()).toEqual([]);
  });

  it('C51: --allow clears suspects from a file, hashtags included, and needs --paranoid', async () => {
    const allow = join(work, 'allow.txt');
    writeFileSync(allow, '# cleared by review\n#\nLucía\n#zorina\n');
    const o = io('Hola Lucía, nos vemos. Follow #zorina for updates.\n');
    expect(await blindMain(['--paranoid', '--allow', allow, '--seed', 'p'], o)).toBe(0);
    expect(o.out).toBe('Hola Lucía, nos vemos. Follow #zorina for updates.\n');
    expect(runs()).toHaveLength(1);
    const bare = io('Hola.\n');
    expect(await blindMain(['--allow', allow], bare)).toBe(1);
    expect(bare.err).toContain('--allow needs --paranoid');
  });
});
