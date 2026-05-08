import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_policy_files.py"

REPO_CONTRACT_SCHEMA = textwrap.dedent(
    """
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    additionalProperties: false
    required:
      - schema_version
      - repo
    properties:
      schema_version:
        type: string
        pattern: "^1\\\\.0$"
      repo:
        type: object
        additionalProperties: false
        required:
          - name
        properties:
          name:
            type: string
    """
).strip() + "\n"

AGENT_POLICY_SCHEMA = textwrap.dedent(
    """
    type: object
    additionalProperties: false
    required:
      - schema_version
      - editable_paths
    properties:
      schema_version:
        type: string
      editable_paths:
        type: array
        minItems: 1
        items:
          type: string
    """
).strip() + "\n"

CHECK_MANIFEST_SCHEMA = textwrap.dedent(
    """
    type: object
    additionalProperties: false
    required:
      - merge_checks
    properties:
      merge_checks:
        type: array
        minItems: 1
        items:
          type: object
          additionalProperties: false
          required:
            - id
            - required
          properties:
            id:
              type: string
            required:
              type: boolean
    """
).strip() + "\n"


def run_validator(repo_root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root)],
        capture_output=True,
        text=True,
        check=False,
    )


class PolicySchemaValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)
        schema_dir = self.repo_root / "dev-standards" / "schemas"
        schema_dir.mkdir(parents=True)
        (schema_dir / "repo-contract.schema.yaml").write_text(REPO_CONTRACT_SCHEMA, encoding="utf-8")
        (schema_dir / "agent-policy.schema.yaml").write_text(AGENT_POLICY_SCHEMA, encoding="utf-8")
        (schema_dir / "check-manifest.schema.yaml").write_text(CHECK_MANIFEST_SCHEMA, encoding="utf-8")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def write_policy_files(self, repo_contract: str, agent_policy: str, check_manifest: str) -> None:
        (self.repo_root / "repo-contract.yaml").write_text(repo_contract, encoding="utf-8")
        (self.repo_root / "agent-policy.yaml").write_text(agent_policy, encoding="utf-8")
        (self.repo_root / "check-manifest.yaml").write_text(check_manifest, encoding="utf-8")

    def test_valid_files_pass(self) -> None:
        self.write_policy_files(
            "schema_version: '1.0'\nrepo:\n  name: demo\n",
            "schema_version: '1.0'\neditable_paths:\n  - src/\n",
            "merge_checks:\n  - id: lint\n    required: true\n",
        )

        result = run_validator(self.repo_root)

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  repo-contract.yaml", result.stdout)
        self.assertIn("Validated 3 policy files, 0 failures.", result.stdout)

    def test_missing_required_field_fails(self) -> None:
        self.write_policy_files(
            "schema_version: '1.0'\n",
            "schema_version: '1.0'\neditable_paths:\n  - src/\n",
            "merge_checks:\n  - id: lint\n    required: true\n",
        )

        result = run_validator(self.repo_root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repo-contract.yaml.repo is required", result.stdout)

    def test_additional_property_fails(self) -> None:
        self.write_policy_files(
            "schema_version: '1.0'\nrepo:\n  name: demo\nextra: true\n",
            "schema_version: '1.0'\neditable_paths:\n  - src/\n",
            "merge_checks:\n  - id: lint\n    required: true\n",
        )

        result = run_validator(self.repo_root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repo-contract.yaml.extra is not allowed", result.stdout)

    def test_min_items_and_boolean_type_are_enforced(self) -> None:
        self.write_policy_files(
            "schema_version: '1.0'\nrepo:\n  name: demo\n",
            "schema_version: '1.0'\neditable_paths: []\n",
            "merge_checks:\n  - id: lint\n    required: 'true'\n",
        )

        result = run_validator(self.repo_root)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("agent-policy.yaml.editable_paths must contain at least 1 items", result.stdout)
        self.assertIn("check-manifest.yaml.merge_checks[0].required must be boolean", result.stdout)


if __name__ == "__main__":
    unittest.main()
