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

    def test_runtime_change_requires_architecture_or_runbook_update(self) -> None:
        self.repo.write("repo-contract.yaml", contract_text(runtime_rule=True))
        self.repo.write("src/app/App.jsx", "old\n")
        self.repo.write("docs/architecture.md", "old\n")
        self.repo.write("docs/runbook.md", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("src/app/App.jsx", "new\n")

        result = run_validator(self.repo.root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("runtime:", result.stdout)

        self.repo.write("docs/runbook.md", "new\n")
        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)

    def test_runtime_no_impact_waiver_satisfies_rule(self) -> None:
        self.repo.write(
            "repo-contract.yaml",
            contract_text(runtime_rule=True, runtime_waiver=True),
        )
        self.repo.write("src/app/App.jsx", "old\n")
        self.repo.commit_all("baseline")
        self.repo.write("src/app/App.jsx", "new\n")

        result = run_validator(self.repo.root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  docs-freshness", result.stdout)


def contract_text(
    requires_doc_update: bool = False,
    requires_adr: bool = False,
    runtime_rule: bool = False,
    runtime_waiver: bool = False,
) -> str:
    standard_options = standard_rule_options(requires_doc_update, requires_adr)
    runtime = runtime_rule_text() if runtime_rule else ""
    waivers = runtime_waiver_text() if runtime_waiver else ""
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
{standard_options}      message: standards updates must touch changelog
{runtime}
{waivers}
"""


def standard_rule_options(requires_doc_update: bool, requires_adr: bool) -> str:
    extra = "      requires_doc_update: true\n" if requires_doc_update else ""
    adr = "      requires_adr: true\n" if requires_adr else ""
    return f"{extra}{adr}"


def runtime_rule_text() -> str:
    return """
    - id: runtime
      when_paths:
        - src/**
        - lib/**
        - api/**
        - scripts/**
      require_any_of:
        - docs/architecture.md
        - docs/runbook.md
      requires_doc_update: true
      message: runtime changes must update architecture or runbook
"""


def runtime_waiver_text() -> str:
    return """
waivers:
  - rule: docs-freshness:runtime
    path: src/**
    expires_at: "2999-01-01"
    reason: no architecture or operations impact
"""


if __name__ == "__main__":
    unittest.main()
