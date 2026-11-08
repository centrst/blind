import { readFileSync } from 'node:fs';
import { unblind } from '../unblind.js';
import { parseArgs, UsageError } from './args.js';
import type { IO } from './io.js';
import { forgetRun, listRuns, loadRun, validRunId } from './store.js';

export const UNBLIND_USAGE = `usage: unblind --run <id> [file]
       unblind --forget <id>
       unblind --list
       unblind --forget-all

Reads the lab's answer from the file, or from stdin, and writes it back with
the real values to stdout. Values the lab invented (amounts, dates, emails,
names with no fake behind them) are listed on stderr, so you can distrust them.

options:
  --run <id>       the run id that \`blind\` printed on stderr
  --forget <id>    delete that run's saved mapping
  --list           print each saved run's id, creation time and mode
  --forget-all     delete every saved run
  -h, --help       show this help

exit codes: 0 done, 1 usage, file or unknown run error
`;

export async function unblindMain(argv: string[], io: IO): Promise<number> {
  try {
    const { options, positional } = parseArgs(argv, {
      run: { value: true },
      forget: { value: true },
      list: { value: false },
      'forget-all': { value: false },
      help: { value: false },
    });
    if (options.help) {
      io.stdout(UNBLIND_USAGE);
      return 0;
    }
    const actions = ['run', 'forget', 'list', 'forget-all'].filter((k) => options[k] !== undefined);
    if (actions.length > 1) throw new UsageError(`give only one of ${actions.map((a) => `--${a}`).join(', ')}`);
    if (options.list || options['forget-all']) {
      if (positional.length > 0) throw new UsageError(`--${actions[0]} takes no file`);
      const runs = listRuns(io);
      if (options.list) {
        for (const r of runs) io.stdout('damaged' in r ? `${r.runId}  damaged\n` : `${r.runId}  ${r.createdAt}  ${r.replaceWith}\n`);
        if (runs.length === 0) io.stderr('unblind: no saved runs\n');
        return 0;
      }
      io.stderr(`unblind: forgetting ${runs.length} run(s)\n`);
      for (const r of runs) forgetRun(io, r.runId);
      return 0;
    }
    if (typeof options.forget === 'string') {
      if (positional.length > 0) throw new UsageError('--forget takes only a run id');
      if (!validRunId(options.forget)) throw new UsageError('that is not a run id');
      if (!forgetRun(io, options.forget)) throw new UsageError(`no such run: ${options.forget}`);
      io.stderr(`unblind: forgot run ${options.forget}\n`);
      return 0;
    }
    if (typeof options.run !== 'string') throw new UsageError('--run <id> is required');
    if (positional.length > 1) throw new UsageError('give at most one file');
    if (!validRunId(options.run)) throw new UsageError('that is not a run id');
    const run = loadRun(io, options.run);
    if (!run) throw new UsageError(`no such run: ${options.run}`);

    let answer: string;
    if (positional[0] !== undefined) {
      try {
        answer = readFileSync(positional[0], 'utf8');
      } catch {
        throw new UsageError(`cannot read file: ${positional[0]}`);
      }
    } else {
      if (io.stdinIsTty) throw new UsageError('no input: give a file or pipe the answer to stdin');
      answer = await io.readStdin();
    }

    const { text, invented } = unblind(answer, run.mapping);
    io.stdout(text);
    if (invented.length > 0) {
      io.stderr(`unblind: ${invented.length} value(s) the lab invented, not from your text:\n`);
      for (const v of invented) io.stderr(`  ${JSON.stringify(v)}\n`);
    }
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(`unblind: ${e.message}\n\n${UNBLIND_USAGE}`);
      return 1;
    }
    io.stderr(`unblind: ${e instanceof Error ? e.message : 'failed'}\n`);
    return 1;
  }
}
