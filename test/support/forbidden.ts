/** Modules and globals the library must never reach for (claim C7). */
export const FORBIDDEN_MODULES = ['http', 'https', 'http2', 'net', 'tls', 'dns', 'dgram', 'child_process', 'worker_threads', 'cluster', 'inspector'];

const BARE = FORBIDDEN_MODULES.join('|');

/** Specifiers in `import ... from`, `import()`, `require()` and `export ... from`. */
export function importedSpecifiers(source: string): string[] {
  const out: string[] = [];
  const res = [
    /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/gm,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /^\s*import\s+['"]([^'"]+)['"]/gm,
  ];
  for (const re of res) for (const m of source.matchAll(re)) out.push(m[1] as string);
  return out;
}

export function forbiddenIn(source: string): string[] {
  const bad: string[] = [];
  for (const spec of importedSpecifiers(source)) {
    if (new RegExp(`^(?:node:)?(?:${BARE})(?:/.*)?$`).test(spec)) bad.push(`import of ${spec}`);
  }
  if (/(?<![\w.])fetch\s*\(/.test(source)) bad.push('call to fetch()');
  if (/\b(?:XMLHttpRequest|WebSocket|EventSource)\b/.test(source)) bad.push('browser network API');
  if (/\bprocess\.binding\b/.test(source)) bad.push('process.binding');
  return bad;
}
