import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_live_approval.py"


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


class LiveApprovalValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)
        self.repo.commit_all("baseline")
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT + "\n")

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_ci_protected_change_without_live_artifact_fails(self) -> None:
        result = run_validator(self.repo.root, env=base_env("abc123"))

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing live approval artifact", result.stdout)

    def test_matching_live_approval_passes(self) -> None:
        self.repo.write(
            ".artifacts/live-approval.json",
            json.dumps(
                {
                    "head_sha": "abc123",
                    "reviews": [
                        {
                            "user": "wiinc1",
                            "state": "APPROVED",
                            "submitted_at": "2099-01-01T00:00:00Z",
                            "commit_id": "abc123",
                        }
                    ],
                }
            ),
        )

        result = run_validator(self.repo.root, env=base_env("abc123"))

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  live-approval", result.stdout)

    def test_github_head_sha_overrides_pull_request_merge_sha(self) -> None:
        self.repo.write(
            ".artifacts/live-approval.json",
            json.dumps(
                {
                    "head_sha": "abc123",
                    "reviews": [
                        {
                            "user": "wiinc1",
                            "state": "APPROVED",
                            "submitted_at": "2099-01-01T00:00:00Z",
                            "commit_id": "abc123",
                        }
                    ],
                }
            ),
        )

        result = run_validator(
            self.repo.root,
            env={**base_env("synthetic-merge-sha"), "GITHUB_HEAD_SHA": "abc123"},
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  live-approval", result.stdout)

    def test_ci_github_mode_without_token_fails_fast(self) -> None:
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT.replace("mode: artifact", "mode: github"))

        result = run_validator(
            self.repo.root,
            env={**base_env("abc123"), "GITHUB_ACTIONS": "true"},
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("GITHUB_TOKEN is required in CI", result.stdout)


def base_env(head_sha: str) -> dict[str, str]:
    return {
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_SHA": head_sha,
        "CHANGE_KIND": "policy",
        "CHANGE_REFERENCE": "https://github.com/example/repo/pull/1",
    }


CONTRACT_TEXT = """
schema_version: "1.0"
ownership:
  primary_owner: wiinc1
change_management:
  metadata_file: .artifacts/change-metadata.json
  approval_rules:
    - when_paths: [repo-contract.yaml]
      change_kinds: [policy]
      require_fields: [approver, approved_at, scope_paths, reference]
  approval_sources:
    mode: artifact
    local_artifact: .artifacts/approval-record.json
    live_artifact: .artifacts/live-approval.json
    require_live_in_ci: true
    ci_event_names: [pull_request]
    required_review_state: APPROVED
    required_approvers: [wiinc1]
    require_current_head_sha: true
"""


if __name__ == "__main__":
    unittest.main()
