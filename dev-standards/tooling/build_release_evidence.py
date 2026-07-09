#!/usr/bin/env python3
"""Assemble release evidence from concrete artifact JSON files."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from repo_policy_utils import load_json, repo_contract
from validate_release_evidence import main as validate_release_evidence
from validate_release_evidence import validate_release_evidence_payload


class EvidenceBuildError(Exception):
    pass


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output", help="Output path. Defaults to repo-contract release_management.evidence_file")
    parser.add_argument("--environment", help="Validate the assembled evidence for this release environment")
    parser.add_argument("--deploy-record")
    parser.add_argument("--post-deploy-health")
    parser.add_argument("--rollback-verification")
    parser.add_argument("--rollback-record", help="Alias for --rollback-verification")
    parser.add_argument("--immutable-artifact")
    parser.add_argument(
        "--evidence",
        action="append",
        default=[],
        metavar="NAME=PATH",
        help="Add an arbitrary evidence artifact under NAME",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    try:
        output_path = resolve_output_path(repo_root, args.output)
        evidence = build_evidence(repo_root, args)
        if args.environment:
            validate_before_write(repo_root, args.environment, evidence)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except EvidenceBuildError as error:
        print(f"FAIL  release-evidence-builder: {error}")
        return 1

    rel_output = output_path.relative_to(repo_root) if output_path.is_relative_to(repo_root) else output_path
    print(f"PASS  release-evidence-builder: wrote {rel_output}")
    if args.environment:
        return validate_release_evidence([
            "--repo-root",
            str(repo_root),
            "--environment",
            args.environment,
        ])
    return 0


def validate_before_write(repo_root: Path, environment: str, evidence: dict) -> None:
    failures = validate_release_evidence_payload(repo_root, environment, evidence)
    for failure in failures:
        print(f"FAIL  release-evidence: {failure}")
    if failures:
        raise EvidenceBuildError(f"validation failed for environment {environment!r}")


def resolve_output_path(repo_root: Path, output: str | None) -> Path:
    if output:
        return resolve_repo_path(repo_root, output)
    contract = repo_contract(repo_root)
    return repo_root / contract["release_management"]["evidence_file"]


def build_evidence(repo_root: Path, args: argparse.Namespace) -> dict:
    entries = parsed_custom_entries(args.evidence)
    entries.extend(canonical_entries(args))
    if not entries:
        raise EvidenceBuildError("at least one evidence artifact path is required")

    evidence = {}
    seen = set()
    for name, artifact_path in entries:
        if name in seen:
            raise EvidenceBuildError(f"duplicate evidence name {name!r}")
        seen.add(name)
        evidence[name] = load_artifact(repo_root, artifact_path)
    return evidence


def parsed_custom_entries(raw_entries: list[str]) -> list[tuple[str, str]]:
    entries = []
    for raw_entry in raw_entries:
        if "=" not in raw_entry:
            raise EvidenceBuildError(f"--evidence must use NAME=PATH, got {raw_entry!r}")
        name, artifact_path = raw_entry.split("=", 1)
        if not name or not artifact_path:
            raise EvidenceBuildError(f"--evidence must use NAME=PATH, got {raw_entry!r}")
        entries.append((name, artifact_path))
    return entries


def canonical_entries(args: argparse.Namespace) -> list[tuple[str, str]]:
    if args.rollback_record and args.rollback_verification:
        raise EvidenceBuildError("use only one of --rollback-record or --rollback-verification")

    entries = []
    add_if_present(entries, "deploy-record", args.deploy_record)
    add_if_present(entries, "post-deploy-health", args.post_deploy_health)
    add_if_present(entries, "rollback-verification", args.rollback_verification or args.rollback_record)
    add_if_present(entries, "immutable-artifact", args.immutable_artifact)
    return entries


def add_if_present(entries: list[tuple[str, str]], name: str, artifact_path: str | None) -> None:
    if artifact_path:
        entries.append((name, artifact_path))


def load_artifact(repo_root: Path, artifact_path: str) -> dict:
    path = resolve_repo_path(repo_root, artifact_path)
    if not path.exists():
        raise EvidenceBuildError(f"artifact file {artifact_path!r} does not exist")
    try:
        payload = load_json(path)
    except json.JSONDecodeError as error:
        raise EvidenceBuildError(f"artifact file {artifact_path!r} is not valid JSON: {error.msg}") from error
    if not isinstance(payload, dict) or not payload:
        raise EvidenceBuildError(f"artifact file {artifact_path!r} must be a non-empty JSON object")
    return payload


def resolve_repo_path(repo_root: Path, raw_path: str) -> Path:
    path = Path(raw_path)
    return path if path.is_absolute() else repo_root / path


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
