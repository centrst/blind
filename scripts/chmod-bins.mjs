// Marks the two CLI entry points executable after `tsc`. A Node script rather
// than `chmod` so `pnpm build` also runs on Windows, where files have no mode
// bits and npm writes its own shims for bins at install time.
import { chmodSync, statSync } from 'node:fs';

for (const bin of ['dist/cli/blind.js', 'dist/cli/unblind.js']) {
  statSync(bin); // a missing bin is a build failure, so let this throw
  try {
    chmodSync(bin, 0o755);
  } catch {
    // Platforms without mode bits refuse or ignore chmod. Nothing to do there.
  }
}
