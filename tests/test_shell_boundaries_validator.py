import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_shell_boundaries.py"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
    )


class ShellBoundariesValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)
        self.repo.write("pam-stack/deploy.sh", "#!/bin/bash\necho ok\n")
        self.repo.commit_all("baseline")

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_forbidden_command_fails(self) -> None:
        self.repo.write("pam-stack/deploy.sh", "#!/bin/bash\nsudo systemctl restart app\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden shell command", result.stdout)


CONTRACT_TEXT = """
schema_version: "1.0"
architecture:
  shell_command_rules:
    - paths: [pam-stack/**/*.sh]
      forbidden_commands: [sudo]
      description: privileged escalation is forbidden
"""


if __name__ == "__main__":
    unittest.main()
