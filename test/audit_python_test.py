"""Offline failure-path tests for the Python dependency gate."""

import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('audit_python', Path(__file__).resolve().parents[1] / 'scripts/audit-python.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class PythonAuditTest(unittest.TestCase):
    def audit_text(self, text, result):
        with tempfile.TemporaryDirectory() as scratch:
            manifest = Path(scratch) / 'requirements.txt'
            manifest.write_text(text)
            with patch.object(audit.subprocess, 'run', return_value=result) as run:
                audit.audit_file(manifest)
                return run

    def result(self, dependencies, code=0):
        return subprocess.CompletedProcess([], code, json.dumps({'dependencies': dependencies}), 'audit error' if code else '')

    def test_patched_pins_are_audited_and_only_reviewed_model_urls_are_excluded(self):
        model = sorted(audit.MODEL_WHEELS)[0]
        run = self.audit_text('cryptography==50.0.2\n' + model, self.result([
            {'name': 'cryptography', 'version': '50.0.2', 'vulns': []},
        ]))
        self.assertIn('--strict', run.call_args.args[0])
        self.assertIn('--disable-pip', run.call_args.args[0])

    def test_a_vulnerability_or_audit_service_error_fails(self):
        for code in [1, 2]:
            with self.subTest(code=code), self.assertRaises(RuntimeError):
                self.audit_text('cryptography==48.0.1', self.result([], code))

    def test_skipped_missing_and_vulnerable_results_cannot_report_success(self):
        cases = [[], [{'name': 'example-package', 'skip_reason': 'not found'}],
                 [{'name': 'example-package', 'version': '1.0', 'vulns': [{'id': 'example'}]}]]
        for dependencies in cases:
            with self.subTest(dependencies=dependencies), self.assertRaises(RuntimeError):
                self.audit_text('example-package==1.0', self.result(dependencies))

    def test_unpinned_requirements_and_changed_model_hashes_fail_before_audit(self):
        model = sorted(audit.MODEL_WHEELS)[0]
        for text in ['cryptography>=50', 'cryptography==50.*', '-r other.txt', model[:-1] + '0']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                self.audit_text(text, self.result([]))

    def test_new_untracked_manifests_are_discovered_and_ignored_scratch_is_not(self):
        with tempfile.TemporaryDirectory() as scratch:
            root = Path(scratch).resolve()
            subprocess.run(['git', 'init', '-q', '--initial-branch=fixture', scratch], check=True)
            (root / '.gitignore').write_text('.local/\n')
            tracked = root / 'requirements.txt'
            tracked.write_text('example-package==1.0\n')
            subprocess.run(['git', 'add', '.gitignore', 'requirements.txt'], cwd=root, check=True)
            nested = root / 'new-package'
            nested.mkdir()
            added = nested / 'requirements-dev.txt'
            added.write_text('example-package==2.0\n')
            (root / '.local').mkdir()
            (root / '.local/requirements.txt').write_text('ignored==1.0\n')
            with patch.object(audit, '__file__', str(root / 'scripts/audit-python.py')), patch.object(audit, 'audit_file') as run:
                self.assertEqual(audit.main(), 0)
                self.assertEqual({call.args[0] for call in run.call_args_list}, {tracked, added})


if __name__ == '__main__':
    unittest.main()
