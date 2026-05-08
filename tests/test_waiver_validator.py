import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_waivers.py"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
    )


class WaiverValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_expired_waiver_fails(self) -> None:
        self.repo.write("docs/runbook.md", "runbook\n")
        self.repo.write("repo-contract.yaml", contract_with_waivers("""
waivers:
  - rule: docs-freshness:runbook
    path: docs/runbook.md
    owner: owner
    created_at: "2024-01-01"
    expires_at: "2024-01-02"
    mitigation: temp
    reference: ISSUE-1
"""))

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("expired on 2024-01-02", result.stdout)

    def test_missing_path_fails(self) -> None:
        self.repo.write("repo-contract.yaml", contract_with_waivers("""
waivers:
  - rule: docs-freshness:runbook
    path: docs/missing.md
    owner: owner
    created_at: "2099-01-01"
    expires_at: "2099-01-02"
    mitigation: temp
    reference: ISSUE-1
"""))

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not match any existing path", result.stdout)

    def test_repeated_active_waiver_fails(self) -> None:
        self.repo.write("docs/runbook.md", "runbook\n")
        self.repo.write("repo-contract.yaml", contract_with_waivers("""
waivers:
  - rule: docs-freshness:runbook
    path: docs/runbook.md
    owner: owner
    created_at: "2099-01-01"
    expires_at: "2099-01-02"
    mitigation: temp
    reference: ISSUE-1
  - rule: docs-freshness:runbook
    path: docs/runbook.md
    owner: owner
    created_at: "2099-01-01"
    expires_at: "2099-01-03"
    mitigation: temp
    reference: ISSUE-2
"""))

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("exceeds max active count", result.stdout)

    def test_valid_waiver_passes(self) -> None:
        self.repo.write("docs/runbook.md", "runbook\n")
        self.repo.write("repo-contract.yaml", contract_with_waivers("""
waivers:
  - rule: docs-freshness:runbook
    path: docs/runbook.md
    owner: owner
    created_at: "2099-01-01"
    expires_at: "2099-01-02"
    mitigation: temp
    reference: ISSUE-1
"""))

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  waivers", result.stdout)

    def test_undefined_rule_fails(self) -> None:
        self.repo.write("docs/runbook.md", "runbook\n")
        self.repo.write("repo-contract.yaml", contract_with_waivers("""
waivers:
  - rule: not-real
    path: docs/runbook.md
    owner: owner
    created_at: "2099-01-01"
    expires_at: "2099-01-02"
    mitigation: temp
    reference: ISSUE-1
"""))

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("references undefined rule", result.stdout)


def contract_with_waivers(waiver_block: str) -> str:
    return f"""schema_version: "1.0"
documentation_freshness:
  rules:
    - id: runbook
      when_paths:
        - docs/runbook.md
      require_any_of:
        - docs/runbook.md
      message: refresh the runbook
waiver_policy:
  max_active_same_rule_path: 1
{waiver_block.strip()}
"""


if __name__ == "__main__":
    unittest.main()
