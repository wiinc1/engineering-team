import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_architecture.py"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
    )


class ArchitectureValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", CONTRACT_TEXT)

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_forbidden_boundary_reference_fails(self) -> None:
        self.repo.write("pam-stack/app.py", "print('ok')\n")
        self.repo.commit_all("baseline")
        self.repo.write("pam-stack/app.py", "import dev_standards\n# dev-standards/\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("forbidden boundary dev-standards", result.stdout)

    def test_forbidden_python_import_fails(self) -> None:
        self.repo.write("pam-stack/app.py", "print('ok')\n")
        self.repo.commit_all("baseline")
        self.repo.write("pam-stack/app.py", "import repo_policy_utils\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("imports forbidden module prefix repo_policy_utils", result.stdout)

    def test_runtime_boundary_fails(self) -> None:
        self.repo.write("tests/test_example.py", "def test_ok():\n    assert True\n")
        self.repo.commit_all("baseline")
        self.repo.write(
            "tests/test_example.py",
            "import requests\n\ndef test_ok():\n    requests.get('https://example.com')\n",
        )

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("violates runtime boundary", result.stdout)

    def test_forbidden_layer_edge_fails(self) -> None:
        self.repo.write("pam-stack/app.py", "print('ok')\n")
        self.repo.commit_all("baseline")
        self.repo.write("pam-stack/app.py", "import tests.helpers.policy_test_utils\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("not an allowed edge", result.stdout)

    def test_allowed_change_passes(self) -> None:
        self.repo.write("pam-stack/app.py", "print('ok')\n")
        self.repo.commit_all("baseline")
        self.repo.write("pam-stack/app.py", "print('still ok')\n")

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  architecture", result.stdout)

CONTRACT_TEXT = """
schema_version: "1.0"
architecture:
  reference_scan_globs:
    - pam-stack/**/*.py
  internal_layout:
    - pam-stack
  dependency_rules:
    - no dev standards references
  boundary_map:
    - from: pam-stack
      to: dev-standards
      rule: forbid
  state_ownership:
    - resource: app
      owner: pam-stack
  source_of_truth:
    - repo-contract.yaml
  python_layers:
    - name: pam
      paths:
        - pam-stack/**/*.py
      module_prefixes:
        - pam_stack
    - name: tests
      paths:
        - tests/**/*.py
      module_prefixes:
        - tests
  allowed_layer_edges:
    pam:
      - pam
    tests:
      - tests
  python_import_rules:
    - from_paths:
        - pam-stack/**/*.py
      forbidden_modules:
        - repo_policy_utils
  runtime_boundary_rules:
    - paths:
        - tests/**/*.py
      forbidden_references:
        - requests.get
      description: tests must not call real HTTP clients
  banned_patterns:
    - pattern: os\\.environ\\[
      forbidden_in:
        - pam-stack/**/*.py
      description: direct env access is forbidden
"""


if __name__ == "__main__":
    unittest.main()
