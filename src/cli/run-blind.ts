import { readFileSync } from 'node:fs';
import { blind } from '../blind.js';
import { REPLACE_MODES } from '../replace.js';
import type { DateOrder, KnownKind, KnownValue, ReplaceWith } from '../types.js';
import { parseArgs, UsageError } from './args.js';
import type { IO } from './io.js';
import { saveRun } from './store.js';

export const BLIND_USAGE = `usage: blind [options] [file ...]

Reads text from the files, or from stdin, and writes a blind copy to stdout.
The mapping that undoes it stays in $BLIND_HOME/runs (default ~/.blind/runs).
The run id goes to stderr. Give it to \`unblind --run <id>\` with the answer.

options:
  --known <file>       JSON array of { "kind", "value" } you know are private
  --deny <file>        one string per line that must not appear in the output
  --seed <string>      same seed and input give the same output
  --date-order <o>     dmy (default) or mdy for dates like 07/04/2026
  --replace-with <m>   fake (default), placeholder ([REDACTED_PERSON_1]) or random
  --paranoid           also fail on anything left that looks private: capitalised
                       words, long digit runs, handles, encoded text, spelled-out
                       addresses. Expect ordinary words among them
  --allow <file>       with --paranoid, one cleared word or phrase per line
  --json               write { "runId", "texts", "identities" } instead of plain text
  -h, --help           show this help

exit codes: 0 done, 1 usage or file error, 2 the leak check found something
or --paranoid flagged a suspect (kinds and offsets go to stderr, nothing goes
to stdout, no run is saved)
`;

const KINDS: KnownKind[] = ['person', 'org', 'email', 'domain', 'phone', 'place', 'id'];

export function readKnown(path: string): KnownValue[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new UsageError(`cannot read --known file as JSON: ${path}`);
  }
  if (!Array.isArray(raw)) throw new UsageError('--known must hold a JSON array of { kind, value }');
  return raw.map((item, i) => {
    const o = item as { kind?: unknown; value?: unknown };
    if (!o || typeof o.value !== 'string' || !KINDS.includes(o.kind as KnownKind)) {
      throw new UsageError(`--known entry ${i} needs a kind (${KINDS.join(', ')}) and a string value`);
    }
    return { kind: o.kind as KnownKind, value: o.value };
  });
}

/**
 * One entry per line, blank lines skipped. In a --deny file every line that starts with `#`
 * is a comment. In an --allow file only `#` alone or followed by a space is, so a cleared
 * hashtag (`#zorina`) can be listed.
 */
export function readDeny(path: string, flag: '--deny' | '--allow' = '--deny'): string[] {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new UsageError(`cannot read ${flag} file: ${path}`);
  }
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !(flag === '--allow' ? /^#(?:\s|$)/.test(l) : l.startsWith('#')));
}

export async function blindMain(argv: string[], io: IO): Promise<number> {
  try {
    const { options, positional } = parseArgs(argv, {
      known: { value: true },
      deny: { value: true },
      seed: { value: true },
      'date-order': { value: true },
      'replace-with': { value: true },
      paranoid: { value: false },
      allow: { value: true },
      json: { value: false },
      help: { value: false },
    });
    if (options.help) {
      io.stdout(BLIND_USAGE);
      return 0;
    }
    const order = options['date-order'];
    if (order !== undefined && order !== 'dmy' && order !== 'mdy') throw new UsageError('--date-order must be dmy or mdy');
    if (options.allow !== undefined && !options.paranoid) throw new UsageError('--allow needs --paranoid');
    const mode = options['replace-with'];
    if (mode !== undefined && !REPLACE_MODES.includes(mode as ReplaceWith)) throw new UsageError(`--replace-with must be ${REPLACE_MODES.join(', ')}`);

    const texts: string[] = [];
    if (positional.length > 0) {
      for (const f of positional) {
        try {
          texts.push(readFileSync(f, 'utf8'));
        } catch {
          throw new UsageError(`cannot read file: ${f}`);
        }
      }
    } else {
      if (io.stdinIsTty) throw new UsageError('no input: give files or pipe text to stdin');
      texts.push(await io.readStdin());
    }

    const known = typeof options.known === 'string' ? readKnown(options.known) : [];
    const deny = typeof options.deny === 'string' ? readDeny(options.deny) : [];
    const allow = typeof options.allow === 'string' ? readDeny(options.allow, '--allow') : [];
    const result = blind(texts, {
      known,
      deny,
      ...(options.paranoid ? { paranoid: true, allow } : {}),
      seed: typeof options.seed === 'string' ? options.seed : undefined,
      dateOrder: order as DateOrder | undefined,
      replaceWith: mode as ReplaceWith | undefined,
    });

    // By index and kind only, whatever the outcome, so the caller can give the entry another way (--replace-with placeholder, --deny).
    for (const u of result.leaks.unenforced) {
      if (u.reason === 'hangul-inside-word') {
        io.stderr(`blind: known entry ${u.index}, kind ${u.kind}, is two Korean syllables: enforced only where a word starts, so a copy inside a longer word can stay unreported\n`);
        continue;
      }
      const why = u.reason === 'stop-word' ? 'is made of stop words' : u.reason === 'one-letter-part' ? 'has a one-letter part' : 'has a part on the stop list';
      io.stderr(`blind: known entry ${u.index}, kind ${u.kind}, ${why}: enforced only as written or in capitals, so a lower-case copy can stay unreported\n`);
    }
    const suspects = result.leaks.suspects ?? [];
    if (!result.leaks.ok) {
      const hits = result.leaks.hits;
      if (hits.length > 0) {
        io.stderr(`blind: leak check found ${hits.length} hit(s). Nothing written, no run saved.\n`);
        for (const h of hits) io.stderr(`  text ${h.textIndex + 1}, offset ${h.offset}, kind ${h.kind}\n`);
      }
      if (suspects.length > 0) {
        // Offsets in the input file, so the reviewer finds each one in what they hold.
        io.stderr(`blind: paranoid mode flagged ${suspects.length} suspect(s) left as written.${hits.length ? '' : ' Nothing written, no run saved.'}\n`);
        for (const s of suspects) io.stderr(`  text ${s.textIndex + 1}, input offsets ${s.start}-${s.end}, suspect ${s.kind}\n`);
      }
      io.stderr(suspects.length ? 'Add private values to --known, cleared ones to --allow, and run again.\n' : 'Add the values to --known or --deny and run again.\n');
      return 2;
    }

    const runId = saveRun(io, result.mapping);
    if (options.json) io.stdout(`${JSON.stringify({ runId, texts: result.texts, identities: result.identities })}\n`);
    else if (result.texts.length === 1) io.stdout(result.texts[0] as string);
    else result.texts.forEach((t, i) => io.stdout(`${i === 0 ? '' : '\n'}===== text ${i + 1} =====\n${t}`));
    io.stderr(`blind: run ${runId}\n`);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`blind: ${e.message}\n\n${BLIND_USAGE}`);
      return 1;
    }
    io.stderr(`blind: ${e instanceof Error ? e.message : 'failed'}\n`);
    return 1;
  }
}
