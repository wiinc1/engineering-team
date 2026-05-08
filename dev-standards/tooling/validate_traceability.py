#!/usr/bin/env python3
"""Validate live traceability evidence for non-local references."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from repo_policy_utils import (
    existing_paths,
    github_api_json,
    load_optional_json,
    parse_github_reference,
    repo_contract,
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    policy = contract["change_management"]
    metadata = load_metadata(repo_root, policy["metadata_file"])

    failures = ci_context_failures(metadata, policy)
    if not failures:
        failures = traceability_failures(repo_root, metadata, policy)
    for failure in failures:
        print(f"FAIL  traceability: {failure}")
    if not failures:
        print(f"PASS  traceability: validated reference {metadata['reference']!r}")
    return 1 if failures else 0


def load_metadata(repo_root: Path, metadata_file: str) -> dict:
    path = repo_root / metadata_file
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "reference": os.environ.get("CHANGE_REFERENCE", ""),
        "change_kind": os.environ.get("CHANGE_KIND"),
    }


def traceability_failures(repo_root: Path, metadata: dict, policy: dict) -> list[str]:
    reference = metadata["reference"]
    rule = matching_rule(reference, policy["reference_rules"])
    if rule is not None:
        return rule_traceability_failures(repo_root, reference, metadata.get("change_kind"), rule, policy)
    return [f"reference {reference!r} does not match any allowed rule"]


def ci_context_failures(metadata: dict, policy: dict) -> list[str]:
    if not os.environ.get("GITHUB_ACTIONS"):
        return []
    if os.environ.get("GITHUB_EVENT_NAME") not in policy.get("traceability_sources", {}).get("ci_event_names", []):
        return []
    reference = metadata.get("reference")
    rule = matching_rule(reference or "", policy["reference_rules"])
    if not rule or rule.get("source") != "github":
        return []
    failures = []
    if not os.environ.get("GITHUB_TOKEN"):
        failures.append("GITHUB_TOKEN is required in CI for github traceability validation")
    if not reference:
        failures.append("CHANGE_REFERENCE is required in CI for github traceability validation")
    return failures


def matching_rule(reference: str, rules: list[dict]) -> dict | None:
    for rule in rules:
        if re.match(rule["pattern"], reference) is not None:
            return rule
    return None


def rule_traceability_failures(
    repo_root: Path,
    reference: str,
    change_kind: str | None,
    rule: dict,
    policy: dict,
) -> list[str]:
    failures = rule_policy_failures(reference, change_kind, rule)
    if failures:
        return failures
    failures = local_reference_failures(repo_root, reference, rule)
    if failures or not live_check_required(rule, policy):
        return failures
    return live_reference_failures(repo_root, reference, rule, policy)


def rule_policy_failures(reference: str, change_kind: str | None, rule: dict) -> list[str]:
    allowed_change_kinds = set(rule.get("allowed_change_kinds", []))
    if allowed_change_kinds and change_kind not in allowed_change_kinds:
        return [f"reference {reference!r} is not allowed for change_kind {change_kind!r}"]
    return []


def local_reference_failures(repo_root: Path, reference: str, rule: dict) -> list[str]:
    file_globs = [pattern.replace("{reference}", reference) for pattern in rule.get("require_existing_file_globs", [])]
    if file_globs and not existing_paths(repo_root, file_globs):
        return [f"reference {reference!r} must resolve to an existing tracked artifact"]
    return []


def live_check_required(rule: dict, policy: dict) -> bool:
    if rule.get("source") == "github":
        return os.environ.get("GITHUB_EVENT_NAME") in policy.get("traceability_sources", {}).get("ci_event_names", [])
    if not rule.get("live_in_ci", False):
        return False
    event_name = os.environ.get("GITHUB_EVENT_NAME")
    return event_name in policy.get("traceability_sources", {}).get("ci_event_names", [])


def live_reference_failures(repo_root: Path, reference: str, rule: dict, policy: dict) -> list[str]:
    if rule.get("source") == "github":
        return github_reference_failures(reference, rule)
    traceability_path = repo_root / policy["traceability_sources"]["live_artifact"]
    payload = load_optional_json(traceability_path)
    if not payload:
        rel_path = traceability_path.relative_to(repo_root).as_posix()
        return [f"missing live traceability artifact {rel_path!r}"]

    entry = matching_reference_entry(reference, payload.get("references", []))
    if entry is None:
        return [f"live traceability artifact does not contain reference {reference!r}"]
    return entry_failures(reference, entry, rule)


def matching_reference_entry(reference: str, entries: list[dict]) -> dict | None:
    for entry in entries:
        if entry.get("reference") == reference:
            return entry
    return None


def entry_failures(reference: str, entry: dict, rule: dict) -> list[str]:
    if not entry.get("exists", False):
        return [f"live traceability entry for {reference!r} reports does not exist"]
    failures = kind_and_state_failures(reference, entry.get("kind"), entry.get("state"), rule)
    if failures:
        return failures
    return []


def kind_and_state_failures(reference: str, kind: str | None, state: str | None, rule: dict) -> list[str]:
    required_kind = rule.get("required_kind")
    if required_kind and kind != required_kind:
        return [f"reference {reference!r} kind {kind!r} does not satisfy required_kind {required_kind!r}"]
    allowed_kinds = set(rule.get("allowed_kinds", []))
    if allowed_kinds and kind not in allowed_kinds:
        return [f"reference {reference!r} kind {kind!r} is not allowed by policy"]
    required_states = set(rule.get("required_states", []))
    if required_states and state not in required_states:
        return [f"reference {reference!r} state {state!r} is not in {sorted(required_states)!r}"]
    return []


def github_reference_failures(reference: str, rule: dict) -> list[str]:
    token = os.environ.get("GITHUB_TOKEN")
    parsed = parse_github_reference(reference)
    if not token:
        return ["GITHUB_TOKEN is required for github traceability validation"]
    if parsed is None:
        return [f"reference {reference!r} is not a GitHub issue or pull URL"]

    api_root = f"https://api.github.com/repos/{parsed['owner']}/{parsed['repo']}"
    if parsed["kind"] == "pull":
        pull = github_api_json(f"{api_root}/pulls/{parsed['number']}", token)
        state = "merged" if pull.get("merged_at") else pull.get("state")
        kind = "pull"
    else:
        issue = github_api_json(f"{api_root}/issues/{parsed['number']}", token)
        state = issue.get("state")
        kind = "issue"
    return kind_and_state_failures(reference, kind, state, rule)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
