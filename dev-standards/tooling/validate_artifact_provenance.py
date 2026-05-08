#!/usr/bin/env python3
"""Validate provenance metadata for JSON artifacts consumed by policy checks."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from repo_policy_utils import current_head_sha, load_optional_json, parse_datetime, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    policy = contract.get("artifact_provenance")
    if not policy:
        print("PASS  artifact-provenance: no artifact provenance policy configured")
        return 0

    failures = []
    head_sha = current_head_sha(repo_root)
    for artifact in policy["artifacts"]:
        failures.extend(artifact_failures(repo_root, artifact, policy, head_sha))

    for failure in failures:
        print(f"FAIL  artifact-provenance: {failure}")
    if not failures:
        print(f"PASS  artifact-provenance: validated {len(policy['artifacts'])} artifact declarations")
    return 1 if failures else 0


def artifact_failures(repo_root: Path, artifact: dict, policy: dict, head_sha: str) -> list[str]:
    path = repo_root / artifact["path"]
    if not path.exists():
        return missing_artifact_failures(artifact)

    payload = load_optional_json(path)
    if not payload:
        return [f"artifact {artifact['path']!r} must be a non-empty JSON object"]

    failures = missing_required_fields(payload, artifact, policy)
    if failures:
        return failures
    failures.extend(metadata_failures(payload, artifact, policy, head_sha))
    failures.extend(ci_field_failures(payload, artifact, policy))
    return failures


def missing_artifact_failures(artifact: dict) -> list[str]:
    if artifact_required_in_context(artifact):
        return [f"missing required artifact {artifact['path']!r}"]
    return []


def artifact_required_in_context(artifact: dict) -> bool:
    if artifact.get("required_in_ci", False):
        return bool(os.environ.get("GITHUB_ACTIONS"))
    return not artifact.get("optional", False)


def metadata_failures(payload: dict, artifact: dict, policy: dict, head_sha: str) -> list[str]:
    failures = []
    generated_at = payload["generated_at"]
    try:
        parse_datetime(generated_at)
    except ValueError:
        failures.append(f"artifact {artifact['path']!r} has invalid generated_at {generated_at!r}")
    failures.extend(schema_version_failures(payload, artifact, policy))
    failures.extend(current_commit_failures(payload, artifact, head_sha))
    failures.extend(generator_failures(payload, artifact))
    return failures


def schema_version_failures(payload: dict, artifact: dict, policy: dict) -> list[str]:
    if payload["schema_version"] == policy["schema_version"]:
        return []
    return [
        f"artifact {artifact['path']!r} schema_version {payload['schema_version']!r} "
        f"does not match required {policy['schema_version']!r}"
    ]


def current_commit_failures(payload: dict, artifact: dict, head_sha: str) -> list[str]:
    if not artifact.get("require_current_commit", False) or payload["commit_sha"] == head_sha:
        return []
    return [
        f"artifact {artifact['path']!r} commit_sha {payload['commit_sha']!r} "
        f"does not match HEAD {head_sha!r}"
    ]


def generator_failures(payload: dict, artifact: dict) -> list[str]:
    expected_generator = artifact.get("expected_generator")
    if not expected_generator or payload.get("generated_by") == expected_generator:
        return []
    return [
        f"artifact {artifact['path']!r} generated_by {payload.get('generated_by')!r} "
        f"does not match expected {expected_generator!r}"
    ]


def missing_required_fields(payload: dict, artifact: dict, policy: dict) -> list[str]:
    failures = []
    required_fields = artifact.get("required_fields", policy["required_fields"])
    for field in required_fields:
        if payload.get(field) in (None, "", []):
            failures.append(f"artifact {artifact['path']!r} is missing required field {field!r}")
    return failures


def ci_field_failures(payload: dict, artifact: dict, policy: dict) -> list[str]:
    failures = []
    required_fields = []
    if artifact.get("require_ci_fields", False):
        required_fields.extend(policy.get("required_ci_fields", []))
    if artifact.get("require_live_fields", False):
        required_fields.extend(policy.get("required_live_fields", []))
    for field in required_fields:
        if payload.get(field) in (None, "", []):
            failures.append(f"artifact {artifact['path']!r} is missing required CI/live field {field!r}")
    return failures


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
