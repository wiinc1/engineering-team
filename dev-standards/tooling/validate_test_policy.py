#!/usr/bin/env python3
"""Validate repo test-policy controls using test artifacts and changed scope."""

from __future__ import annotations

import argparse
import ast
import datetime as dt
import json
import os
import sys
from pathlib import Path

from repo_policy_utils import any_match, changed_files, diff_added_lines, load_optional_json, parse_date, repo_contract


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--base-ref")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = repo_contract(repo_root)
    policy = contract.get("testing")
    if not policy:
        print("PASS  test-policy: no testing policy configured")
        return 0

    touched = changed_files(repo_root, args.base_ref)
    failures = []
    failures.extend(test_artifact_failures(repo_root, policy))
    failures.extend(test_structure_failures(touched, policy))
    failures.extend(hermeticity_failures(repo_root, touched, policy))
    failures.extend(coverage_failures(repo_root, touched, policy, args.base_ref))
    failures.extend(regression_requirement_failures(touched, policy))
    failures.extend(layer_requirement_failures(repo_root, touched, policy))
    failures.extend(contract_requirement_failures(repo_root, touched, policy))
    failures.extend(artifact_requirement_failures(repo_root, touched, policy, "integration_requirements"))
    failures.extend(artifact_requirement_failures(repo_root, touched, policy, "system_requirements"))
    failures.extend(ephemeral_environment_failures(repo_root, touched, policy))
    failures.extend(test_result_failures(repo_root, policy))
    failures.extend(flaky_registry_failures(repo_root, policy))

    for failure in failures:
        print(f"FAIL  test-policy: {failure}")
    if not failures:
        print(f"PASS  test-policy: validated {len(touched)} changed files")
    return 1 if failures else 0


def test_artifact_failures(repo_root: Path, policy: dict) -> list[str]:
    failures = []
    for label, rel_path in policy.get("artifacts", {}).items():
        if not (repo_root / rel_path).exists():
            failures.append(f"required artifact {label!r} is missing at {rel_path}")
    return failures


def test_result_failures(repo_root: Path, policy: dict) -> list[str]:
    payload = load_optional_json(repo_root / policy["artifacts"]["test_results"])
    return [] if not payload or payload.get("successful", False) else ["test-results artifact reports unsuccessful suite"]


def test_structure_failures(touched: list[str], policy: dict) -> list[str]:
    failures = []
    unit_paths = policy["layers"]["unit"]["paths"]
    naming = policy["layers"]["unit"]["file_patterns"]
    for rel_path in touched:
        if not rel_path.endswith(".py") or not any_match(rel_path, unit_paths):
            continue
        if not any_match(Path(rel_path).name, naming):
            failures.append(f"{rel_path} does not match approved unit test naming")
    return failures


def hermeticity_failures(repo_root: Path, touched: list[str], policy: dict) -> list[str]:
    failures = []
    rules = policy.get("hermeticity", {}).get("unit", {})
    target_paths = rules.get("paths", policy["layers"]["unit"]["paths"])
    forbidden = set(rules.get("forbidden_references", []))
    allowed_paths = rules.get("allow_in_paths", [])
    for rel_path in touched:
        if not rel_path.endswith(".py") or not any_match(rel_path, target_paths):
            continue
        if any_match(rel_path, allowed_paths):
            continue
        violations = forbidden_reference_hits(repo_root / rel_path, forbidden)
        for violation in violations:
            failures.append(f"{rel_path} uses forbidden unit-test reference {violation}")
    return failures


def forbidden_reference_hits(path: Path, forbidden: set[str]) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    aliases = import_aliases(tree)
    hits = []
    for node in ast.walk(tree):
        dotted = dotted_reference(node, aliases)
        if dotted and dotted in forbidden:
            hits.append(dotted)
    return sorted(set(hits))


def import_aliases(tree: ast.AST) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                root = f"{node.module}.{alias.name}"
                aliases[alias.asname or alias.name] = root
    return aliases


def dotted_reference(node: ast.AST, aliases: dict[str, str]) -> str | None:
    if isinstance(node, ast.Call):
        return dotted_reference(node.func, aliases)
    if isinstance(node, ast.Attribute):
        parent = dotted_reference(node.value, aliases)
        return f"{parent}.{node.attr}" if parent else node.attr
    if isinstance(node, ast.Name):
        return aliases.get(node.id, node.id)
    if isinstance(node, ast.Subscript):
        return dotted_reference(node.value, aliases)
    return None


def coverage_failures(repo_root: Path, touched: list[str], policy: dict, base_ref: str | None) -> list[str]:
    coverage_path = repo_root / policy["artifacts"]["coverage"]
    if not coverage_path.exists():
        return []
    payload = json.loads(coverage_path.read_text(encoding="utf-8"))
    failures = []
    totals = payload.get("totals", {})
    percent = float(totals.get("percent_covered", 0.0)) / 100.0
    floor = float(policy["coverage"]["global_floor"])
    if percent < floor:
        failures.append(f"global coverage {percent:.2%} is below required floor {floor:.0%}")

    changed_lines = diff_added_lines(repo_root, base_ref)
    changed_scope = [
        path for path in touched
        if path.endswith(".py")
        and any_match(path, policy["coverage"]["governed_paths"])
        and path in payload.get("files", {})
    ]
    for rel_path in changed_scope:
        file_payload = payload["files"][rel_path]
        measured = set(file_payload.get("executed_lines", [])) | set(file_payload.get("missing_lines", []))
        relevant = changed_lines.get(rel_path, set()) & measured
        if not relevant:
            continue
        executed = set(file_payload.get("executed_lines", []))
        ratio = len(relevant & executed) / len(relevant)
        changed_floor = float(policy["coverage"]["changed_lines_floor"])
        if ratio < changed_floor:
            failures.append(
                f"{rel_path} changed-line coverage {ratio:.2%} is below required floor {changed_floor:.0%}"
            )
    return failures


def regression_requirement_failures(touched: list[str], policy: dict) -> list[str]:
    change_kind = os.environ.get("CHANGE_KIND")
    if change_kind not in set(policy["regression_requirements"]["change_kinds"]):
        return []
    if any(any_match(path, policy["regression_requirements"]["test_paths"]) for path in touched):
        return []
    return [f"change_kind {change_kind!r} requires at least one changed regression test"]


def layer_requirement_failures(repo_root: Path, touched: list[str], policy: dict) -> list[str]:
    failures = []
    for rule in policy.get("layer_requirements", []):
        if not any(any_match(path, rule["when_paths"]) for path in touched):
            continue
        for layer in rule["required_layers"]:
            if layer_artifact_satisfied(repo_root, policy, layer):
                continue
            failures.append(f"required test layer {layer!r} has no successful evidence for touched paths")
    return failures


def layer_artifact_satisfied(repo_root: Path, policy: dict, layer: str) -> bool:
    artifact_map = {"unit": policy["artifacts"]["test_results"], "contract": policy["artifacts"]["contract_report"]}
    artifact_path = artifact_map.get(layer)
    if not artifact_path:
        return False
    payload = load_optional_json(repo_root / artifact_path)
    return bool(payload) and payload.get("successful", False)


def contract_requirement_failures(repo_root: Path, touched: list[str], policy: dict) -> list[str]:
    failures = []
    contract_payload = load_optional_json(repo_root / policy["artifacts"]["contract_report"])
    for rule in policy.get("contract_requirements", []):
        if not any(any_match(path, rule["when_paths"]) for path in touched):
            continue
        if not contract_payload.get("successful", False):
            failures.append("contract-test evidence is required but contract-report is unsuccessful or missing")
            continue
        for evidence in rule["required_evidence"]:
            if evidence != "contract-test-report":
                failures.append(f"unsupported contract evidence requirement {evidence!r}")
    return failures


def artifact_requirement_failures(repo_root: Path, touched: list[str], policy: dict, section: str) -> list[str]:
    failures = []
    for rule in policy.get(section, []):
        if not requirement_applies(rule, touched):
            continue
        payload = load_optional_json(repo_root / rule["artifact"])
        if not payload.get("successful", False):
            failures.append(f"{section[:-13]} evidence is required but {rule['artifact']} is unsuccessful or missing")
    return failures


def requirement_applies(rule: dict, touched: list[str]) -> bool:
    change_kinds = set(rule.get("change_kinds", []))
    current_kind = os.environ.get("CHANGE_KIND")
    if change_kinds and current_kind not in change_kinds:
        return False
    return any(any_match(path, rule["when_paths"]) for path in touched)


def ephemeral_environment_failures(repo_root: Path, touched: list[str], policy: dict) -> list[str]:
    failures = []
    for rule in policy.get("ephemeral_environment_requirements", []):
        if not requirement_applies(rule, touched):
            continue
        payload = load_optional_json(repo_root / rule["artifact"])
        if not payload.get("successful", False):
            failures.append(f"ephemeral environment proof {rule['artifact']!r} is unsuccessful or missing")
    return failures


def flaky_registry_failures(repo_root: Path, policy: dict) -> list[str]:
    registry_path = repo_root / policy["artifacts"]["flaky_registry"]
    if not registry_path.exists():
        return []
    payload = json.loads(registry_path.read_text(encoding="utf-8"))
    quarantined = payload.get("quarantined", [])
    if not quarantined:
        return []
    failures = quarantine_policy_failures(quarantined, policy)
    if failures or quarantine_waived(repo_root, policy):
        return failures
    return [f"flaky registry contains {len(quarantined)} quarantined tests; release-blocking until remediated"]


def quarantine_policy_failures(quarantined: list[dict], policy: dict) -> list[str]:
    failures = []
    quarantine_policy = policy.get("quarantine_policy", {})
    max_age_days = quarantine_policy.get("max_age_days")
    require_owner = quarantine_policy.get("require_owner", False)
    require_reference = quarantine_policy.get("require_reference", False)
    today = dt.date.today()
    for entry in quarantined:
        if not isinstance(entry, dict):
            continue
        if require_owner and not entry.get("owner"):
            failures.append("quarantined flaky test is missing owner")
        if require_reference and not entry.get("reference"):
            failures.append("quarantined flaky test is missing reference")
        if max_age_days is not None and entry.get("quarantined_at"):
            age = today - parse_date(entry["quarantined_at"])
            if age.days > int(max_age_days):
                failures.append(f"quarantined flaky test {entry.get('id', '<unknown>')} exceeds max age {max_age_days} days")
    return failures


def quarantine_waived(repo_root: Path, policy: dict) -> bool:
    quarantine_policy = policy.get("flaky_quarantine", {})
    if not quarantine_policy.get("allow_quarantine_with_valid_waiver", False):
        return False
    waiver_rule = quarantine_policy["waiver_rule"]
    contract = repo_contract(repo_root)
    today = dt.date.today()
    for waiver in contract.get("waivers", []):
        if waiver["rule"] != waiver_rule:
            continue
        if parse_date(waiver["expires_at"]) < today:
            continue
        return True
    return False


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
