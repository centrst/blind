/** Reads a Stryker JSON report. Timeouts count as kills, compile errors and ignored mutants do not count. */
export interface Mutant {
  id?: string;
  mutatorName?: string;
  status: string;
  location?: { start: { line: number; column: number }; end: { line: number; column: number } };
  replacement?: string;
  description?: string;
}
export interface MutationReport {
  files: Record<string, { source?: string; mutants: Mutant[] }>;
}

export function mutationScore(report: MutationReport): number {
  let killed = 0;
  let valid = 0;
  for (const f of Object.values(report.files)) {
    for (const m of f.mutants) {
      if (m.status === 'Ignored' || m.status === 'CompileError') continue;
      valid++;
      if (m.status === 'Killed' || m.status === 'Timeout') killed++;
    }
  }
  return valid === 0 ? 0 : (killed / valid) * 100;
}

export interface Survivor {
  file: string;
  line: number;
  mutator: string;
  replacement: string;
  original: string;
  status: string;
}

export function survivors(report: MutationReport, fileMatch: RegExp): Survivor[] {
  const out: Survivor[] = [];
  for (const [file, f] of Object.entries(report.files)) {
    if (!fileMatch.test(file)) continue;
    const lines = (f.source ?? '').split('\n');
    for (const m of f.mutants) {
      if (m.status !== 'Survived' && m.status !== 'NoCoverage') continue;
      const loc = m.location!;
      const line = lines[loc.start.line - 1] ?? '';
      const original = loc.start.line === loc.end.line ? line.slice(loc.start.column - 1, loc.end.column - 1) : line.slice(loc.start.column - 1);
      out.push({ file, line: loc.start.line, mutator: m.mutatorName ?? '', replacement: (m.replacement ?? '').replace(/\s+/g, ' ').slice(0, 120), original: original.replace(/\s+/g, ' ').slice(0, 120), status: m.status });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
