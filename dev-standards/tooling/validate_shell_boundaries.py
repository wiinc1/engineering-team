#!/usr/bin/env python3
"""Validate shell automation files against configured command boundaries."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from repo_policy_utils import any_match, changed_files, file_text, repo_contract


COMMAND_RE = re.compile(r"^\s*([A-Za-z0-9_.-]+)\b")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-ref")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    rules = contract["architecture"].get("shell_command_rules", [])
    touched = changed_files(repo_root, args.base_ref)
    if not rules or not touched:
        print("PASS  shell-boundaries: no changed shell files to validate")
        return 0

    failures = []
    for rel_path in touched:
        if not rel_path.endswith(".sh"):
            continue
        failures.extend(shell_failures(repo_root, rel_path, rules))

    for failure in failures:
        print(f"FAIL  shell-boundaries: {failure}")
    if not failures:
        print("PASS  shell-boundaries: validated changed shell files")
    return 1 if failures else 0


def shell_failures(repo_root: Path, rel_path: str, rules: list[dict]) -> list[str]:
    failures = []
    text = file_text(repo_root, rel_path)
    commands = extracted_commands(text)
    for rule in rules:
        if not any_match(rel_path, rule["paths"]):
            continue
        if any_match(rel_path, rule.get("allowed_in", [])):
            continue
        forbidden = set(rule["forbidden_commands"])
        for command in commands:
            if command in forbidden:
                failures.append(f"{rel_path} uses forbidden shell command {command!r}: {rule['description']}")
    return failures


def extracted_commands(text: str) -> set[str]:
    commands = set()
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = COMMAND_RE.match(line)
        if match:
            commands.add(match.group(1))
    return commands


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
