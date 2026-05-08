import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo
from tests.helpers.release_evidence_test_data import (
    MANIFEST_TEXT,
    REPO_CONTRACT_TEXT,
    evidence_payload,
)


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_release_evidence.py"


def run_validator(repo_root: Path, environment: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root), "--environment", environment],
        capture_output=True,
        text=True,
        check=False,
    )


class ReleaseEvidenceValidatorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", REPO_CONTRACT_TEXT)
        self.repo.write("check-manifest.yaml", MANIFEST_TEXT)

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_valid_dev_evidence_passes(self) -> None:
        self.write_evidence(
            evidence_payload(
                "2099-01-01T00:00:00Z",
                "lint",
                "typecheck",
                "test",
                "maintainability-report",
                "unittest-report",
            )
        )

        result = run_validator(self.repo.root, "dev")

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  release-evidence", result.stdout)

    def test_missing_required_evidence_fails(self) -> None:
        self.write_evidence(evidence_payload("2099-01-01T00:00:00Z", "lint"))

        result = run_validator(self.repo.root, "dev")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required evidence 'typecheck'", result.stdout)

    def test_expired_evidence_fails(self) -> None:
        stale = "2000-01-01T00:00:00Z"
        self.write_evidence(
            evidence_payload(
                stale,
                "lint",
                "typecheck",
                "test",
                "maintainability-report",
                "unittest-report",
            )
        )

        result = run_validator(self.repo.root, "dev")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("older than 7 days", result.stdout)

    def test_staging_requires_immutable_artifact(self) -> None:
        self.write_evidence(evidence_payload("2099-01-01T00:00:00Z", "build", "maintainability-report"))

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires immutable_artifact", result.stdout)

    def test_unknown_environment_fails(self) -> None:
        self.write_evidence("{}")

        result = run_validator(self.repo.root, "qa")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unknown environment 'qa'", result.stdout)

    def test_migration_change_requires_rollback_evidence(self) -> None:
        self.repo.write(
            ".artifacts/change-metadata.json",
            '{"change_kind":"migration","reversibility":"conditionally-reversible"}',
        )
        self.write_evidence(evidence_payload("2099-01-01T00:00:00Z", "lint", "typecheck", "test"))

        result = run_validator(self.repo.root, "dev")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required evidence 'rollback-verification'", result.stdout)

    def test_irreversible_change_requires_rollback_evidence(self) -> None:
        self.repo.write(
            ".artifacts/change-metadata.json",
            '{"change_kind":"release","reversibility":"irreversible"}',
        )
        self.write_evidence(
            evidence_payload(
                "2099-01-01T00:00:00Z",
                "lint",
                "typecheck",
                "test",
                "rollback-verification",
            )
        )

        result = run_validator(self.repo.root, "dev")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("missing required evidence 'standards-approval-record'", result.stdout)

    def test_staging_requires_live_deploy_proof(self) -> None:
        self.write_evidence(
            evidence_payload(
                "2099-01-01T00:00:00Z",
                "build",
                "maintainability-report",
                "immutable_artifact",
            )
        )

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires deploy-record evidence", result.stdout)

    def test_staging_deploy_record_must_include_required_fields(self) -> None:
        self.write_evidence(
            '{"build":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"maintainability-report":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"immutable_artifact":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"deploy-record":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"post-deploy-health":{"generated_at":"2099-01-01T00:00:00Z"}}'
        )

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("deploy-record missing required field 'deployed_sha'", result.stdout)

    def write_evidence(self, payload: str) -> None:
        self.repo.write(".artifacts/release-evidence.json", payload)


if __name__ == "__main__":
    unittest.main()
