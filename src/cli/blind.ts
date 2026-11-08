#!/usr/bin/env node
import { realIO } from './real-io.js';
import { blindMain } from './run-blind.js';

process.exitCode = await blindMain(process.argv.slice(2), realIO());
