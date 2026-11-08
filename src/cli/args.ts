/** A small argument parser. Long options only, plus -h. No dependencies. */

export interface OptionSpec {
  /** Takes a value (`--seed abc` or `--seed=abc`). Otherwise a boolean flag. */
  value: boolean;
}

export interface Parsed {
  options: Record<string, string | true>;
  positional: string[];
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseArgs(argv: string[], spec: Record<string, OptionSpec>): Parsed {
  const options: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h') {
      options.help = true;
      continue;
    }
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    const def = spec[name];
    if (!def) throw new UsageError(`unknown option --${name}`);
    if (!def.value) {
      if (eq >= 0) throw new UsageError(`--${name} takes no value`);
      options[name] = true;
      continue;
    }
    let val: string | undefined;
    if (eq >= 0) val = arg.slice(eq + 1);
    else {
      val = argv[i + 1];
      i++;
    }
    if (val === undefined || (eq < 0 && val.startsWith('--'))) throw new UsageError(`--${name} needs a value`);
    options[name] = val;
  }
  return { options, positional };
}
