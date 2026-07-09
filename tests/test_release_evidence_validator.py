import json
import subprocess
import unittest
from pathlib import Path

import yaml

from tests.helpers.policy_test_utils import TempRepo
from tests.helpers.release_evidence_test_data import (
    MANIFEST_TEXT,
    REPO_CONTRACT_TEXT,
    evidence_payload,
)


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "validate_release_evidence.py"
STAGING_URL = "https://staging.example.com/release"
PROD_URL = "https://prod.example.com/release"


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

    def test_staging_post_deploy_health_must_include_required_fields(self) -> None:
        self.write_evidence(
            '{"build":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"maintainability-report":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"immutable_artifact":{"generated_at":"2099-01-01T00:00:00Z"},'
            f'"deploy-record":{{"generated_at":"2099-01-01T00:00:00Z","deployed_sha":"abc",'
            f'"environment":"staging","deployment_url":"{STAGING_URL}","rollback_target":"abc-prev"}},'
            '"post-deploy-health":{"generated_at":"2099-01-01T00:00:00Z"}}'
        )

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("post-deploy-health missing required field 'checked_sha'", result.stdout)

    def test_staging_accepts_hyphenated_immutable_artifact_key(self) -> None:
        self.write_evidence(
            '{"build":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"maintainability-report":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"immutable-artifact":{"generated_at":"2099-01-01T00:00:00Z"},'
            f'"deploy-record":{{"generated_at":"2099-01-01T00:00:00Z","deployed_sha":"abc",'
            f'"environment":"staging","deployment_url":"{STAGING_URL}","rollback_target":"abc-prev"}},'
            f'"post-deploy-health":{{"generated_at":"2099-01-01T00:00:00Z","checked_sha":"abc",'
            f'"environment":"staging","deployment_url":"{STAGING_URL}","status":"healthy",'
            '"commit_verified":true}}'
        )

        result = run_validator(self.repo.root, "staging")

        self.assertEqual(result.returncode, 0)
        self.assertIn("PASS  release-evidence", result.stdout)

    def test_staging_post_deploy_health_must_verify_commit(self) -> None:
        self.write_json_evidence({
            "build": {"generated_at": "2099-01-01T00:00:00Z"},
            "maintainability-report": {"generated_at": "2099-01-01T00:00:00Z"},
            "immutable-artifact": {"generated_at": "2099-01-01T00:00:00Z"},
            "deploy-record": {
                "generated_at": "2099-01-01T00:00:00Z",
                "deployed_sha": "abc",
                "environment": "staging",
                "deployment_url": STAGING_URL,
                "rollback_target": "abc-prev",
            },
            "post-deploy-health": {
                "generated_at": "2099-01-01T00:00:00Z",
                "checked_sha": "abc",
                "environment": "staging",
                "deployment_url": STAGING_URL,
                "status": "healthy",
                "commit_verified": False,
            },
        })

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("post-deploy-health commit_verified must be true", result.stdout)

    def test_staging_rejects_inconsistent_live_deploy_evidence(self) -> None:
        self.write_json_evidence({
            "build": {"generated_at": "2099-01-01T00:00:00Z"},
            "maintainability-report": {"generated_at": "2099-01-01T00:00:00Z"},
            "immutable-artifact": {"generated_at": "2099-01-01T00:00:00Z"},
            "deploy-record": {
                "generated_at": "2099-01-01T00:00:00Z",
                "deployed_sha": "abc",
                "environment": "staging",
                "deployment_url": STAGING_URL,
                "rollback_target": "abc-prev",
            },
            "post-deploy-health": {
                "generated_at": "2099-01-01T00:00:00Z",
                "checked_sha": "def",
                "environment": "prod",
                "deployment_url": "https://other.example.com/release",
                "status": "unhealthy",
                "commit_verified": True,
            },
        })

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("post-deploy-health environment 'prod' does not match requested environment 'staging'", result.stdout)
        self.assertIn("post-deploy-health status must be 'healthy'", result.stdout)
        self.assertIn("post-deploy-health checked_sha must match deploy-record deployed_sha", result.stdout)
        self.assertIn("post-deploy-health deployment_url must match deploy-record deployment_url", result.stdout)

    def test_staging_rejects_local_deployment_url(self) -> None:
        self.write_json_evidence({
            "build": {"generated_at": "2099-01-01T00:00:00Z"},
            "maintainability-report": {"generated_at": "2099-01-01T00:00:00Z"},
            "immutable-artifact": {"generated_at": "2099-01-01T00:00:00Z"},
            "deploy-record": {
                "generated_at": "2099-01-01T00:00:00Z",
                "deployed_sha": "abc",
                "environment": "staging",
                "deployment_url": "http://127.0.0.1:4174",
                "rollback_target": "abc-prev",
            },
            "post-deploy-health": {
                "generated_at": "2099-01-01T00:00:00Z",
                "checked_sha": "abc",
                "environment": "staging",
                "deployment_url": "http://127.0.0.1:4174",
                "status": "healthy",
                "commit_verified": True,
            },
        })

        result = run_validator(self.repo.root, "staging")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("deploy-record deployment_url must be a hosted http(s) URL for 'staging'", result.stdout)
        self.assertIn("post-deploy-health deployment_url must be a hosted http(s) URL for 'staging'", result.stdout)

    def test_prod_rollback_verification_must_include_required_fields(self) -> None:
        self.write_evidence(
            '{"immutable-artifact":{"generated_at":"2099-01-01T00:00:00Z"},'
            '"immutable_artifact":{"generated_at":"2099-01-01T00:00:00Z"},'
            f'"deploy-record":{{"generated_at":"2099-01-01T00:00:00Z","deployed_sha":"abc",'
            f'"environment":"prod","deployment_url":"{PROD_URL}","rollback_target":"abc-prev"}},'
            f'"post-deploy-health":{{"generated_at":"2099-01-01T00:00:00Z","checked_sha":"abc",'
            f'"environment":"prod","deployment_url":"{PROD_URL}","status":"healthy","commit_verified":true}},'
            '"rollback-verification":{"generated_at":"2099-01-01T00:00:00Z"}}'
        )

        result = run_validator(self.repo.root, "prod")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rollback-verification missing required field 'rollback_target'", result.stdout)

    def test_prod_rejects_unverified_or_mismatched_rollback(self) -> None:
        self.write_json_evidence({
            "immutable-artifact": {"generated_at": "2099-01-01T00:00:00Z"},
            "deploy-record": {
                "generated_at": "2099-01-01T00:00:00Z",
                "deployed_sha": "abc",
                "environment": "prod",
                "deployment_url": PROD_URL,
                "rollback_target": "abc-prev",
            },
            "post-deploy-health": {
                "generated_at": "2099-01-01T00:00:00Z",
                "checked_sha": "abc",
                "environment": "prod",
                "deployment_url": PROD_URL,
                "status": "healthy",
                "commit_verified": True,
            },
            "rollback-verification": {
                "generated_at": "2099-01-01T00:00:00Z",
                "rollback_target": "different",
                "verification_status": "skipped",
                "verified_at": "2099-01-01T00:05:00Z",
            },
        })

        result = run_validator(self.repo.root, "prod")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("rollback-verification verification_status must be 'verified'", result.stdout)
        self.assertIn("rollback-verification rollback_target must match deploy-record rollback_target", result.stdout)

    def write_evidence(self, payload: str) -> None:
        self.repo.write(".artifacts/release-evidence.json", payload)

    def write_json_evidence(self, payload: dict) -> None:
        self.write_evidence(json.dumps(payload))


class ActualReleasePolicyTest(unittest.TestCase):
    def test_actual_contract_requires_live_deploy_health_and_rollback_for_hosted_environments(self) -> None:
        contract = yaml.safe_load((REPO_ROOT / "repo-contract.yaml").read_text())
        environments = contract["release_management"]["environments"]

        self.assertEqual(environments["dev"]["require_live_deploy_proof"], False)
        self.assertEqual(environments["dev"]["require_post_deploy_health"], False)

        staging = environments["staging"]
        self.assertEqual(staging["require_live_deploy_proof"], True)
        self.assertEqual(staging["require_post_deploy_health"], True)
        self.assertIn("deploy-record", staging["required_live_checks"])
        for field in ("deployed_sha", "environment", "deployment_url", "rollback_target"):
            self.assertIn(field, staging["required_artifact_fields"])
        for field in ("environment", "deployment_url", "checked_sha", "status", "commit_verified"):
            self.assertIn(field, staging["required_post_deploy_health_fields"])

        prod = environments["prod"]
        self.assertEqual(prod["require_live_deploy_proof"], True)
        self.assertEqual(prod["require_post_deploy_health"], True)
        self.assertIn("deploy-record", prod["required_live_checks"])
        self.assertIn("rollback-verification", prod["required_live_checks"])
        for field in ("deployed_sha", "environment", "deployment_url", "rollback_target"):
            self.assertIn(field, prod["required_artifact_fields"])
        for field in ("environment", "deployment_url", "checked_sha", "status", "commit_verified"):
            self.assertIn(field, prod["required_post_deploy_health_fields"])
        for field in ("rollback_target", "verification_status", "verified_at"):
            self.assertIn(field, prod["required_rollback_fields"])

    def test_actual_manifest_declares_staging_and_prod_promotion_gates(self) -> None:
        manifest = yaml.safe_load((REPO_ROOT / "check-manifest.yaml").read_text())
        gates = {gate["environment"]: gate for gate in manifest["promotion_gates"]}

        self.assertEqual(gates["dev"]["require_immutable_artifact"], False)
        self.assertEqual(gates["staging"]["require_immutable_artifact"], True)
        self.assertEqual(gates["prod"]["require_immutable_artifact"], True)
        for item in ("build", "compatibility-report", "vulnerability-scan", "secret-scan"):
            self.assertIn(item, gates["staging"]["required_evidence"])
        for item in ("immutable-artifact", "deploy-record", "post-deploy-health", "rollback-verification"):
            self.assertIn(item, gates["prod"]["required_evidence"])


if __name__ == "__main__":
    unittest.main()
