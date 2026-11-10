#!/usr/bin/env node
/**
 * blind-ner-download <directory>: fetches the default model into the directory.
 * This command is the only part of the package that uses the network.
 */
import { download } from '../download.js';

const args = process.argv.slice(2);
const target = args[0];
if (args.length !== 1 || target === undefined || target.startsWith('-')) {
  console.error(
    'Usage: blind-ner-download <directory>\n\n' +
      'Fetches gliner_multi-v2.1 (about 1.1 GB) into the directory, checks every file against its\n' +
      'pinned SHA-256, and writes LICENSE and PROVENANCE.md beside the weights. A second run keeps\n' +
      'the files that are already there and correct. Pass the same directory to GlinerModel.load.',
  );
  process.exitCode = 2;
} else {
  try {
    await download(fetch, target, undefined, (line) => console.log(line));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
