#!/usr/bin/env python3
"""Validate release and promotion evidence for a target environment."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

from repo_policy_utils import check_manifest, load_optional_json, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--environment")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    manifest = check_manifest(repo_root)
    environment = args.environment or contract["release_management"]["default_environment"]
    evidence_path = repo_root / contract["release_management"]["evidence_file"]
    evidence = load_evidence(evidence_path)
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
        if gate.get("require_immutable_artifact") and "immutable_artifact" not in evidence:
            failures.append(f"environment {environment!r} requires immutable_artifact")

    for failure in failures:
        print(f"FAIL  release-evidence: {failure}")
    if not failures:
        print(f"PASS  release-evidence: validated environment {environment}")
    return 1 if failures else 0


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
    failures.extend(required_artifact_field_failures(evidence, config.get("required_artifact_fields", [])))
    return failures


def required_artifact_field_failures(evidence: dict, required_fields: list[str]) -> list[str]:
    if not required_fields:
        return []
    deploy_record = evidence.get("deploy-record")
    if deploy_record is None:
        return []
    failures = []
    for field in required_fields:
        if field not in deploy_record:
            failures.append(f"deploy-record missing required field {field!r}")
    return failures


def freshness_failures(item: str, payload: dict, freshness_days: int, today: dt.datetime) -> list[str]:
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
