// Loads an ES module graph into a new vm context with only web globals added,
// runs the given function body with the entry bound to `lib`, prints JSON.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const [entry, body] = process.argv.slice(2);
// Web Crypto and the encoding globals every web runtime has (the WinterTC minimum
// common API). Nothing from Node: no require, process, Buffer or built-in modules.
const context = vm.createContext({
  crypto: globalThis.crypto,
  TextEncoder,
  atob,
  btoa,
});

const cache = new Map();
function load(file) {
  let mod = cache.get(file);
  if (!mod) {
    mod = new vm.SourceTextModule(readFileSync(file, 'utf8'), { context, identifier: file });
    cache.set(file, mod);
  }
  return mod;
}

async function link(specifier, referencing) {
  if (!specifier.startsWith('.')) throw new Error(`bare realm cannot load ${specifier}`);
  return load(resolve(dirname(referencing.identifier), specifier));
}

const main = new vm.SourceTextModule(
  `import * as lib from ${JSON.stringify(resolve(entry))};\nglobalThis.__out = JSON.stringify(await (async () => {${body}})());`,
  { context, identifier: resolve(dirname(entry), '__main__.js') },
);
await main.link(async (specifier, referencing) => (specifier === resolve(entry) ? load(specifier) : link(specifier, referencing)));
await main.evaluate();
process.stdout.write(context.__out);
