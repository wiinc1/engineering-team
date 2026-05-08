#!/usr/bin/env python3
"""Validate configuration ownership and stack-boundary rules."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from repo_policy_utils import any_match, changed_files, file_text, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-ref")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    rules = contract["architecture"].get("config_boundary_rules", [])
    touched = changed_files(repo_root, args.base_ref)
    if not rules or not touched:
        print("PASS  config-boundaries: no changed config files to validate")
        return 0

    failures = []
    for rel_path in touched:
        if not rel_path.endswith((".yaml", ".yml")):
            continue
        failures.extend(config_failures(repo_root, rel_path, rules))

    for failure in failures:
        print(f"FAIL  config-boundaries: {failure}")
    if not failures:
        print("PASS  config-boundaries: validated changed config files")
    return 1 if failures else 0


def config_failures(repo_root: Path, rel_path: str, rules: list[dict]) -> list[str]:
    failures = []
    text = file_text(repo_root, rel_path)
    for rule in rules:
        if not any_match(rel_path, rule["paths"]):
            continue
        for forbidden in rule.get("forbidden_references", []):
            if forbidden in text:
                failures.append(
                    f"{rel_path} violates config ownership for {rule['owner']!r} via forbidden reference {forbidden!r}"
                )
    return failures


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
