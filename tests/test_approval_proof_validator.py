import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_approval_proof.py"


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


class ApprovalProofValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", contract_text())

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_protected_policy_change_without_approval_fails(self) -> None:
        self.repo.commit_all("baseline")
        self.repo.write("repo-contract.yaml", contract_text() + "\n")

        result = run_validator(self.repo.root, env=base_env())

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no approval record covers", result.stdout)

    def test_matching_approval_passes(self) -> None:
        self.repo.commit_all("baseline")
        self.repo.write("repo-contract.yaml", contract_text() + "\n")
        self.repo.write(
            ".artifacts/approval-record.json",
            json.dumps(
                {
                    "approvals": [
                        {
                            "reference": "ADR-1",
                            "change_kind": "policy",
                            "approver": "owner",
                            "approved_at": "2099-01-01T00:00:00Z",
                            "scope_paths": ["repo-contract.yaml"],
                        }
                    ]
                }
            ),
        )

        result = run_validator(self.repo.root, env=base_env())

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  approval-proof", result.stdout)


def base_env() -> dict[str, str]:
    return {"CHANGE_KIND": "policy", "CHANGE_REFERENCE": "ADR-1"}


def contract_text() -> str:
    return """
schema_version: "1.0"
change_management:
  metadata_file: .artifacts/change-metadata.json
  approval_file: .artifacts/approval-record.json
  approval_rules:
    - when_paths:
        - repo-contract.yaml
      change_kinds:
        - policy
      require_fields:
        - approver
        - approved_at
        - scope_paths
        - reference
"""


if __name__ == "__main__":
    unittest.main()
