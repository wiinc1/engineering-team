import json
import os
import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_artifact_provenance.py"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
        env=isolated_env(),
    )


def isolated_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("GITHUB_ACTIONS", "GITHUB_TOKEN", "GITHUB_EVENT_NAME", "GITHUB_SHA", "GITHUB_HEAD_SHA"):
        env.pop(key, None)
    return env


class ArtifactProvenanceValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)
        self.repo.commit_all("baseline")

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_missing_required_artifact_fails(self) -> None:
        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required artifact", result.stdout)

    def test_valid_artifact_passes(self) -> None:
        head = self.repo.run_git("rev-parse", "HEAD").strip()
        self.repo.write(
            ".artifacts/test-results.json",
            json.dumps(
                {
                    "schema_version": "1.0",
                    "generated_by": "run_python_tests.py",
                    "generated_at": "2099-01-01T00:00:00Z",
                    "commit_sha": head,
                }
            ),
        )

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  artifact-provenance", result.stdout)

    def test_expected_generator_is_enforced(self) -> None:
        head = self.repo.run_git("rev-parse", "HEAD").strip()
        self.repo.write(
            ".artifacts/test-results.json",
            json.dumps(
                {
                    "schema_version": "1.0",
                    "generated_by": "wrong",
                    "generated_at": "2099-01-01T00:00:00Z",
                    "commit_sha": head,
                }
            ),
        )

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match expected 'run_python_tests.py'", result.stdout)

    def test_required_in_ci_artifact_is_ignored_locally(self) -> None:
        self.repo.write("repo-contract.yaml", CI_REQUIRED_CONTRACT_TEXT)

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)


CONTRACT_TEXT = """
schema_version: "1.0"
artifact_provenance:
  schema_version: "1.0"
  required_fields: [schema_version, generated_by, generated_at, commit_sha]
  artifacts:
    - path: .artifacts/test-results.json
      require_current_commit: true
      expected_generator: run_python_tests.py
"""


CI_REQUIRED_CONTRACT_TEXT = """
schema_version: "1.0"
artifact_provenance:
  schema_version: "1.0"
  required_fields: [schema_version, generated_by, generated_at, commit_sha]
  artifacts:
    - path: .artifacts/audit-bundle.json
      required_in_ci: true
      expected_generator: generate_audit_bundle.py
"""


if __name__ == "__main__":
    unittest.main()
