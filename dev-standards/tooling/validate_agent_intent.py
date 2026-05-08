#!/usr/bin/env python3
"""Validate inferred agent task intent against agent policy."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from repo_policy_utils import agent_policy, any_match, changed_files, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-ref")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    touched = changed_files(repo_root, args.base_ref)
    if not touched:
        print("PASS  agent-intent: no changed files to validate")
        return 0

    metadata = load_metadata(repo_root / repo_contract(repo_root)["change_management"]["metadata_file"])
    failures = agent_intent_failures(touched, metadata, agent_policy(repo_root))
    for failure in failures:
        print(f"FAIL  agent-intent: {failure}")
    if not failures:
        print(f"PASS  agent-intent: validated {len(touched)} changed files")
    return 1 if failures else 0


def load_metadata(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "change_kind": os.environ.get("CHANGE_KIND"),
        "provenance": os.environ.get("CHANGE_PROVENANCE"),
        "review_mode": os.environ.get("CHANGE_REVIEW_MODE"),
    }


def agent_intent_failures(touched: list[str], metadata: dict, policy: dict) -> list[str]:
    provenance = metadata.get("provenance")
    if provenance not in {"agent", "human-assisted-agent"}:
        return []

    failures = []
    inferred_tasks = infer_tasks(touched, metadata.get("change_kind"), policy)
    allowed_modes = {entry["task"]: entry["mode"] for entry in policy.get("allowed_to_automate", [])}
    required_review_modes = policy.get("review_mode_requirements_by_task", {})
    never_change_kinds = set(policy.get("never_automated_change_kinds", []))
    if provenance == "agent" and metadata.get("change_kind") in never_change_kinds:
        failures.append(f"change_kind {metadata.get('change_kind')!r} is never automated")

    for task in inferred_tasks:
        mode = allowed_modes.get(task)
        if mode == "never-automated":
            failures.append(f"inferred task {task!r} is never automated")
        elif provenance == "agent" and mode == "human-in-the-loop":
            failures.append(f"inferred task {task!r} requires human-in-the-loop and cannot be agent-only")
        failures.extend(review_mode_failures(task, metadata.get("review_mode"), required_review_modes))
    return failures


def review_mode_failures(task: str, review_mode: str | None, required_review_modes: dict) -> list[str]:
    minimum = required_review_modes.get(task)
    if not minimum:
        return []
    order = {"automated-only": 0, "human-approve": 1, "human-plus-evidence": 2}
    if review_mode not in order:
        return [f"review_mode {review_mode!r} is invalid for inferred task {task!r}"]
    if order[review_mode] < order[minimum]:
        return [f"inferred task {task!r} requires review_mode {minimum!r} or stronger"]
    return []


def infer_tasks(touched: list[str], change_kind: str | None, policy: dict) -> set[str]:
    tasks = set()
    for rule in policy.get("path_task_map", []):
        if any(any_match(path, rule["when_paths"]) for path in touched):
            tasks.add(rule["task"])
    if change_kind:
        tasks.update(policy.get("change_kind_task_map", {}).get(change_kind, []))
    return tasks


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
