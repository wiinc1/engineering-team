#!/usr/bin/env python3
"""Validate waiver lifecycle rules."""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from collections import Counter
from pathlib import Path

from repo_policy_utils import any_match, glob_matches, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    today = dt.date.today()
    failures = waiver_failures(repo_root, contract.get("waivers", []), contract.get("waiver_policy", {}), today)

    for failure in failures:
        print(f"FAIL  waivers: {failure}")
    if not failures:
        print(f"PASS  waivers: validated {len(contract.get('waivers', []))} waivers")
    return 1 if failures else 0


def parse_date(value: str, label: str, failures: list[str]) -> dt.date | None:
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        failures.append(f"{label} must be ISO date YYYY-MM-DD, got {value!r}")
        return None


def waiver_failures(repo_root: Path, waivers: list[dict], policy: dict, today: dt.date) -> list[str]:
    failures = []
    active_counts = Counter()
    known_rules = defined_rules(waivers, policy, repo_root)
    for index, waiver in enumerate(waivers):
        active = validate_waiver(repo_root, waiver, today, known_rules, f"waivers[{index}]", failures)
        if active:
            active_counts[(waiver["rule"], waiver["path"])] += 1
    max_repeats = policy.get("max_active_same_rule_path", 1)
    for (rule, path), count in active_counts.items():
        if count > max_repeats:
            failures.append(f"waiver rule/path pair {(rule, path)!r} exceeds max active count {max_repeats}")
    return failures


def validate_waiver(
    repo_root: Path,
    waiver: dict,
    today: dt.date,
    known_rules: set[str],
    prefix: str,
    failures: list[str],
) -> bool:
    created_at = parse_date(waiver["created_at"], f"{prefix}.created_at", failures)
    expires_at = parse_date(waiver["expires_at"], f"{prefix}.expires_at", failures)
    active = validate_date_order(created_at, expires_at, waiver["expires_at"], today, prefix, failures)
    if waiver["rule"] not in known_rules:
        failures.append(f"{prefix}.rule references undefined rule {waiver['rule']!r}")
    if not waiver_path_exists(repo_root, waiver["path"]):
        failures.append(f"{prefix}.path does not match any existing path: {waiver['path']}")
    validate_scope(repo_root, waiver, prefix, failures)
    return active


def validate_date_order(
    created_at: dt.date | None,
    expires_at: dt.date | None,
    expires_at_raw: str,
    today: dt.date,
    prefix: str,
    failures: list[str],
) -> bool:
    active = False
    if created_at and expires_at and expires_at < created_at:
        failures.append(f"{prefix}.expires_at must not be earlier than created_at")
    if expires_at and expires_at < today:
        failures.append(f"{prefix} expired on {expires_at_raw}")
    if expires_at and expires_at >= today:
        active = True
    return active


def waiver_path_exists(repo_root: Path, path_pattern: str) -> bool:
    if any(char in path_pattern for char in "*?["):
        return any(
            glob_matches(path.relative_to(repo_root).as_posix(), path_pattern)
            for path in repo_root.rglob("*")
            if path.is_file()
        )
    return (repo_root / path_pattern).exists()


def defined_rules(waivers: list[dict], policy: dict, repo_root: Path) -> set[str]:
    contract = repo_contract(repo_root)
    rules = {
        "approval-proof",
        "architecture",
        "change-metadata",
        "maintainability",
        "release-evidence",
        "test-policy:flaky-quarantine",
    }
    rules.update(f"docs-freshness:{rule['id']}" for rule in contract.get("documentation_freshness", {}).get("rules", []))
    return rules


def validate_scope(repo_root: Path, waiver: dict, prefix: str, failures: list[str]) -> None:
    contract = repo_contract(repo_root)
    if not waiver["rule"].startswith("docs-freshness:"):
        return
    rule_id = waiver["rule"].split(":", 1)[1]
    doc_rule = next(
        (rule for rule in contract.get("documentation_freshness", {}).get("rules", []) if rule["id"] == rule_id),
        None,
    )
    if doc_rule is None:
        return
    if any_match(waiver["path"], doc_rule["when_paths"]):
        return
    failures.append(f"{prefix}.path {waiver['path']!r} is broader than allowed scope for rule {waiver['rule']!r}")


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
