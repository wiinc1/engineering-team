import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_config_boundaries.py"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
    )


class ConfigBoundariesValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)
        self.repo.write("pam-stack/teleport.yaml", "cluster_name: arya\n")
        self.repo.commit_all("baseline")

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_cross_stack_reference_fails(self) -> None:
        self.repo.write("pam-stack/teleport.yaml", "forward_to: vault-stack/tbot.yaml\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden reference", result.stdout)


CONTRACT_TEXT = """
schema_version: "1.0"
architecture:
  config_boundary_rules:
    - paths: [pam-stack/**/*.yaml]
      owner: pam-stack
      forbidden_references: [vault-stack/]
"""


if __name__ == "__main__":
    unittest.main()
