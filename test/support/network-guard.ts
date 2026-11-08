/** Patches fetch and the network, socket and process modules so any call throws. Shared by the core and NER suites. */
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { FORBIDDEN_MODULES } from './forbidden.js';

const require = createRequire(import.meta.url);

export type Fn = (...args: unknown[]) => unknown;
const restore: Array<() => void> = [];
export const hits: string[] = [];

function trap(label: string): Fn {
  // A plain function, so it also throws when called with `new`.
  return function blocked() {
    hits.push(label);
    throw new Error(`N1: blocked ${label}`);
  };
}

function patchObject(modName: string, obj: Record<string, unknown>, only?: string[]): void {
  for (const key of only ?? Object.keys(obj)) {
    const orig = obj[key];
    if (typeof orig !== 'function' && typeof orig !== 'object') continue;
    if (key === 'constants' || key === 'promises') continue;
    try {
      Object.defineProperty(obj, key, { value: typeof orig === 'function' ? trap(`${modName}.${key}`) : orig, configurable: true, writable: true });
      restore.push(() => Object.defineProperty(obj, key, { value: orig, configurable: true, writable: true }));
    } catch {
      /* read-only export, nothing to patch */
    }
  }
}

export function installPatches(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const origFetch = g.fetch;
  g.fetch = trap('fetch');
  restore.push(() => {
    g.fetch = origFetch;
  });
  const net = require('node:net') as { Socket: { prototype: Record<string, unknown> } };
  const socketProto = net.Socket.prototype;
  for (const name of FORBIDDEN_MODULES) {
    const mod = require(`node:${name}`) as Record<string, unknown>;
    patchObject(name, mod);
    const promises = mod.promises as Record<string, unknown> | undefined;
    if (promises && typeof promises === 'object') patchObject(`${name}.promises`, promises);
  }
  // Classes that are used with `new`, and socket methods reachable without importing net.
  patchObject('net.Socket.prototype', socketProto, ['connect']);
  syncBuiltinESMExports();
}

export function removePatches(): void {
  while (restore.length) (restore.pop() as () => void)();
  syncBuiltinESMExports();
}
