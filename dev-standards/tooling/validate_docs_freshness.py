#!/usr/bin/env python3
"""Validate documentation freshness rules for changed files."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from pathlib import Path

from repo_policy_utils import any_match, changed_files, existing_paths, parse_date, repo_contract


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
        print("PASS  docs-freshness: no changed files to validate")
        return 0

    metadata = load_change_metadata(repo_root, contract["change_management"]["metadata_file"])
    failures = freshness_failures(repo_root, contract, touched, metadata)

    for failure in failures:
        print(f"FAIL  docs-freshness: {failure}")
    if not failures:
        print(f"PASS  docs-freshness: validated {len(touched)} changed files")
    return 1 if failures else 0


def freshness_failures(repo_root: Path, contract: dict, touched: list[str], metadata: dict) -> list[str]:
    failures = []
    reference_rules = contract["change_management"]["reference_rules"]
    waivers = contract.get("waivers", [])
    for rule in contract["documentation_freshness"]["rules"]:
        if not rule_applies(rule, touched):
            continue
        if rule_is_satisfied(repo_root, rule, touched, metadata, reference_rules, waivers):
            continue
        failures.append(f"{rule['id']}: {rule['message']}")
    return failures


def rule_applies(rule: dict, touched: list[str]) -> bool:
    return any(any_match(path, rule["when_paths"]) for path in touched)


def rule_is_satisfied(
    repo_root: Path,
    rule: dict,
    touched: list[str],
    metadata: dict,
    reference_rules: list[dict],
    waivers: list[dict],
) -> bool:
    if not change_kind_matches(rule, metadata):
        return True
    docs_updated = any_match_in_list(touched, rule.get("require_any_of", []))
    adr_satisfied = reference_satisfies_rule(repo_root, rule, metadata, reference_rules)
    if docs_and_reference_satisfy_rule(rule, docs_updated, adr_satisfied):
        return True
    return matching_waiver_exists(waivers, touched, f"docs-freshness:{rule['id']}")


def change_kind_matches(rule: dict, metadata: dict) -> bool:
    allowed = rule.get("when_change_kinds")
    if not allowed:
        return True
    return metadata.get("change_kind") in allowed


def load_change_metadata(repo_root: Path, metadata_file: str) -> dict:
    path = repo_root / metadata_file
    if not path.exists():
        return {
            "change_kind": os.environ.get("CHANGE_KIND"),
            "reference": os.environ.get("CHANGE_REFERENCE"),
        }
    return json.loads(path.read_text(encoding="utf-8"))


def any_match_in_list(paths: list[str], patterns: list[str]) -> bool:
    return any(any_match(path, patterns) for path in paths)


def reference_satisfies_rule(
    repo_root: Path,
    rule: dict,
    metadata: dict,
    reference_rules: list[dict],
) -> bool:
    prefix = rule.get("allow_reference_prefix")
    reference = metadata.get("reference") or ""
    if not prefix or not reference.startswith(prefix):
        return False
    if rule.get("requires_doc_update", False) and not rule.get("allow_adr_only", False):
        return False
    return reference_resolves(repo_root, reference, reference_rules)


def docs_and_reference_satisfy_rule(rule: dict, docs_updated: bool, adr_satisfied: bool) -> bool:
    if rule.get("requires_adr", False):
        if not adr_satisfied:
            return False
        return docs_updated or rule.get("allow_adr_only", False)
    if docs_updated:
        return True
    return adr_satisfied


def reference_resolves(repo_root: Path, reference: str, rules: list[dict]) -> bool:
    for rule in rules:
        if not reference.startswith(rule.get("prefix", "")):
            continue
        patterns = [pattern.replace("{reference}", reference) for pattern in rule.get("require_existing_file_globs", [])]
        return bool(existing_paths(repo_root, patterns)) if patterns else True
    return False


def matching_waiver_exists(waivers: list[dict], touched: list[str], waiver_rule: str) -> bool:
    today = dt.date.today()
    for waiver in waivers:
        if waiver["rule"] != waiver_rule:
            continue
        if parse_date(waiver["expires_at"]) < today:
            continue
        if any(any_match(path, [waiver["path"]]) for path in touched):
            return True
    return False


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
