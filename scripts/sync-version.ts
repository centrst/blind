/**
 * pnpm version:sync [version]: with no argument, writes src/version.ts from
 * package.json. With a version, the release workflow's gate job sets both files to
 * the prerelease version the prepare job allocated.
 */
import { fileURLToPath } from 'node:url';
import { setVersion, syncVersion } from './lib/release.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const version = process.argv[2];
if (version === undefined) syncVersion(ROOT);
else setVersion(ROOT, version);
