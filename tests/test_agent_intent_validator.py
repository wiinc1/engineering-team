import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_agent_intent.py"


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


class AgentIntentValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)
        self.repo.write("agent-policy.yaml", AGENT_POLICY_TEXT)
        self.repo.commit_all("baseline")

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_agent_only_policy_change_fails(self) -> None:
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT + "\n")

        result = run_validator(self.repo.root, env={"CHANGE_KIND": "policy", "CHANGE_PROVENANCE": "agent"})

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires human-in-the-loop", result.stdout)

    def test_human_assisted_policy_change_passes(self) -> None:
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT + "\n")

        result = run_validator(
            self.repo.root,
            env={
                "CHANGE_KIND": "policy",
                "CHANGE_PROVENANCE": "human-assisted-agent",
                "CHANGE_REVIEW_MODE": "human-plus-evidence",
            },
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  agent-intent", result.stdout)

    def test_policy_change_with_weak_review_mode_fails(self) -> None:
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT + "\n")

        result = run_validator(
            self.repo.root,
            env={
                "CHANGE_KIND": "policy",
                "CHANGE_PROVENANCE": "human-assisted-agent",
                "CHANGE_REVIEW_MODE": "human-approve",
            },
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires review_mode 'human-plus-evidence'", result.stdout)


CONTRACT_TEXT = """
schema_version: "1.0"
change_management:
  metadata_file: .artifacts/change-metadata.json
"""


AGENT_POLICY_TEXT = """
schema_version: "1.0"
standards_version: "0.1.0"
editable_paths: [tests/]
protected_paths: [repo-contract.yaml]
explicit_instruction_paths: [repo-contract.yaml]
forbidden_tasks: [release-to-production]
allowed_to_automate:
  - task: policy-maintenance
    mode: human-in-the-loop
unsafe_for_agents: [release-authority-change]
never_automated_change_kinds: [release]
path_task_map:
  - task: policy-maintenance
    when_paths: [repo-contract.yaml]
change_kind_task_map:
  policy: [policy-maintenance]
review_mode_requirements_by_task:
  policy-maintenance: human-plus-evidence
capabilities:
  low: [read]
  medium: []
  high: []
  critical: []
ai_safe_change:
  max_files: 10
  max_lines: 100
  forbidden_paths: []
  required_commands: []
  required_evidence: []
"""


if __name__ == "__main__":
    unittest.main()
