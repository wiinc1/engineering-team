import json
import os
import subprocess
import unittest
from pathlib import Path
from typing import Optional

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_visual_identity.py"


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


class VisualIdentityValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_absent_policy_passes(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(visual_block=""))

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("visual identity not required", result.stdout)

    def test_required_false_and_absent_design_file_passes(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(visual_block="visual_identity:\n  required: false\n"))

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)

    def test_required_true_and_missing_design_file_fails(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text())
        self.repo.write("package.json", package_json())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("required visual identity file is missing", result.stdout)

    def test_required_true_but_not_protected_fails(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(protected=[]))
        self.repo.write("package.json", package_json())
        self.repo.write("DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("directories.protected_paths", result.stdout)

    def test_required_true_but_not_source_of_truth_fails(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(source_of_truth=[]))
        self.repo.write("package.json", package_json())
        self.repo.write("DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("architecture.source_of_truth", result.stdout)

    def test_missing_validator_command_fails(self) -> None:
        visual = visual_identity_block().replace("  validator_command: npm run design:lint\n", "")
        self.repo.write("repo-contract.yaml", contract_text(visual_block=visual))
        self.repo.write("DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("visual_identity.validator_command is required", result.stdout)

    def test_missing_npm_script_fails(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text())
        self.repo.write("package.json", package_json(script=False))
        self.repo.write("DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing npm script", result.stdout)

    def test_stale_last_reviewed_hard_fails(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(last_reviewed="2000-01-01", cadence_days=1))
        self.repo.write("package.json", package_json())
        self.repo.write("DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("review is stale", result.stdout)

    def test_committed_generated_outputs_require_drift_check_command(self) -> None:
        generated = """
  generated_outputs:
    strategy: committed
    paths:
      - src/styles/design-tokens.css
"""
        self.repo.write("repo-contract.yaml", contract_text(extra_visual=generated))
        self.repo.write("package.json", package_json())
        self.repo.write("DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("drift_check_command", result.stdout)

    def test_declared_non_root_file_is_respected(self) -> None:
        visual = visual_identity_block(file="docs/brand/DESIGN.md", command="scripts/design-lint.sh")
        self.repo.write(
            "repo-contract.yaml",
            contract_text(
                visual_block=visual,
                protected=["docs/brand/DESIGN.md"],
                source_of_truth=["docs/brand/DESIGN.md"],
            ),
        )
        self.repo.write("docs/brand/DESIGN.md", design_md())

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0, result.stdout)

    def test_unrelated_subdirectory_design_file_is_ignored_when_not_required(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(visual_block="visual_identity:\n  required: false\n"))
        self.repo.write("generated/DESIGN.md", "fixture\n")

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)

    def test_material_change_without_visual_reviewer_approval_fails_in_ci(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text())
        self.repo.write("package.json", package_json())
        self.repo.write("DESIGN.md", design_md())
        self.repo.commit_all("baseline")
        self.repo.write("DESIGN.md", design_md(accessibility="- Focus states must be visible.\n- New material rule.\n"))

        result = run_validator(self.repo.root, env=ci_env())

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing live approval artifact", result.stdout)

    def test_material_change_with_visual_reviewer_approval_passes_in_ci(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text())
        self.repo.write("package.json", package_json())
        self.repo.write("DESIGN.md", design_md())
        self.repo.commit_all("baseline")
        self.repo.write("DESIGN.md", design_md(accessibility="- Focus states must be visible.\n- New material rule.\n"))
        self.repo.write(
            ".artifacts/live-approval.json",
            json.dumps(
                {
                    "head_sha": "abc123",
                    "reviews": [
                        {
                            "user": "designer",
                            "state": "APPROVED",
                            "submitted_at": "2099-01-01T00:00:00Z",
                            "commit_id": "abc123",
                        }
                    ],
                }
            ),
        )

        result = run_validator(self.repo.root, env=ci_env())

        self.assertEqual(result.returncode, 0, result.stdout)


def ci_env() -> dict[str, str]:
    return {
        "GITHUB_EVENT_NAME": "pull_request",
        "GITHUB_SHA": "abc123",
    }


def package_json(script: bool = True) -> str:
    scripts = {"design:lint": "design.md lint DESIGN.md"} if script else {}
    return json.dumps({"scripts": scripts})


def contract_text(
    visual_block: Optional[str] = None,
    protected: Optional[list[str]] = None,
    source_of_truth: Optional[list[str]] = None,
    last_reviewed: str = "2099-01-01",
    cadence_days: int = 90,
    extra_visual: str = "",
) -> str:
    protected = ["DESIGN.md"] if protected is None else protected
    source_of_truth = ["DESIGN.md"] if source_of_truth is None else source_of_truth
    visual = visual_block
    if visual is None:
        visual = visual_identity_block(last_reviewed=last_reviewed, cadence_days=cadence_days, extra=extra_visual)
    return f"""
schema_version: "1.0"
ownership:
  primary_owner: owner
directories:
  protected_paths: {json.dumps(protected)}
architecture:
  source_of_truth: {json.dumps(source_of_truth)}
change_management:
  approval_sources:
    mode: artifact
    live_artifact: .artifacts/live-approval.json
    require_live_in_ci: true
    ci_event_names: [pull_request]
    required_review_state: APPROVED
{visual}"""


def visual_identity_block(
    file: str = "DESIGN.md",
    command: str = "npm run design:lint",
    last_reviewed: str = "2099-01-01",
    cadence_days: int = 90,
    extra: str = "",
) -> str:
    return f"""visual_identity:
  required: true
  file: {file}
  validator_command: {command}
  owner: design-owner
  reviewers:
    - designer
  review:
    cadence_days: {cadence_days}
    last_reviewed: "{last_reviewed}"
{extra}"""


def design_md(accessibility: str = "- Focus states must be visible.\n") -> str:
    return f"""---
version: alpha
name: Test
colors:
  primary: "#2563EB"
typography:
  body-md:
    fontFamily: system-ui
    fontSize: 1rem
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0rem
---

## Overview

Test identity.

## Accessibility

{accessibility}"""


if __name__ == "__main__":
    unittest.main()
