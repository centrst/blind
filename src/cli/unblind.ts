#!/usr/bin/env node
import { realIO } from './real-io.js';
import { unblindMain } from './run-unblind.js';

process.exitCode = await unblindMain(process.argv.slice(2), realIO());
