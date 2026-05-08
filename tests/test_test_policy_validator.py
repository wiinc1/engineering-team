import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_test_policy.py"


def run_validator(repo_root: Path, env: Optional[dict[str, str]] = None) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
        env=merged_env,
    )


class TestPolicyValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_hermetic_unit_test_violation_fails(self) -> None:
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert True\n")
        self.write_artifacts()
        self.repo.commit_all("baseline")
        self.repo.write("tests/test_example.py", "import requests\n\ndef test_ok():\n    requests.get('https://x')\n")
        self.write_artifacts()

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden unit-test reference requests.get", result.stdout)

    def test_bugfix_without_test_delta_fails(self) -> None:
        self.repo.write("dev-standards/tooling/example.py", "def value():\n    return 1\n")
        self.write_artifacts()
        self.repo.commit_all("baseline")
        self.repo.write("dev-standards/tooling/example.py", "def value():\n    return 2\n")
        self.write_artifacts()

        result = run_validator(self.repo.root, env={"CHANGE_KIND": "bugfix"})

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires at least one changed regression test", result.stdout)

    def test_changed_line_coverage_failure_is_reported(self) -> None:
        self.repo.write("tests/test_example.py", "def test_value():\n    assert True\n")
        self.write_artifacts()
        self.repo.commit_all("baseline")
        self.repo.write("tests/test_example.py", "def test_value():\n    assert False\n")
        self.write_artifacts(executed_lines=[1], missing_lines=[2])

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("changed-line coverage", result.stdout)

    def test_compliant_change_passes(self) -> None:
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert True\n")
        self.write_artifacts()
        self.repo.commit_all("baseline")
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert 1 == 1\n")
        self.write_artifacts(executed_lines=[1, 2], missing_lines=[])

        result = run_validator(self.repo.root, env={"CHANGE_KIND": "bugfix"})

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  test-policy", result.stdout)

    def test_contract_requirement_fails_without_contract_report(self) -> None:
        self.repo.write("pam-stack/config/example.yml", "old\n")
        self.write_artifacts(include_contract=False)
        self.repo.commit_all("baseline")
        self.repo.write("pam-stack/config/example.yml", "new\n")
        self.write_artifacts(include_contract=False)

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required test layer 'contract'", result.stdout)

    def test_quarantined_flake_requires_waiver(self) -> None:
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert True\n")
        self.write_artifacts(quarantined=["tests.test_example.TestCase.test_ok"])
        self.repo.commit_all("baseline")
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert 1 == 1\n")
        self.write_artifacts(quarantined=["tests.test_example.TestCase.test_ok"])

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("flaky registry contains 1 quarantined tests", result.stdout)

    def test_stale_quarantine_fails(self) -> None:
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert True\n")
        self.write_artifacts(
            quarantined=[
                {
                    "id": "tests.test_example.TestCase.test_ok",
                    "owner": "owner",
                    "reference": "LOCAL-1",
                    "quarantined_at": "2000-01-01",
                }
            ]
        )
        self.repo.commit_all("baseline")
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert 1 == 1\n")
        self.write_artifacts(
            quarantined=[
                {
                    "id": "tests.test_example.TestCase.test_ok",
                    "owner": "owner",
                    "reference": "LOCAL-1",
                    "quarantined_at": "2000-01-01",
                }
            ]
        )

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exceeds max age 30 days", result.stdout)

    def test_sensitive_change_requires_runtime_test_artifacts(self) -> None:
        self.repo.write("pam-stack/config/example.yml", "old\n")
        self.write_artifacts(include_contract=True)
        self.repo.commit_all("baseline")
        self.repo.write("pam-stack/config/example.yml", "new\n")
        self.write_artifacts(include_contract=True)

        result = run_validator(self.repo.root, env={"CHANGE_KIND": "security-fix"})

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("integration evidence is required", result.stdout)

    def write_artifacts(
        self,
        executed_lines: Optional[list[int]] = None,
        missing_lines: Optional[list[int]] = None,
        include_contract: bool = True,
        quarantined: Optional[list[object]] = None,
        include_runtime: bool = False,
    ) -> None:
        coverage_payload = {
            "files": {
                "tests/test_example.py": {
                    "executed_lines": executed_lines or [1, 2],
                    "missing_lines": missing_lines or [],
                }
            },
            "totals": {"percent_covered": 100.0},
        }
        self.repo.write(".artifacts/test-results.json", json.dumps({"tests_run": 1, "successful": True}))
        self.repo.write(".artifacts/coverage-summary.json", json.dumps(coverage_payload))
        self.repo.write(".artifacts/flaky-test-registry.json", json.dumps({"quarantined": quarantined or []}))
        if include_contract:
            self.repo.write(".artifacts/contract-test-report.json", json.dumps({"tests_run": 1, "successful": True}))
        if include_runtime:
            success_payload = json.dumps({"successful": True})
            self.repo.write(".artifacts/integration-test-report.json", success_payload)
            self.repo.write(".artifacts/system-test-report.json", success_payload)
            self.repo.write(".artifacts/ephemeral-environment.json", success_payload)


CONTRACT_TEXT = """
schema_version: "1.0"
testing:
  artifacts:
    test_results: .artifacts/test-results.json
    coverage: .artifacts/coverage-summary.json
    flaky_registry: .artifacts/flaky-test-registry.json
    contract_report: .artifacts/contract-test-report.json
  layers:
    unit:
      paths:
        - tests/**/*.py
      file_patterns:
        - test_*.py
    contract:
      paths:
        - tests/contract/**/*.py
      file_patterns:
        - test_*.py
  hermeticity:
    unit:
      paths:
        - tests/**/*.py
      forbidden_references:
        - requests.get
        - subprocess.run
      allow_in_paths: []
  coverage:
    global_floor: 0.8
    changed_lines_floor: 0.8
    governed_paths:
      - tests/**/*.py
  regression_requirements:
    change_kinds:
      - bugfix
      - security-fix
    test_paths:
      - tests/**/*.py
  layer_requirements:
    - when_paths:
        - pam-stack/config/**
      required_layers:
        - contract
  contract_requirements:
    - when_paths:
        - pam-stack/config/**
      required_evidence:
        - contract-test-report
  flaky_quarantine:
    waiver_rule: test-policy:flaky-quarantine
    allow_quarantine_with_valid_waiver: true
  integration_requirements:
    - when_paths:
        - pam-stack/config/**
      change_kinds:
        - security-fix
      artifact: .artifacts/integration-test-report.json
  system_requirements:
    - when_paths:
        - pam-stack/config/**
      change_kinds:
        - security-fix
      artifact: .artifacts/system-test-report.json
  ephemeral_environment_requirements:
    - when_paths:
        - pam-stack/config/**
      change_kinds:
        - security-fix
      artifact: .artifacts/ephemeral-environment.json
  quarantine_policy:
    max_age_days: 30
    require_owner: false
    require_reference: false
"""


if __name__ == "__main__":
    unittest.main()
