/**
 * pnpm version:sync [version]: with no argument, writes src/version.ts from
 * package.json. With a version, the release workflow's gate job sets the package
 * RELEASE_PACKAGE names (the core when unset) to the prerelease version the
 * prepare job allocated.
 */
import { fileURLToPath } from 'node:url';
import { packageDir, setVersion, syncVersion } from './lib/release.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const version = process.argv[2];
if (version === undefined) syncVersion(ROOT);
else setVersion(packageDir(ROOT, process.env.RELEASE_PACKAGE || undefined), version);
