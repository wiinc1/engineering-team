import json
import subprocess
import unittest
from pathlib import Path

from tests.helpers.policy_test_utils import TempRepo
from tests.helpers.release_evidence_test_data import MANIFEST_TEXT, REPO_CONTRACT_TEXT


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "build_release_evidence.py"
STAGING_URL = "https://staging.example.com/release"
PROD_URL = "https://prod.example.com/release"


def run_builder(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


class ReleaseEvidenceBuilderTest(unittest.TestCase):
    def setUp(self) -> None:
        self.repo = TempRepo()
        self.repo.write("repo-contract.yaml", REPO_CONTRACT_TEXT)
        self.repo.write("check-manifest.yaml", MANIFEST_TEXT)

    def tearDown(self) -> None:
        self.repo.cleanup()

    def test_builds_staging_evidence_and_validates(self) -> None:
        self.write_json(".artifacts/build.json", generated_at="2099-01-01T00:00:00Z")
        self.write_json(".artifacts/maintainability-report.json", generated_at="2099-01-01T00:00:00Z")
        self.write_json(".artifacts/immutable-artifact.json", generated_at="2099-01-01T00:00:00Z")
        self.write_json(
            ".artifacts/deploy-record.json",
            generated_at="2099-01-01T00:00:00Z",
            deployed_sha="abc123",
            environment="staging",
            deployment_url=STAGING_URL,
            rollback_target="release-2026-07-03",
        )
        self.write_json(
            ".artifacts/post-deploy-health.json",
            generated_at="2099-01-01T00:00:00Z",
            checked_sha="abc123",
            environment="staging",
            deployment_url=STAGING_URL,
            status="healthy",
            commit_verified=True,
        )

        result = run_builder(
            self.repo.root,
            "--environment",
            "staging",
            "--evidence",
            "build=.artifacts/build.json",
            "--evidence",
            "maintainability-report=.artifacts/maintainability-report.json",
            "--deploy-record",
            ".artifacts/deploy-record.json",
            "--post-deploy-health",
            ".artifacts/post-deploy-health.json",
            "--immutable-artifact",
            ".artifacts/immutable-artifact.json",
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS  release-evidence-builder", result.stdout)
        self.assertIn("PASS  release-evidence", result.stdout)
        evidence = self.read_evidence()
        self.assertEqual(evidence["deploy-record"]["environment"], "staging")
        self.assertIn("immutable-artifact", evidence)

    def test_builds_prod_evidence_from_rollback_record_alias(self) -> None:
        self.write_json(".artifacts/immutable-artifact.json", generated_at="2099-01-01T00:00:00Z")
        self.write_json(
            ".artifacts/deploy-record.json",
            generated_at="2099-01-01T00:00:00Z",
            deployed_sha="abc123",
            environment="prod",
            deployment_url=PROD_URL,
            rollback_target="release-2026-07-03",
        )
        self.write_json(
            ".artifacts/post-deploy-health.json",
            generated_at="2099-01-01T00:00:00Z",
            checked_sha="abc123",
            environment="prod",
            deployment_url=PROD_URL,
            status="healthy",
            commit_verified=True,
        )
        self.write_json(
            ".artifacts/rollback-record.json",
            generated_at="2099-01-01T00:00:00Z",
            rollback_target="release-2026-07-03",
            verification_status="verified",
            verified_at="2099-01-01T00:05:00Z",
        )

        result = run_builder(
            self.repo.root,
            "--environment",
            "prod",
            "--deploy-record",
            ".artifacts/deploy-record.json",
            "--post-deploy-health",
            ".artifacts/post-deploy-health.json",
            "--rollback-record",
            ".artifacts/rollback-record.json",
            "--immutable-artifact",
            ".artifacts/immutable-artifact.json",
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        evidence = self.read_evidence()
        self.assertIn("rollback-verification", evidence)
        self.assertNotIn("rollback-record", evidence)

    def test_missing_component_file_fails_without_writing_output(self) -> None:
        result = run_builder(
            self.repo.root,
            "--deploy-record",
            ".artifacts/missing-deploy-record.json",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("does not exist", result.stdout)
        self.assertFalse((self.repo.root / ".artifacts" / "release-evidence.json").exists())

    def test_validation_failure_does_not_write_invalid_output(self) -> None:
        self.write_json(
            ".artifacts/deploy-record.json",
            generated_at="2099-01-01T00:00:00Z",
            deployed_sha="abc123",
            environment="staging",
            deployment_url=STAGING_URL,
            rollback_target="release-2026-07-03",
        )
        self.write_json(
            ".artifacts/post-deploy-health.json",
            generated_at="2099-01-01T00:00:00Z",
            checked_sha="abc123",
            environment="staging",
            deployment_url=STAGING_URL,
            status="unhealthy",
            commit_verified=True,
        )

        result = run_builder(
            self.repo.root,
            "--environment",
            "staging",
            "--deploy-record",
            ".artifacts/deploy-record.json",
            "--post-deploy-health",
            ".artifacts/post-deploy-health.json",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("post-deploy-health status must be 'healthy'", result.stdout)
        self.assertFalse((self.repo.root / ".artifacts" / "release-evidence.json").exists())

    def test_rejects_duplicate_evidence_names(self) -> None:
        self.write_json(".artifacts/deploy-record.json", generated_at="2099-01-01T00:00:00Z")

        result = run_builder(
            self.repo.root,
            "--evidence",
            "deploy-record=.artifacts/deploy-record.json",
            "--deploy-record",
            ".artifacts/deploy-record.json",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate evidence name 'deploy-record'", result.stdout)

    def test_rejects_non_object_component_artifacts(self) -> None:
        self.repo.write(".artifacts/build.json", '["not", "an", "object"]')

        result = run_builder(self.repo.root, "--evidence", "build=.artifacts/build.json")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be a non-empty JSON object", result.stdout)

    def write_json(self, rel_path: str, **payload: str) -> None:
        self.repo.write(rel_path, json.dumps(payload))

    def read_evidence(self) -> dict:
        return json.loads((self.repo.root / ".artifacts" / "release-evidence.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
