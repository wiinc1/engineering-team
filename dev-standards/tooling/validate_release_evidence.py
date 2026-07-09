#!/usr/bin/env python3
"""Validate release and promotion evidence for a target environment."""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from repo_policy_utils import check_manifest, load_optional_json, repo_contract


HOSTED_RELEASE_ENVIRONMENTS = {"staging", "prod"}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--environment")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    environment = args.environment or contract["release_management"]["default_environment"]
    evidence_path = repo_root / contract["release_management"]["evidence_file"]
    evidence = load_evidence(evidence_path)
    failures = validate_release_evidence_payload(repo_root, environment, evidence)

    for failure in failures:
        print(f"FAIL  release-evidence: {failure}")
    if not failures:
        print(f"PASS  release-evidence: validated environment {environment}")
    return 1 if failures else 0


def validate_release_evidence_payload(repo_root: Path, environment: str, evidence: dict) -> list[str]:
    contract = repo_contract(repo_root)
    manifest = check_manifest(repo_root)
    metadata = load_change_metadata(repo_root, contract["change_management"]["metadata_file"])
    failures = []
    gate = promotion_gate(manifest, environment)
    if gate is None:
        failures.append(f"unknown environment {environment!r}")
    else:
        failures.extend(required_evidence_failures(evidence, gate["required_evidence"]))
        failures.extend(release_check_failures(evidence, manifest["release_checks"], environment))
        failures.extend(change_kind_evidence_failures(evidence, metadata, contract["change_management"]["change_kind_rules"]))
        failures.extend(irreversible_evidence_failures(evidence, metadata, contract["release_management"]))
        failures.extend(environment_policy_failures(evidence, environment, contract["release_management"]))
        if gate.get("require_immutable_artifact") and not has_immutable_artifact(evidence):
            failures.append(f"environment {environment!r} requires immutable_artifact")
    return failures


def load_evidence(path: Path) -> dict:
    return load_optional_json(path)


def load_change_metadata(repo_root: Path, metadata_file: str) -> dict:
    path = repo_root / metadata_file
    if path.exists():
        return load_optional_json(path)
    return {
        "change_kind": os.environ.get("CHANGE_KIND"),
        "reversibility": os.environ.get("CHANGE_REVERSIBILITY"),
    }


def has_immutable_artifact(evidence: dict) -> bool:
    return "immutable_artifact" in evidence or "immutable-artifact" in evidence


def promotion_gate(manifest: dict, environment: str) -> dict | None:
    for gate in manifest["promotion_gates"]:
        if gate["environment"] == environment:
            return gate
    return None


def required_evidence_failures(evidence: dict, required: list[str]) -> list[str]:
    failures = []
    for item in required:
        if item not in evidence:
            failures.append(f"missing required evidence {item!r}")
    return failures


def release_check_failures(evidence: dict, checks: list[dict], environment: str) -> list[str]:
    failures = []
    today = dt.datetime.now(dt.timezone.utc)
    for check in checks:
        environments = check.get("environments")
        if environments and environment not in environments:
            continue
        for item in check["evidence"]:
            if item not in evidence:
                failures.append(f"release check {check['id']!r} missing evidence {item!r}")
                continue
            if check.get("freshness_days") is not None:
                failures.extend(freshness_failures(item, evidence[item], check["freshness_days"], today))
    return failures


def change_kind_evidence_failures(evidence: dict, metadata: dict, rules: list[dict]) -> list[str]:
    change_kind = metadata.get("change_kind")
    for rule in rules:
        if rule["change_kind"] != change_kind:
            continue
        return required_evidence_failures(evidence, rule.get("required_release_evidence", []))
    return []


def irreversible_evidence_failures(evidence: dict, metadata: dict, policy: dict) -> list[str]:
    if metadata.get("reversibility") != "irreversible":
        return []
    return required_evidence_failures(evidence, policy.get("irreversible_change_evidence", []))


def environment_policy_failures(evidence: dict, environment: str, policy: dict) -> list[str]:
    config = policy.get("environments", {}).get(environment)
    if not config:
        return []
    failures = []
    if config.get("require_live_deploy_proof", False) and "deploy-record" not in evidence:
        failures.append(f"environment {environment!r} requires deploy-record evidence")
    if config.get("require_post_deploy_health", False) and "post-deploy-health" not in evidence:
        failures.append(f"environment {environment!r} requires post-deploy-health evidence")
    failures.extend(required_evidence_failures(evidence, config.get("required_live_checks", [])))
    failures.extend(required_artifact_field_failures(evidence, "deploy-record", config.get("required_artifact_fields", [])))
    failures.extend(required_artifact_field_failures(
        evidence,
        "post-deploy-health",
        config.get("required_post_deploy_health_fields", []),
    ))
    failures.extend(required_artifact_field_failures(
        evidence,
        "rollback-verification",
        config.get("required_rollback_fields", []),
    ))
    failures.extend(live_release_artifact_failures(evidence, environment, config))
    return failures


def required_artifact_field_failures(evidence: dict, artifact_name: str, required_fields: list[str]) -> list[str]:
    if not required_fields:
        return []
    artifact = evidence.get(artifact_name)
    if artifact is None:
        return []
    if not isinstance(artifact, dict):
        return [f"{artifact_name} must be a JSON object"]
    failures = []
    for field in required_fields:
        if field not in artifact or is_blank(artifact[field]):
            failures.append(f"{artifact_name} missing required field {field!r}")
    return failures


def live_release_artifact_failures(evidence: dict, environment: str, config: dict) -> list[str]:
    deploy_record = artifact_payload(evidence, "deploy-record")
    post_deploy_health = artifact_payload(evidence, "post-deploy-health")
    rollback_verification = artifact_payload(evidence, "rollback-verification")
    failures = []
    failures.extend(deploy_record_failures(deploy_record, environment, config))
    failures.extend(post_deploy_health_failures(post_deploy_health, environment, config))
    failures.extend(deploy_health_consistency_failures(deploy_record, post_deploy_health))
    failures.extend(rollback_artifact_failures(rollback_verification, deploy_record))
    return failures


def deploy_record_failures(deploy_record: dict | None, environment: str, config: dict) -> list[str]:
    if not deploy_record:
        return []
    failures = []
    failures.extend(environment_match_failures("deploy-record", deploy_record, environment))
    failures.extend(hosted_deployment_url_failures(
        "deploy-record",
        deploy_record,
        environment,
        config.get("require_live_deploy_proof", False),
    ))
    return failures


def post_deploy_health_failures(post_deploy_health: dict | None, environment: str, config: dict) -> list[str]:
    if not post_deploy_health:
        return []
    failures = []
    failures.extend(environment_match_failures("post-deploy-health", post_deploy_health, environment))
    failures.extend(healthy_status_failures(post_deploy_health, config.get("require_post_deploy_health", False)))
    failures.extend(commit_verified_failures(post_deploy_health, environment, config.get("require_post_deploy_health", False)))
    failures.extend(hosted_deployment_url_failures(
        "post-deploy-health",
        post_deploy_health,
        environment,
        config.get("require_post_deploy_health", False),
    ))
    return failures


def deploy_health_consistency_failures(deploy_record: dict | None, post_deploy_health: dict | None) -> list[str]:
    if not deploy_record or not post_deploy_health:
        return []
    failures = []
    failures.extend(matching_field_failures(
        "deploy-record",
        deploy_record,
        "deployed_sha",
        "post-deploy-health",
        post_deploy_health,
        "checked_sha",
    ))
    failures.extend(matching_field_failures(
        "deploy-record",
        deploy_record,
        "deployment_url",
        "post-deploy-health",
        post_deploy_health,
        "deployment_url",
    ))
    return failures


def rollback_artifact_failures(rollback_verification: dict | None, deploy_record: dict | None) -> list[str]:
    if not rollback_verification:
        return []
    failures = []
    failures.extend(verified_rollback_failures(rollback_verification))
    if deploy_record:
        failures.extend(matching_field_failures(
            "deploy-record",
            deploy_record,
            "rollback_target",
            "rollback-verification",
            rollback_verification,
            "rollback_target",
        ))
    return failures


def artifact_payload(evidence: dict, artifact_name: str) -> dict | None:
    artifact = evidence.get(artifact_name)
    return artifact if isinstance(artifact, dict) else None


def normalized_value(value: object) -> str:
    return str(value).strip() if value is not None else ""


def is_blank(value: object) -> bool:
    return value is None or normalized_value(value) == "" or value == [] or value == {}


def field_value(artifact: dict, field: str) -> str:
    value = artifact.get(field)
    return "" if is_blank(value) else normalized_value(value)


def environment_match_failures(artifact_name: str, artifact: dict, environment: str) -> list[str]:
    artifact_environment = field_value(artifact, "environment")
    if artifact_environment and artifact_environment != environment:
        return [f"{artifact_name} environment {artifact_environment!r} does not match requested environment {environment!r}"]
    return []


def healthy_status_failures(artifact: dict, required: bool) -> list[str]:
    status = field_value(artifact, "status").lower()
    if required and status and status != "healthy":
        return ["post-deploy-health status must be 'healthy'"]
    return []


def commit_verified_failures(artifact: dict, environment: str, required: bool) -> list[str]:
    if required and environment in HOSTED_RELEASE_ENVIRONMENTS and artifact.get("commit_verified") is not True:
        return ["post-deploy-health commit_verified must be true"]
    return []


def verified_rollback_failures(artifact: dict) -> list[str]:
    status = field_value(artifact, "verification_status").lower()
    if status and status != "verified":
        return ["rollback-verification verification_status must be 'verified'"]
    return []


def matching_field_failures(
    left_name: str,
    left_artifact: dict,
    left_field: str,
    right_name: str,
    right_artifact: dict,
    right_field: str,
) -> list[str]:
    left_value = field_value(left_artifact, left_field)
    right_value = field_value(right_artifact, right_field)
    if left_value and right_value and left_value != right_value:
        return [f"{right_name} {right_field} must match {left_name} {left_field}"]
    return []


def hosted_deployment_url_failures(artifact_name: str, artifact: dict, environment: str, required: bool) -> list[str]:
    deployment_url = field_value(artifact, "deployment_url")
    if not required or environment not in HOSTED_RELEASE_ENVIRONMENTS or not deployment_url:
        return []
    if is_local_or_private_url(deployment_url):
        return [f"{artifact_name} deployment_url must be a hosted http(s) URL for {environment!r}"]
    return []


def is_local_or_private_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return True
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not hostname:
        return True
    if hostname == "localhost" or hostname.endswith(".local"):
        return True
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return address.is_loopback or address.is_private or address.is_link_local or address.is_unspecified


def freshness_failures(item: str, payload: dict, freshness_days: int, today: dt.datetime) -> list[str]:
    if not isinstance(payload, dict):
        return [f"evidence {item!r} must be a JSON object"]
    generated_at = payload.get("generated_at")
    if not generated_at:
        return [f"evidence {item!r} missing generated_at for freshness validation"]
    try:
        parsed = dt.datetime.fromisoformat(generated_at.replace("Z", "+00:00"))
    except ValueError:
        return [f"evidence {item!r} has invalid generated_at {generated_at!r}"]
    if today - parsed > dt.timedelta(days=freshness_days):
        return [f"evidence {item!r} is older than {freshness_days} days"]
    return []


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
