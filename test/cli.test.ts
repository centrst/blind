import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../src/cli/args.js';
import type { IO } from '../src/cli/io.js';
import { blindMain, readDeny, readKnown } from '../src/cli/run-blind.js';
import { unblindMain } from '../src/cli/run-unblind.js';
import { newRunId, validRunId } from '../src/cli/store.js';
import { blind } from '../src/index.js';
import { ROOT } from './support/corpus.js';

// Synthetic thread. Every name, number and domain is invented.
const EMAIL = [
  'From: Marta Quesada <marta@asesores-quesada.example>',
  'To: Joaquín Arroyo <joaquin@arroyo-reformas.example>',
  '',
  'Hola Joaquín, la factura FAC/2026/0187 suma 580,80 € (480,00 € más 21 % de IVA).',
  'Vence el 15 de abril de 2026. Llámame al +34 754 118 902.',
  'Un saludo, Marta Quesada',
].join('\n');

const KNOWN = [
  { kind: 'person', value: 'Marta Quesada' },
  { kind: 'person', value: 'Joaquín Arroyo' },
  { kind: 'org', value: 'Asesores Quesada' },
];

let home: string;
let work: string;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'blind-cli-'));
  home = join(work, 'home');
});
afterEach(() => rmSync(work, { recursive: true, force: true }));

function fakeIO(stdin: string, tty = false): IO & { out: string; err: string } {
  const io = {
    out: '',
    err: '',
    readStdin: async () => stdin,
    stdout: (t: string) => void (io.out += t),
    stderr: (t: string) => void (io.err += t),
    env: { BLIND_HOME: home } as Record<string, string | undefined>,
    homedir: join(work, 'userhome'),
    stdinIsTty: tty,
    uid: process.getuid?.(),
  };
  return io;
}

function writeKnown(): string {
  const p = join(work, 'known.json');
  writeFileSync(p, JSON.stringify(KNOWN));
  return p;
}

const runIdOf = (err: string): string => /blind: run (\S+)/.exec(err)![1]!;

describe('CLI in process', () => {
  it('C12: blind writes the blind text, saves a private mapping and prints the run id', async () => {
    const io = fakeIO(EMAIL);
    const code = await blindMain(['--known', writeKnown(), '--seed', 's1'], io);
    expect(code).toBe(0);
    for (const real of ['Marta', 'Quesada', 'Joaquín', 'Arroyo', '580,80', '+34 754 118 902', 'quesada.example']) expect(io.out).not.toContain(real);
    const id = runIdOf(io.err);
    const file = join(home, 'runs', `${id}.json`);
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, 'runs')).mode & 0o777).toBe(0o700);
    expect(statSync(home).mode & 0o777).toBe(0o700);
  });

  it('C12: unblind restores the text exactly and lists values the lab invented', async () => {
    const b = fakeIO(EMAIL);
    await blindMain(['--known', writeKnown(), '--seed', 's2'], b);
    const id = runIdOf(b.err);
    const answer = `${b.out}\nP.S. Total extra: 99,00 € on 2031-05-05.`;
    const u = fakeIO(answer);
    expect(await unblindMain(['--run', id], u)).toBe(0);
    expect(u.out.startsWith(EMAIL)).toBe(true);
    expect(u.err).toContain('invented');
    expect(u.err).toContain('2031-05-05');
    const clean = fakeIO(b.out);
    await unblindMain(['--run', id], clean);
    expect(clean.out).toBe(EMAIL);
    expect(clean.err).toBe('');
  });

  it('unblind reads the answer from a file, and names a bad file, a second file, a stray run id or a terminal on stdin', async () => {
    const b = fakeIO(EMAIL);
    await blindMain(['--known', writeKnown(), '--seed', 's3'], b);
    const id = runIdOf(b.err);
    const answer = join(work, 'answer.txt');
    writeFileSync(answer, b.out);
    const fromFile = fakeIO('', true);
    expect(await unblindMain(['--run', id, answer], fromFile)).toBe(0);
    expect(fromFile.out).toBe(EMAIL);
    const firstLine = async (argv: string[], tty = true): Promise<string> => {
      const io = fakeIO('', tty);
      expect(await unblindMain(argv, io)).toBe(1);
      return io.err.split('\n')[0] as string;
    };
    const missing = join(work, 'missing.txt');
    expect(await firstLine(['--run', id, missing])).toBe(`unblind: cannot read file: ${missing}`);
    expect(await firstLine(['--run', id, answer, answer])).toBe('unblind: give at most one file');
    expect(await firstLine(['--run', id])).toBe('unblind: no input: give a file or pipe the answer to stdin');
    expect(await firstLine(['--forget', id, answer])).toBe('unblind: --forget takes only a run id');
  });

  it('C12: a leak exits 2, prints kinds and offsets only, writes nothing and saves no run', async () => {
    // Rosa is not in --known and the text also writes "rosa" as a word, so her bare first name is
    // not carried from the header. The leak check still knows it and stops the run.
    const text = 'From: Rosa Quesada <rosa@asesores-quesada.example>\n\nHola Rosa, la pintura rosa ya llegó.\n';
    const io = fakeIO(text);
    const code = await blindMain(['--seed', 'leak'], io);
    expect(code).toBe(2);
    expect(io.out).toBe('');
    expect(io.err).toMatch(/text 1, offset \d+, kind person/);
    for (const real of ['Rosa', 'rosa', 'Quesada', 'asesores']) expect(io.err).not.toContain(real);
    expect(existsSync(join(home, 'runs')) ? readdirSync(join(home, 'runs')) : []).toEqual([]);
  });

  it('C3: a known entry with a stop-word part is named on stderr by index and kind only, and the run still succeeds', async () => {
    const known = join(work, 'known-stop.json');
    writeFileSync(known, JSON.stringify([{ kind: 'person', value: 'Li Na' }, { kind: 'person', value: 'Al Brenner' }, { kind: 'person', value: 'Al' }]));
    const io = fakeIO('Al Brenner vino. Hablé con al ayer.');
    expect(await blindMain(['--known', known, '--seed', 'stop'], io)).toBe(0);
    expect(io.out.endsWith(' vino. Hablé con al ayer.')).toBe(true);
    expect(io.err.split('\n').filter((l) => l.startsWith('blind: known entry'))).toEqual([
      'blind: known entry 1, kind person, has a part on the stop list: enforced only as written or in capitals, so a lower-case copy can stay unreported',
      'blind: known entry 2, kind person, is made of stop words: enforced only as written or in capitals, so a lower-case copy can stay unreported',
    ]);
    expect(io.err).not.toMatch(/\bAl\b|Brenner|\bLi\b|\bNa\b/);
    expect(io.err).toMatch(/blind: run \S+/);
  });

  it('C3: a known entry with a one-letter part is named on stderr by index and kind only, and the run still succeeds', async () => {
    const known = join(work, 'known-one-letter.json');
    writeFileSync(known, JSON.stringify([{ kind: 'person', value: 'O Li' }]));
    const io = fakeIO('O Li vino. O dijo que sí o que no.');
    expect(await blindMain(['--known', known, '--seed', 'one'], io)).toBe(0);
    expect(io.out).toContain(' dijo que sí o que no.');
    expect(io.out).not.toMatch(/(?<!\p{L})O(?!\p{L})|\bLi\b/u);
    expect(io.err.split('\n').filter((l) => l.startsWith('blind: known entry'))).toEqual([
      'blind: known entry 0, kind person, has a one-letter part: enforced only as written or in capitals, so a lower-case copy can stay unreported',
    ]);
    expect(io.err).not.toMatch(/(?<!\p{L})O(?!\p{L})|\bLi\b/u);
  });

  it('C40: a two-syllable Korean known entry is named on stderr by index and kind only, and the run still succeeds', async () => {
    const known = join(work, 'known-hangul.json');
    writeFileSync(known, JSON.stringify([{ kind: 'person', value: '지원' }]));
    const io = fakeIO('지원님이 왔다. 우리팀지원님도.');
    expect(await blindMain(['--known', known, '--seed', 'ko'], io)).toBe(0);
    expect(io.out.endsWith('님이 왔다. 우리팀지원님도.')).toBe(true);
    expect(io.out.startsWith('지원')).toBe(false);
    expect(io.err.split('\n').filter((l) => l.startsWith('blind: known entry'))).toEqual([
      'blind: known entry 0, kind person, is two Korean syllables: enforced only where a word starts, so a copy inside a longer word can stay unreported',
    ]);
    expect(io.err).not.toMatch(/\p{scx=Hangul}/u);
  });

  it('C12: --deny entries trigger exit 2 and are never echoed', async () => {
    const deny = join(work, 'deny.txt');
    writeFileSync(deny, '# comment\nProject Falcon\n\n');
    const io = fakeIO('Status of Project Falcon: open.');
    expect(await blindMain(['--deny', deny], io)).toBe(2);
    expect(io.err).toContain('kind deny');
    expect(io.err).not.toContain('Falcon');
  });

  it('C12: the same seed and input give the same output, a different seed does not', async () => {
    const run = async (seed: string): Promise<string> => {
      const io = fakeIO(EMAIL);
      await blindMain(['--known', writeKnown(), '--seed', seed], io);
      return io.out;
    };
    expect(await run('same')).toBe(await run('same'));
    expect(await run('same')).not.toBe(await run('other'));
  });

  it('C12: --json writes runId and texts', async () => {
    const f1 = join(work, 'a.txt');
    const f2 = join(work, 'b.txt');
    writeFileSync(f1, 'Total 100,00 € el 3 de marzo de 2026.');
    writeFileSync(f2, 'Otra vez 100,00 € el 3 de marzo de 2026.');
    const io = fakeIO('');
    expect(await blindMain(['--json', '--seed', 'j', f1, f2], io)).toBe(0);
    const parsed = JSON.parse(io.out) as { runId: string; texts: string[] };
    expect(parsed.texts).toHaveLength(2);
    expect(parsed.runId).toBe(runIdOf(io.err));
    // One mapping for both files: the same amount gets the same fake.
    expect(/\d+,\d\d €/.exec(parsed.texts[0]!)![0]).toBe(/\d+,\d\d €/.exec(parsed.texts[1]!)![0]);
  });

  it('C12: several files are separated by a numbered marker that holds no file name', async () => {
    const f1 = join(work, 'ana-ruiz-contract.txt');
    writeFileSync(f1, 'Total 100,00 €');
    const f2 = join(work, 'second.txt');
    writeFileSync(f2, 'Total 50,00 €');
    const io = fakeIO('');
    await blindMain([f1, f2], io);
    expect(io.out).toContain('===== text 1 =====');
    expect(io.out).toContain('===== text 2 =====');
    expect(io.out).not.toContain('ana-ruiz');
  });

  it('C12: --date-order changes how 05/06/2026 is read', async () => {
    const run = async (order: string): Promise<string> => {
      const io = fakeIO('Cita el 05/06/2026.');
      await blindMain(['--seed', 'ord', '--date-order', order], io);
      return io.out;
    };
    expect(await run('dmy')).not.toBe(await run('mdy'));
  });

  it('C36: a long token goes through blind with nothing of it on stderr', async () => {
    const text = `x ${'a1'.repeat(5000)}`;
    const io = fakeIO(text);
    const code = await blindMain(['--seed', 'c32'], io);
    const slices = new Set<string>();
    for (let i = 0; i + 8 <= io.err.length; i++) slices.add(io.err.slice(i, i + 8));
    let quoted = false;
    for (let i = 0; i + 8 <= text.length && !quoted; i++) quoted = slices.has(text.slice(i, i + 8));
    expect(quoted).toBe(false);
    expect(code).toBe(0);
    // On success stderr holds the run id line and nothing else.
    expect(io.err).toMatch(/^blind: run \S+\n$/);
    expect(io.out).toBe(blind([text], { seed: 'c32' }).texts[0]);
    expect(io.out).not.toContain('a1a1a1a1');
  });

  it('C12: --forget deletes a run and unblind then refuses it', async () => {
    const b = fakeIO('Total 100,00 €');
    await blindMain([], b);
    const id = runIdOf(b.err);
    const f = fakeIO('');
    expect(await unblindMain(['--forget', id], f)).toBe(0);
    expect(existsSync(join(home, 'runs', `${id}.json`))).toBe(false);
    const u = fakeIO(b.out);
    expect(await unblindMain(['--run', id], u)).toBe(1);
    expect(u.err).toContain('no such run');
    expect(await unblindMain(['--forget', id], fakeIO(''))).toBe(1);
  });

  it('C12: a damaged run file is refused without a word of its content', async () => {
    const b = fakeIO('Total 100,00 €');
    await blindMain([], b);
    const id = runIdOf(b.err);
    writeFileSync(join(home, 'runs', `${id}.json`), '{"version":1,"mapping":{"pairs":[{"real":"Marta Quesada"');
    const u = fakeIO(b.out);
    expect(await unblindMain(['--run', id], u)).toBe(1);
    expect(u.err).toContain('damaged');
    expect(u.err).not.toContain('Quesada');
    expect(u.out).toBe('');
  });

  it.skipIf(!process.getuid)('C12: an existing BLIND_HOME and runs/ open to others are tightened to 0700 and named on stderr', async () => {
    mkdirSync(join(home, 'runs'), { recursive: true, mode: 0o755 });
    chmodSync(home, 0o755);
    chmodSync(join(home, 'runs'), 0o750);
    const io = fakeIO(EMAIL);
    expect(await blindMain(['--known', writeKnown()], io)).toBe(0);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(statSync(join(home, 'runs')).mode & 0o777).toBe(0o700);
    expect(io.err).toContain(`${home} was readable by others, set it to 0700`);
    expect(io.err).toContain(`${join(home, 'runs')} was readable by others, set it to 0700`);
    for (const real of ['Marta', 'Quesada', 'Joaquín', '580,80']) expect(io.err).not.toContain(real);
    // Already private: nothing to say the second time.
    const again = fakeIO('Total 100,00 €');
    await blindMain([], again);
    expect(again.err).not.toContain('readable by others');
  });

  it.skipIf(!process.getuid)('C12: a BLIND_HOME owned by another user is refused by path, nothing is written and no run is saved', async () => {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const io = fakeIO(EMAIL);
    io.uid = statSync(home).uid + 1;
    expect(await blindMain(['--known', writeKnown()], io)).toBe(1);
    expect(io.out).toBe('');
    expect(io.err).toContain(`${home} is owned by another user; refusing to store runs there`);
    for (const real of ['Marta', 'Quesada', 'Joaquín', '580,80']) expect(io.err).not.toContain(real);
    expect(existsSync(join(home, 'runs'))).toBe(false);
  });

  it('C12: a BLIND_HOME that is a file is refused', async () => {
    mkdirSync(work, { recursive: true });
    writeFileSync(home, 'not a directory');
    const io = fakeIO('Total 100,00 €');
    expect(await blindMain([], io)).toBe(1);
    expect(io.out).toBe('');
    expect(io.err).toContain(`${home} is not a directory`);
  });

  it('C12: unblind --list prints run ids, creation times and modes, never values', async () => {
    const empty = fakeIO('');
    expect(await unblindMain(['--list'], empty)).toBe(0);
    expect(empty.out).toBe('');
    expect(empty.err).toContain('no saved runs');
    const ids: string[] = [];
    for (const mode of ['fake', 'placeholder', 'random']) {
      const b = fakeIO(EMAIL);
      expect(await blindMain(['--known', writeKnown(), '--replace-with', mode], b)).toBe(0);
      ids.push(runIdOf(b.err));
    }
    // A damaged run is listed as damaged and its content is not read out.
    const broken = '20260101T000000Z-0badc0de';
    writeFileSync(join(home, 'runs', `${broken}.json`), '{"version":1,"createdAt":"Marta Quesada"');
    const io = fakeIO('');
    expect(await unblindMain(['--list'], io)).toBe(0);
    const lines = io.out.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe(`${broken}  damaged`);
    expect(lines.slice(1).map((l) => l.split('  ')[2])).toEqual(expect.arrayContaining(['fake', 'placeholder', 'random']));
    for (const [i, line] of lines.slice(1).entries()) expect(line, ids[i]).toMatch(/^\S+  \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z  (fake|placeholder|random)$/);
    expect(lines.slice(1).map((l) => l.split('  ')[0]).sort()).toEqual([...ids].sort());
    for (const real of ['Marta', 'Quesada', 'Joaquín', '580,80', 'quesada.example']) expect(io.out + io.err).not.toContain(real);
  });

  it('C12: unblind --forget-all says how many runs it deletes, then deletes them all', async () => {
    for (let i = 0; i < 3; i++) await blindMain([], fakeIO('Total 100,00 €'));
    expect(readdirSync(join(home, 'runs'))).toHaveLength(3);
    const io = fakeIO('');
    expect(await unblindMain(['--forget-all'], io)).toBe(0);
    expect(io.err).toBe('unblind: forgetting 3 run(s)\n');
    expect(io.out).toBe('');
    expect(readdirSync(join(home, 'runs'))).toEqual([]);
    const again = fakeIO('');
    expect(await unblindMain(['--forget-all'], again)).toBe(0);
    expect(again.err).toBe('unblind: forgetting 0 run(s)\n');
    for (const args of [['--list', '--forget-all'], ['--list', 'answer.txt'], ['--forget-all', '--run', 'x'], ['--list', '--forget', 'x']]) {
      expect(await unblindMain(args, fakeIO('')), args.join(' ')).toBe(1);
    }
  });

  it('C12: usage errors exit 1 with a message', async () => {
    for (const args of [['--nope'], ['--seed'], ['--date-order', 'ymd'], ['--known', join(work, 'missing.json')], [join(work, 'missing.txt')]]) {
      const io = fakeIO('x');
      expect(await blindMain(args, io), args.join(' ')).toBe(1);
      expect(io.err).toContain('usage:');
    }
    const bad = join(work, 'bad.json');
    writeFileSync(bad, JSON.stringify([{ kind: 'planet', value: 'Mars' }]));
    expect(await blindMain(['--known', bad], fakeIO('x'))).toBe(1);
    expect(await blindMain([], fakeIO('', true))).toBe(1);
    expect(await unblindMain([], fakeIO('x'))).toBe(1);
    expect(await unblindMain(['--run', '../etc/passwd'], fakeIO('x'))).toBe(1);
    expect(await unblindMain(['--run', 'a', '--forget', 'b'], fakeIO('x'))).toBe(1);
    const forget = fakeIO('x');
    expect(await unblindMain(['--forget', '../etc/passwd'], forget)).toBe(1);
    expect(forget.err).not.toContain('passwd');
  });

  it('C12: help prints usage and exits 0', async () => {
    const a = fakeIO('');
    expect(await blindMain(['--help'], a)).toBe(0);
    expect(a.out).toContain('usage: blind');
    const b = fakeIO('');
    expect(await unblindMain(['-h'], b)).toBe(0);
    expect(b.out).toContain('usage: unblind');
  });

  it('C29: --replace-with stores the mode in the run, and unblind restores placeholder and random output from it', async () => {
    for (const mode of ['placeholder', 'random'] as const) {
      const b = fakeIO(EMAIL);
      expect(await blindMain(['--known', writeKnown(), '--seed', 's9', '--replace-with', mode], b)).toBe(0);
      if (mode === 'placeholder') expect(b.out).toContain('From: [REDACTED_PERSON_1] <[REDACTED_EMAIL_1]>');
      for (const real of ['Marta', 'Quesada', 'Joaquín', '580,80', '15 de abril', '+34 754 118 902']) expect(b.out, real).not.toContain(real);
      const id = runIdOf(b.err);
      const saved = JSON.parse(readFileSync(join(home, 'runs', `${id}.json`), 'utf8')) as { replaceWith: string; mapping: { replaceWith: string } };
      expect(saved.replaceWith).toBe(mode);
      expect(saved.mapping.replaceWith).toBe(mode);
      const u = fakeIO(b.out);
      expect(await unblindMain(['--run', id], u)).toBe(0);
      expect(u.out).toBe(EMAIL);
    }
    const bad = fakeIO('x');
    expect(await blindMain(['--replace-with', 'mask'], bad)).toBe(1);
    expect(bad.err).toContain('--replace-with must be fake, placeholder, random');
    const plain = fakeIO('Total 100,00 €');
    await blindMain([], plain);
    expect((JSON.parse(readFileSync(join(home, 'runs', `${runIdOf(plain.err)}.json`), 'utf8')) as { replaceWith: string }).replaceWith).toBe('fake');
  });

  it('C12: the home directory defaults to ~/.blind when BLIND_HOME is unset', async () => {
    const io = fakeIO('Total 100,00 €');
    io.env = {};
    await blindMain([], io);
    expect(existsSync(join(work, 'userhome', '.blind', 'runs'))).toBe(true);
  });
});

describe('CLI helpers', () => {
  it('parses long options, equals form, terminator and positionals', () => {
    const spec = { seed: { value: true }, json: { value: false } };
    expect(parseArgs(['--seed=a', '--json', 'f', '--', '--json'], spec)).toEqual({ options: { seed: 'a', json: true }, positional: ['f', '--json'] });
    expect(() => parseArgs(['--json=1'], spec)).toThrow(UsageError);
    expect(() => parseArgs(['--seed', '--json'], spec)).toThrow(UsageError);
  });

  it('names what is wrong with an option, and takes a value that starts with dashes only after an equals sign', () => {
    const spec = { seed: { value: true }, json: { value: false } };
    const message = (argv: string[]): string => {
      try {
        parseArgs(argv, spec);
      } catch (e) {
        return `${(e as Error).name}: ${(e as Error).message}`;
      }
      return 'ok';
    };
    expect(message(['--nope'])).toBe('UsageError: unknown option --nope');
    expect(message(['--json=1'])).toBe('UsageError: --json takes no value');
    expect(message(['--seed'])).toBe('UsageError: --seed needs a value');
    expect(message(['--seed', '--json'])).toBe('UsageError: --seed needs a value');
    expect(parseArgs(['--seed=--json', '-h', '--seed', 'b'], spec)).toEqual({ options: { seed: 'b', help: true }, positional: [] });
    expect(parseArgs(['--seed=--json'], spec).options.seed).toBe('--json');
  });

  it('reads a known file as a JSON array of kinds and string values, naming the entry that is not one', () => {
    const file = (name: string, body: string): string => {
      const path = join(work, name);
      writeFileSync(path, body);
      return path;
    };
    const message = (fn: () => unknown): string => {
      try {
        fn();
      } catch (e) {
        return `${(e as Error).name}: ${(e as Error).message}`;
      }
      return 'ok';
    };
    expect(readKnown(file('k.json', '[{"kind":"person","value":"Ana Ruiz"},{"kind":"org","value":"Norte"}]'))).toEqual([{ kind: 'person', value: 'Ana Ruiz' }, { kind: 'org', value: 'Norte' }]);
    const bad = file('bad.json', '{');
    expect(message(() => readKnown(bad))).toBe(`UsageError: cannot read --known file as JSON: ${bad}`);
    expect(message(() => readKnown(file('obj.json', '{"kind":"person"}')))).toBe('UsageError: --known must hold a JSON array of { kind, value }');
    const kinds = 'person, org, email, domain, phone, place, id';
    expect(message(() => readKnown(file('n.json', '[{"kind":"person","value":"Ana"},null]')))).toBe(`UsageError: --known entry 1 needs a kind (${kinds}) and a string value`);
    expect(message(() => readKnown(file('v.json', '[{"kind":"person","value":5}]')))).toBe(`UsageError: --known entry 0 needs a kind (${kinds}) and a string value`);
    expect(message(() => readKnown(file('i.json', '[{"kind":"iban","value":"x"}]')))).toBe(`UsageError: --known entry 0 needs a kind (${kinds}) and a string value`);
  });

  it('reads a deny file line by line, trimmed, skipping blank lines and comments', () => {
    const path = join(work, 'deny.txt');
    writeFileSync(path, '  Project Falcon  \r\n\n# a comment\n*@vidal.example\nnot # a comment\n   \n');
    expect(readDeny(path)).toEqual(['Project Falcon', '*@vidal.example', 'not # a comment']);
    const missing = join(work, 'missing.txt');
    expect(() => readDeny(missing)).toThrow(`cannot read --deny file: ${missing}`);
  });

  it('makes sortable run ids and refuses path tricks', () => {
    const a = newRunId(new Date('2026-10-08T13:00:00Z'));
    expect(a).toMatch(/^20261008T130000Z-[0-9a-f]{8}$/);
    expect(validRunId(a)).toBe(true);
    for (const bad of ['', '..', 'a/b', '../x', '.hidden', 'a b', 'x'.repeat(200)]) expect(validRunId(bad), bad).toBe(false);
  });
});

describe.skipIf(process.env.MUTATION)('CLI spawned from dist', () => {
  const bin = (name: string): string => join(ROOT, 'dist', 'cli', `${name}.js`);
  const run = (name: string, args: string[], input: string, env: Record<string, string>): ReturnType<typeof spawnSync> =>
    spawnSync(process.execPath, [bin(name), ...args], { input, encoding: 'utf8', env: { ...process.env, ...env } });

  it('C12: blind then unblind through real pipes', () => {
    const known = writeKnown();
    const b = run('blind', ['--known', known, '--seed', 'spawn'], EMAIL, { BLIND_HOME: home });
    expect(b.status).toBe(0);
    expect(b.stdout).not.toContain('Quesada');
    const id = /blind: run (\S+)/.exec(b.stderr as string)![1]!;
    const u = run('unblind', ['--run', id], b.stdout as string, { BLIND_HOME: home });
    expect(u.status).toBe(0);
    expect(u.stdout).toBe(EMAIL);
    const gone = run('unblind', ['--forget', id], '', { BLIND_HOME: home });
    expect(gone.status).toBe(0);
    expect(readdirSync(join(home, 'runs'))).toEqual([]);
  });

  it('C12: a leak exits 2 through the real binary', () => {
    const r = run('blind', [], 'From: Rosa Quesada <rosa@asesores-quesada.example>\n\nHola Rosa, la pintura rosa ya llegó.\n', { BLIND_HOME: home });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toMatch(/rosa/i);
  });

  it('C12: the saved run file holds the mapping and is readable only by the owner', () => {
    const r = run('blind', ['--seed', 'perm'], 'Total 100,00 € el 3 de marzo de 2026.', { BLIND_HOME: home });
    const id = /blind: run (\S+)/.exec(r.stderr as string)![1]!;
    const file = join(home, 'runs', `${id}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { mapping: { pairs: unknown[] } };
    expect(saved.mapping.pairs.length).toBeGreaterThan(0);
  });
});
