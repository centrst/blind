import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

// Scan the index as well as files on disk: a staged secret may already have
// been removed from the working copy. Never scan ignored local data.
const root = realpathSync(process.cwd());
let scratch;
try {
  const version = execFileSync('gitleaks', ['version'], { encoding: 'utf8' }).trim();
  if (version !== '8.30.1') throw new Error('Gitleaks 8.30.1 is required; see CONTRIBUTING.md.');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const files = git('ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0').filter(Boolean);
  mkdirSync(join(root, '.local'), { recursive: true });
  scratch = mkdtempSync(join(root, '.local', 'secrets-'));
  const working = join(scratch, 'working');
  const index = join(scratch, 'index');
  mkdirSync(working);
  mkdirSync(index);
  const ignore = join(scratch, 'empty-ignore');
  writeFileSync(ignore, '');
  for (const file of new Set(files)) {
    const source = join(root, file);
    const stat = lstatSync(source, { throwIfNoEntry: false });
    if (!stat) continue; // Deleted files are still covered by index and history.
    if (!stat.isFile() || !realpathSync(source).startsWith(root + sep)) {
      throw new Error('Secret scanning requires regular files within the repository.');
    }
    const target = join(working, file);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  // Reject index symlinks and submodules, which checkout-index cannot scan safely.
  if (git('ls-files', '--stage').split('\n').some((line) => /^(120000|160000) /.test(line))) {
    throw new Error('Secret scanning does not accept staged symlinks or submodules.');
  }
  git('checkout-index', '--all', `--prefix=${index}/`);
  const flags = ['--config', join(root, '.gitleaks.toml'), '--redact', '--no-banner', '--ignore-gitleaks-allow', '--gitleaks-ignore-path', ignore];
  const scan = (...args) => execFileSync('gitleaks', [...args, ...flags], { cwd: root, stdio: 'inherit' });
  scan('dir', working);
  scan('dir', index);
  // An unborn repository has no history yet. Files and index still run above.
  if (git('rev-list', '--all', '--count').trim() !== '0') scan('git', '.', '--log-opts=--all');
} catch (error) {
  // Scanner output is redacted. Do not echo subprocess buffers or file contents.
  console.error(error.code === 'ENOENT' ? 'Install Gitleaks 8.30.1; see CONTRIBUTING.md.' : 'Secret scan failed. Resolve the finding or tool error before committing.');
  process.exitCode = 1;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
