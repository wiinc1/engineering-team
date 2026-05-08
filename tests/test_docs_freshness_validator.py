import json
import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_docs_freshness.py"


def run_validator(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


class DocsFreshnessValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", contract_text())

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_standards_change_without_doc_update_fails(self) -> None:
        self.repo.write("dev-standards/policies/core-standard.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("dev-standards/policies/core-standard.md", "new\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("standards:", result.stdout)

    def test_matching_doc_update_passes(self) -> None:
        self.repo.write("dev-standards/policies/core-standard.md", "old\n")
        self.repo.write("CHANGELOG.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("dev-standards/policies/core-standard.md", "new\n")
        self.repo.write("CHANGELOG.md", "new\n")

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  docs-freshness", result.stdout)

    def test_adr_reference_can_satisfy_rule(self) -> None:
        self.repo.write("dev-standards/policies/core-standard.md", "old\n")
        self.repo.write("docs/adr/ADR-101.md", "adr\n")
        self.repo.write(
            ".artifacts/change-metadata.json",
            json.dumps({"reference": "ADR-101"}),
        )
        self.repo.commit_all("baseline")
        self.repo.write("dev-standards/policies/core-standard.md", "new\n")

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  docs-freshness", result.stdout)

    def test_requires_doc_update_blocks_adr_only(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(requires_doc_update=True))
        self.repo.write("dev-standards/policies/core-standard.md", "old\n")
        self.repo.write("docs/adr/ADR-101.md", "adr\n")
        self.repo.write(
            ".artifacts/change-metadata.json",
            json.dumps({"reference": "ADR-101"}),
        )
        self.repo.commit_all("baseline")
        self.repo.write("dev-standards/policies/core-standard.md", "new\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("standards:", result.stdout)

    def test_requires_adr_blocks_doc_only(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(requires_adr=True))
        self.repo.write("dev-standards/policies/core-standard.md", "old\n")
        self.repo.write("CHANGELOG.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("dev-standards/policies/core-standard.md", "new\n")
        self.repo.write("CHANGELOG.md", "new\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("standards:", result.stdout)


def contract_text(requires_doc_update: bool = False, requires_adr: bool = False) -> str:
    extra = "      requires_doc_update: true\n" if requires_doc_update else ""
    adr = "      requires_adr: true\n" if requires_adr else ""
    return f"""
schema_version: "1.0"
change_management:
  metadata_file: .artifacts/change-metadata.json
  reference_rules:
    - prefix: ADR-
      pattern: "^ADR-[0-9]+$"
      require_existing_file_globs:
        - docs/adr/{{reference}}.md
documentation_freshness:
  rules:
    - id: standards
      when_paths:
        - dev-standards/**
      require_any_of:
        - CHANGELOG.md
      allow_reference_prefix: ADR-
{extra}{adr}      message: standards updates must touch changelog
"""


if __name__ == "__main__":
    unittest.main()
