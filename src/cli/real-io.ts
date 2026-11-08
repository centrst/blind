import { homedir } from 'node:os';
import type { IO } from './io.js';

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  return Buffer.concat(chunks).toString('utf8');
}

export function realIO(): IO {
  return {
    readStdin: () => readAll(process.stdin),
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
    env: process.env,
    homedir: homedir(),
    stdinIsTty: Boolean(process.stdin.isTTY),
    uid: process.getuid?.(),
  };
}
