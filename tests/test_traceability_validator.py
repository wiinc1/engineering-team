import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_traceability.py"


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


class TraceabilityValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_missing_live_traceability_fails(self) -> None:
        result = run_validator(self.repo.root, env=base_env())

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing live traceability artifact", result.stdout)

    def test_matching_live_traceability_passes(self) -> None:
        self.repo.write(
            ".artifacts/live-traceability.json",
            json.dumps(
                {
                    "references": [
                        {
                            "reference": "https://github.com/example/repo/pull/1",
                            "kind": "pull",
                            "exists": True,
                            "state": "open",
                        }
                    ]
                }
            ),
        )

        result = run_validator(self.repo.root, env=base_env())

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  traceability", result.stdout)

    def test_change_kind_must_be_allowed_by_rule(self) -> None:
        self.repo.write(
            ".artifacts/live-traceability.json",
            json.dumps(
                {
                    "references": [
                        {
                            "reference": "https://github.com/example/repo/pull/1",
                            "kind": "pull",
                            "exists": True,
                            "state": "open",
                        }
                    ]
                }
            ),
        )

        result = run_validator(self.repo.root, env={**base_env(), "CHANGE_KIND": "docs-only"})

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not allowed for change_kind", result.stdout)

    def test_ci_github_source_without_token_fails_fast(self) -> None:
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT.replace("live_in_ci: true\n", "source: github\n"))

        result = run_validator(
            self.repo.root,
            env={**base_env(), "GITHUB_ACTIONS": "true"},
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("GITHUB_TOKEN is required in CI", result.stdout)


def base_env() -> dict[str, str]:
    return {
        "GITHUB_EVENT_NAME": "pull_request",
        "CHANGE_REFERENCE": "https://github.com/example/repo/pull/1",
        "CHANGE_KIND": "policy",
    }


CONTRACT_TEXT = """
schema_version: "1.0"
change_management:
  metadata_file: .artifacts/change-metadata.json
  reference_rules:
    - prefix: "https://"
      pattern: "^https://.+$"
      live_in_ci: true
      allowed_change_kinds: [policy, migration]
      allowed_kinds: [pull, issue]
      required_kind: pull
      required_states: [open, merged]
  traceability_sources:
    live_artifact: .artifacts/live-traceability.json
    ci_event_names: [pull_request]
"""


if __name__ == "__main__":
    unittest.main()
