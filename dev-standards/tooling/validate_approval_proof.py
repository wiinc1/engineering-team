#!/usr/bin/env python3
"""Validate approval proof for protected and explicit-instruction changes."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from repo_policy_utils import any_match, changed_files, load_optional_json, parse_datetime, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-ref")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    touched = changed_files(repo_root, args.base_ref)
    if not touched:
        print("PASS  approval-proof: no changed files to validate")
        return 0

    metadata = load_change_metadata(repo_root, contract["change_management"]["metadata_file"])
    failures = approval_failures(repo_root, touched, metadata, contract["change_management"])

    for failure in failures:
        print(f"FAIL  approval-proof: {failure}")
    if not failures:
        print(f"PASS  approval-proof: validated {len(touched)} changed files")
    return 1 if failures else 0


def load_change_metadata(repo_root: Path, metadata_file: str) -> dict:
    path = repo_root / metadata_file
    if path.exists():
        return load_optional_json(path)
    return {
        "change_kind": os.environ.get("CHANGE_KIND"),
        "reference": os.environ.get("CHANGE_REFERENCE"),
    }


def approval_failures(repo_root: Path, touched: list[str], metadata: dict, policy: dict) -> list[str]:
    approvals = load_optional_json(repo_root / policy["approval_file"]).get("approvals", [])
    failures = []
    for rule in policy.get("approval_rules", []):
        scoped_paths = [path for path in touched if any_match(path, rule["when_paths"])]
        if not scoped_paths:
            continue
        if metadata.get("change_kind") not in rule["change_kinds"]:
            continue
        failures.extend(rule_approval_failures(scoped_paths, metadata, approvals, rule))
    return failures


def rule_approval_failures(scoped_paths: list[str], metadata: dict, approvals: list[dict], rule: dict) -> list[str]:
    for approval in approvals:
        if approval_matches(approval, scoped_paths, metadata, rule):
            return []
    return [f"no approval record covers {metadata.get('change_kind')!r} change for scoped paths {scoped_paths!r}"]


def approval_matches(approval: dict, scoped_paths: list[str], metadata: dict, rule: dict) -> bool:
    if not reference_matches(approval, metadata.get("reference")):
        return False
    if approval.get("change_kind") != metadata.get("change_kind"):
        return False
    if missing_required_approval_fields(approval, rule["require_fields"]):
        return False
    try:
        parse_datetime(approval["approved_at"])
    except ValueError:
        return False
    scope_paths = approval.get("scope_paths", [])
    return all(any_match(path, scope_paths) for path in scoped_paths)


def missing_required_approval_fields(approval: dict, required_fields: list[str]) -> bool:
    for field in required_fields:
        value = approval_field_value(approval, field)
        if value in (None, "", []):
            return True
    return False


def approval_field_value(approval: dict, field: str):
    if field != "reference":
        return approval.get(field)
    return approval.get("reference") or approval.get("reference_prefix")


def reference_matches(approval: dict, reference: str | None) -> bool:
    if not reference:
        return False
    if approval.get("reference") == reference:
        return True
    prefix = approval.get("reference_prefix")
    return bool(prefix) and reference.startswith(prefix)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
