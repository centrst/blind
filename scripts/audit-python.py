"""Audit every tracked or unignored Python requirements file without installing models.

The manifests are complete, frozen environments, so pip-audit checks every named
version with --no-deps. The two reviewed spaCy model wheels are outside PyPI's
advisory database; only their exact, hash-pinned URLs are exempt from lookup.
All other unpinned, unsupported or unauditable dependencies fail the gate.
"""

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile

MODEL_WHEELS = {
    'en_core_web_lg @ https://github.com/explosion/spacy-models/releases/download/en_core_web_lg-3.8.0/en_core_web_lg-3.8.0-py3-none-any.whl#sha256=293e9547a655b25499198ab15a525b05b9407a75f10255e405e8c3854329ab63',
    'es_core_news_lg @ https://github.com/explosion/spacy-models/releases/download/es_core_news_lg-3.8.0/es_core_news_lg-3.8.0-py3-none-any.whl#sha256=7c6c212715a12f31aacde3361754436945ff7376fb24cde57d0c277c9c9b050b',
}
PIN = re.compile(r'([A-Za-z0-9][A-Za-z0-9_.-]*)==([A-Za-z0-9][A-Za-z0-9.!+_-]*)')


def normalized(name: str) -> str:
    return re.sub(r'[-_.]+', '-', name).lower()


def audit_file(path: Path) -> None:
    pins = []
    expected = set()
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        if line in MODEL_WHEELS:
            print(f'  Model wheel excluded from advisory lookup: {line.split()[0]} (reviewed SHA-256 pin)')
            continue
        match = PIN.fullmatch(line)
        if not match:
            raise ValueError(f'line {number}: require an exact package==version pin or a reviewed model wheel')
        expected.add((normalized(match[1]), match[2]))
        pins.append(line)
    if not pins:
        raise ValueError('no auditable package pins')
    with tempfile.TemporaryDirectory(prefix='blind-python-audit-') as scratch:
        requirements = Path(scratch) / 'requirements.txt'
        requirements.write_text('\n'.join(pins) + '\n')
        result = subprocess.run(
            [sys.executable, '-m', 'pip_audit', '--strict', '--no-deps', '--disable-pip',
             '--progress-spinner', 'off', '--desc', 'off', '--format', 'json', '-r', str(requirements)],
            capture_output=True, text=True, timeout=300,
        )
    if result.returncode:
        raise RuntimeError(result.stderr.strip() + '\n' + result.stdout.strip())
    dependencies = json.loads(result.stdout)['dependencies']
    if any(d.get('skip_reason') or d.get('vulns') for d in dependencies):
        raise RuntimeError('audit reported skipped or vulnerable dependencies: ' + result.stdout)
    actual = {(normalized(d['name']), d['version']) for d in dependencies}
    if actual != expected:
        raise RuntimeError('audit results do not cover every declared package version')
    print(f'  PASS: {len(actual)} package versions, no known vulnerabilities')


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    files = subprocess.check_output(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*requirements*.txt'],
        cwd=root,
    ).decode().split('\0')
    manifests = sorted(set(f for f in files if f and (root / f).exists()))
    if not manifests:
        raise ValueError('no Python requirements files found')
    for name in manifests:
        print(f'Auditing {name}', flush=True)
        audit_file(root / name)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, RuntimeError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f'Python dependency audit failed: {error}', file=sys.stderr)
        sys.exit(1)
