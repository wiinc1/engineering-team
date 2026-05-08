#!/usr/bin/env python3
"""Validate change metadata, traceability, and provenance against repo policy."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

from repo_policy_utils import (
    agent_policy,
    any_match,
    bool_from_value,
    changed_diff_stats,
    changed_files,
    existing_paths,
    repo_contract,
)


RISK_ORDER = {"low": 0, "medium": 1, "high": 2, "critical": 3}
REVIEW_MODE_ORDER = {
    "automated-only": 0,
    "human-approve": 1,
    "human-plus-evidence": 2,
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-ref")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    agent_rules = agent_policy(repo_root)
    touched = changed_files(repo_root, args.base_ref)
    policy = contract["change_management"]
    if not requires_metadata(touched, policy["required_when_paths"]):
        print("PASS  change-metadata: no changed files requiring metadata")
        return 0

    metadata = load_metadata(repo_root, policy["metadata_file"])
    failures = validate_metadata(repo_root, metadata, touched, policy, agent_rules)

    for failure in failures:
        print(f"FAIL  change-metadata: {failure}")
    if not failures:
        print(f"PASS  change-metadata: validated {len(touched)} changed files")
    return 1 if failures else 0


def requires_metadata(touched: list[str], patterns: list[str]) -> bool:
    return any(any_match(path, patterns) for path in touched)


def load_metadata(repo_root: Path, metadata_file: str) -> dict:
    path = repo_root / metadata_file
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return metadata_from_env()


def metadata_from_env() -> dict:
    return {
        "change_kind": os.environ.get("CHANGE_KIND"),
        "risk": os.environ.get("CHANGE_RISK"),
        "reversibility": os.environ.get("CHANGE_REVERSIBILITY"),
        "reference": os.environ.get("CHANGE_REFERENCE"),
        "review_mode": os.environ.get("CHANGE_REVIEW_MODE"),
        "provenance": os.environ.get("CHANGE_PROVENANCE"),
        "human_instruction": os.environ.get("CHANGE_HUMAN_INSTRUCTION"),
        "commands": split_csv(os.environ.get("CHANGE_COMMANDS")),
        "evidence": split_csv(os.environ.get("CHANGE_EVIDENCE")),
    }


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def validate_metadata(
    repo_root: Path,
    metadata: dict,
    touched: list[str],
    policy: dict,
    agent_rules: dict,
) -> list[str]:
    failures = []
    failures.extend(missing_required_fields(metadata, policy["required_fields"]))
    if failures:
        return failures

    failures.extend(metadata_value_failures(metadata, policy))
    if failures:
        return failures

    failures.extend(reference_failures(repo_root, metadata, policy))
    failures.extend(change_kind_rule_failures(metadata, policy))
    failures.extend(stricter_review_failures(metadata, touched, policy["stricter_review_rules"]))
    failures.extend(provenance_failures(metadata, policy["provenance_rules"]))
    failures.extend(agent_policy_failures(repo_root, metadata, touched, agent_rules))
    failures.extend(reversibility_failures(metadata))
    return failures


def missing_required_fields(metadata: dict, required_fields: list[str]) -> list[str]:
    failures = []
    for field in required_fields:
        value = metadata.get(field)
        if value is None or value == "":
            failures.append(f"missing required metadata field {field!r}")
    return failures


def metadata_value_failures(metadata: dict, policy: dict) -> list[str]:
    failures = []
    change_kind = metadata["change_kind"]
    risk = metadata["risk"]
    review_mode = metadata["review_mode"]
    reversibility = metadata["reversibility"]

    if change_kind not in policy["allowed_change_kinds"]:
        failures.append(
            f"change_kind must be one of {policy['allowed_change_kinds']}, got {change_kind!r}"
        )
    if risk not in RISK_ORDER:
        failures.append(f"risk must be one of {list(RISK_ORDER)}, got {risk!r}")
    if review_mode not in REVIEW_MODE_ORDER:
        failures.append(f"review_mode must be one of {list(REVIEW_MODE_ORDER)}, got {review_mode!r}")
    if reversibility not in {"reversible", "conditionally-reversible", "irreversible"}:
        failures.append("reversibility must be reversible, conditionally-reversible, or irreversible")
    return failures


def reference_failures(repo_root: Path, metadata: dict, policy: dict) -> list[str]:
    reference = metadata["reference"]
    for rule in policy["reference_rules"]:
        if re.match(rule["pattern"], reference) is None:
            continue
        return reference_resolution_failures(repo_root, reference, rule)
    return [f"reference {reference!r} does not match any allowed reference rule"]


def reference_resolution_failures(repo_root: Path, reference: str, rule: dict) -> list[str]:
    patterns = [pattern.replace("{reference}", reference) for pattern in rule.get("require_existing_file_globs", [])]
    if not patterns:
        return []
    if existing_paths(repo_root, patterns):
        return []
    return [f"reference {reference!r} must resolve to an existing tracked artifact"]


def change_kind_rule_failures(metadata: dict, policy: dict) -> list[str]:
    change_kind = metadata["change_kind"]
    reference = metadata["reference"]
    for rule in policy.get("change_kind_rules", []):
        if rule["change_kind"] != change_kind:
            continue
        allowed = tuple(rule["allowed_reference_prefixes"])
        if not reference.startswith(allowed):
            return [f"change_kind {change_kind!r} requires reference prefix in {rule['allowed_reference_prefixes']}"]
        return []
    return []


def stricter_review_failures(metadata: dict, touched: list[str], rules: list[dict]) -> list[str]:
    failures = []
    risk = metadata["risk"]
    review_mode = metadata["review_mode"]
    human_instruction = bool_from_value(metadata.get("human_instruction"))
    for rule in rules:
        if not any(any_match(path, rule["when_paths"]) for path in touched):
            continue
        failures.extend(minimums_failures(risk, review_mode, rule))
        if rule.get("require_human_instruction") and not human_instruction:
            failures.append("explicit human instruction is required for touched protected paths")
    return failures


def minimums_failures(risk: str, review_mode: str, rule: dict) -> list[str]:
    failures = []
    if REVIEW_MODE_ORDER[review_mode] < REVIEW_MODE_ORDER[rule["minimum_review_mode"]]:
        failures.append(
            f"review_mode {review_mode!r} is below required {rule['minimum_review_mode']!r} for touched protected paths"
        )
    if RISK_ORDER[risk] < RISK_ORDER[rule["minimum_risk"]]:
        failures.append(
            f"risk {risk!r} is below required {rule['minimum_risk']!r} for touched protected paths"
        )
    return failures


def provenance_failures(metadata: dict, rules: list[dict]) -> list[str]:
    provenance = metadata["provenance"]
    for rule in rules:
        if provenance == rule["provenance"]:
            return missing_evidence_failures(metadata, provenance, rule["require_evidence"])
    return []


def missing_evidence_failures(metadata: dict, provenance: str, fields: list[str]) -> list[str]:
    failures = []
    for field in fields:
        if not metadata.get(field):
            failures.append(f"provenance {provenance!r} requires non-empty {field!r}")
    return failures


def agent_policy_failures(repo_root: Path, metadata: dict, touched: list[str], policy: dict) -> list[str]:
    failures = []
    provenance = metadata["provenance"]
    human_instruction = bool_from_value(metadata.get("human_instruction"))
    if provenance in {"agent", "human-assisted-agent"}:
        if any(any_match(path, policy["explicit_instruction_paths"]) for path in touched) and not human_instruction:
            failures.append("explicit human instruction is required for touched explicit-instruction paths")
    if provenance == "agent":
        if any(any_match(path, policy["ai_safe_change"]["forbidden_paths"]) for path in touched):
            failures.append("agent-authored change touches ai-safe forbidden paths")
        failures.extend(ai_safe_diff_failures(repo_root, touched, policy["ai_safe_change"]))
    return failures


def ai_safe_diff_failures(repo_root: Path, touched: list[str], policy: dict) -> list[str]:
    failures = []
    if len(touched) > int(policy["max_files"]):
        failures.append(f"agent-authored diff touches {len(touched)} files, above max_files {policy['max_files']}")
    diff_stats = changed_diff_stats(repo_root)
    total_lines = sum(diff_stats.get(path, 0) for path in touched)
    if total_lines > int(policy["max_lines"]):
        failures.append(
            f"agent-authored diff changes {total_lines} lines, above max_lines {policy['max_lines']}"
        )
    return failures


def reversibility_failures(metadata: dict) -> list[str]:
    if metadata["reversibility"] == "irreversible" and metadata["review_mode"] != "human-plus-evidence":
        return ["irreversible changes require review_mode 'human-plus-evidence'"]
    return []


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
