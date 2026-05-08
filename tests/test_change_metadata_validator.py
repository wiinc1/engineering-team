import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_change_metadata.py"


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


class ChangeMetadataValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)
        self.repo.write("agent-policy.yaml", AGENT_POLICY_TEXT)

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_valid_low_risk_change_passes(self) -> None:
        self.repo.write("docs/readme.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("docs/readme.md", "new\n")

        result = run_validator(self.repo.root, env=base_env())

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  change-metadata", result.stdout)

    def test_protected_path_requires_stricter_review_and_instruction(self) -> None:
        self.repo.commit_all("baseline")
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT + "\n")

        env = base_env() | {
            "CHANGE_RISK": "medium",
            "CHANGE_REVIEW_MODE": "human-approve",
            "CHANGE_HUMAN_INSTRUCTION": "false",
        }
        result = run_validator(self.repo.root, env=env)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("below required 'human-plus-evidence'", result.stdout)
        self.assertIn("below required 'high'", result.stdout)
        self.assertIn("explicit human instruction", result.stdout)

    def test_agent_provenance_requires_evidence(self) -> None:
        self.repo.write("docs/readme.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("docs/readme.md", "new\n")

        env = base_env() | {
            "CHANGE_PROVENANCE": "agent",
            "CHANGE_COMMANDS": "",
            "CHANGE_EVIDENCE": "",
        }
        result = run_validator(self.repo.root, env=env)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires non-empty 'commands'", result.stdout)
        self.assertIn("requires non-empty 'evidence'", result.stdout)

    def test_metadata_file_takes_precedence(self) -> None:
        self.repo.write("docs/readme.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("docs/readme.md", "new\n")
        self.repo.write(
            ".artifacts/change-metadata.json",
            json.dumps(
                {
                    "change_kind": "docs-only",
                    "risk": "low",
                    "reversibility": "reversible",
                    "reference": "LOCAL-VERIFY",
                    "review_mode": "automated-only",
                    "provenance": "human",
                    "human_instruction": False,
                    "commands": [],
                    "evidence": [],
                }
            ),
        )

        env = base_env() | {"CHANGE_RISK": "critical"}
        result = run_validator(self.repo.root, env=env)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  change-metadata", result.stdout)

    def test_invalid_reference_fails(self) -> None:
        self.repo.write("docs/readme.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("docs/readme.md", "new\n")

        env = base_env() | {"CHANGE_REFERENCE": "BADREF"}
        result = run_validator(self.repo.root, env=env)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match any allowed reference rule", result.stdout)

    def test_policy_change_requires_allowed_reference_prefix(self) -> None:
        self.repo.write("docs/readme.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("docs/readme.md", "new\n")

        env = base_env() | {"CHANGE_KIND": "policy", "CHANGE_REFERENCE": "LOCAL-VERIFY"}
        result = run_validator(self.repo.root, env=env)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires reference prefix", result.stdout)


def base_env() -> dict[str, str]:
    return {
        "CHANGE_KIND": "docs-only",
        "CHANGE_RISK": "low",
        "CHANGE_REVERSIBILITY": "reversible",
        "CHANGE_REFERENCE": "LOCAL-VERIFY",
        "CHANGE_REVIEW_MODE": "automated-only",
        "CHANGE_PROVENANCE": "human",
        "CHANGE_HUMAN_INSTRUCTION": "false",
        "CHANGE_COMMANDS": "make verify",
        "CHANGE_EVIDENCE": "local-verify",
    }


CONTRACT_TEXT = """
schema_version: "1.0"
change_management:
  metadata_file: .artifacts/change-metadata.json
  allowed_change_kinds:
    - docs-only
    - refactor
    - policy
  required_fields:
    - change_kind
    - risk
    - reversibility
    - reference
    - review_mode
    - provenance
    - human_instruction
  required_when_paths:
    - "**"
  reference_rules:
    - prefix: ADR-
      pattern: "^ADR-[0-9]+$"
    - prefix: LOCAL-
      pattern: "^LOCAL-[A-Z-]+$"
  change_kind_rules:
    - change_kind: docs-only
      allowed_reference_prefixes:
        - LOCAL-
    - change_kind: policy
      allowed_reference_prefixes:
        - ADR-
  stricter_review_rules:
    - when_paths:
        - repo-contract.yaml
      minimum_review_mode: human-plus-evidence
      minimum_risk: high
      require_human_instruction: true
  provenance_rules:
    - provenance: agent
      require_evidence:
        - commands
        - evidence
"""


AGENT_POLICY_TEXT = """
schema_version: "1.0"
standards_version: "0.1.0"
editable_paths:
  - docs/
protected_paths:
  - repo-contract.yaml
explicit_instruction_paths:
  - repo-contract.yaml
forbidden_tasks: []
allowed_to_automate: []
unsafe_for_agents: []
capabilities:
  low: []
  medium: []
  high: []
  critical: []
ai_safe_change:
  max_files: 10
  max_lines: 400
  forbidden_paths:
    - repo-contract.yaml
  required_commands: []
  required_evidence: []
"""


if __name__ == "__main__":
    unittest.main()
