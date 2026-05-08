#!/usr/bin/env python3
"""Validate repo-local visual identity governance."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shlex
import sys
from pathlib import Path

from repo_policy_utils import (
    changed_diff_stats,
    changed_files,
    diff_added_lines,
    load_optional_json,
    parse_datetime,
    repo_contract,
)


MATERIAL_SECTIONS = {
    "Accessibility",
    "Agent Usage",
    "Do's and Don'ts",
    "Generated Outputs",
    "Generated Token Outputs",
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
    visual = contract.get("visual_identity") or {}
    failures = visual_identity_failures(repo_root, contract, visual, args.base_ref)

    for failure in failures:
        print(f"FAIL  visual-identity: {failure}")
    if not failures:
        if visual.get("required", False):
            print("PASS  visual-identity: required visual identity policy validated")
        else:
            print("PASS  visual-identity: visual identity not required")
    return 1 if failures else 0


def visual_identity_failures(repo_root: Path, contract: dict, visual: dict, base_ref: str | None) -> list[str]:
    if not visual.get("required", False):
        return []

    failures = []
    design_file = visual.get("file") or "DESIGN.md"
    design_path = repo_root / design_file

    failures.extend(required_field_failures(visual))
    if not design_path.exists():
        failures.append(f"required visual identity file is missing: {design_file}")
    failures.extend(protection_failures(contract, design_file))
    failures.extend(source_of_truth_failures(contract, design_file))
    failures.extend(validator_command_failures(repo_root, visual.get("validator_command", "")))
    failures.extend(review_freshness_failures(visual))
    failures.extend(generated_output_failures(visual))

    if design_path.exists():
        touched = changed_files(repo_root, base_ref)
        if is_material_design_change(repo_root, design_file, touched, base_ref):
            failures.extend(material_approval_failures(repo_root, contract, visual))

    return failures


def required_field_failures(visual: dict) -> list[str]:
    failures = []
    for field in ["file", "validator_command", "owner", "reviewers", "review"]:
        if visual.get(field) in (None, "", []):
            failures.append(f"visual_identity.{field} is required when visual identity is required")
    review = visual.get("review") or {}
    for field in ["cadence_days", "last_reviewed"]:
        if review.get(field) in (None, ""):
            failures.append(f"visual_identity.review.{field} is required when visual identity is required")
    return failures


def protection_failures(contract: dict, design_file: str) -> list[str]:
    protected_paths = contract.get("directories", {}).get("protected_paths", [])
    if design_file not in protected_paths:
        return [f"{design_file} must be listed in directories.protected_paths"]
    return []


def source_of_truth_failures(contract: dict, design_file: str) -> list[str]:
    source_of_truth = contract.get("architecture", {}).get("source_of_truth", [])
    if design_file not in source_of_truth:
        return [f"{design_file} must be listed in architecture.source_of_truth"]
    return []


def validator_command_failures(repo_root: Path, command: str) -> list[str]:
    if not command.strip():
        return []
    parts = shlex.split(command)
    if len(parts) >= 3 and parts[0] == "npm" and parts[1] == "run":
        package_path = repo_root / "package.json"
        if not package_path.exists():
            return [f"validator command {command!r} requires package.json"]
        package = json.loads(package_path.read_text(encoding="utf-8"))
        scripts = package.get("scripts", {})
        if parts[2] not in scripts:
            return [f"validator command references missing npm script {parts[2]!r}"]
    return []


def review_freshness_failures(visual: dict) -> list[str]:
    review = visual.get("review") or {}
    cadence_days = review.get("cadence_days")
    last_reviewed = review.get("last_reviewed")
    if not cadence_days or not last_reviewed:
        return []
    try:
        reviewed = dt.date.fromisoformat(str(last_reviewed))
    except ValueError:
        return [f"visual_identity.review.last_reviewed {last_reviewed!r} must be YYYY-MM-DD"]
    deadline = reviewed + dt.timedelta(days=int(cadence_days))
    if deadline < dt.date.today():
        return [f"visual identity review is stale; last reviewed {reviewed.isoformat()}, cadence {cadence_days} days"]
    return []


def generated_output_failures(visual: dict) -> list[str]:
    generated = visual.get("generated_outputs")
    if not generated:
        return []
    strategy = generated.get("strategy")
    if strategy == "committed":
        failures = []
        if not generated.get("paths"):
            failures.append("visual_identity.generated_outputs.paths is required for committed generated outputs")
        if not generated.get("drift_check_command"):
            failures.append(
                "visual_identity.generated_outputs.drift_check_command is required for committed generated outputs"
            )
        return failures
    if strategy == "build-time" and not generated.get("build_command"):
        return ["visual_identity.generated_outputs.build_command is required for build-time generated outputs"]
    return []


def is_material_design_change(repo_root: Path, design_file: str, touched: list[str], base_ref: str | None) -> bool:
    if design_file not in touched:
        return False

    added_lines = diff_added_lines(repo_root, base_ref).get(design_file, set())
    stats = changed_diff_stats(repo_root, base_ref)
    if not added_lines:
        return stats.get(design_file, 0) > 0 or design_file not in stats

    ranges = material_line_ranges((repo_root / design_file).read_text(encoding="utf-8"))
    return any(any(start <= line <= end for start, end in ranges) for line in added_lines)


def material_line_ranges(text: str) -> list[tuple[int, int]]:
    lines = text.splitlines()
    ranges: list[tuple[int, int]] = []
    front_matter_end = front_matter_end_line(lines)
    if front_matter_end:
        ranges.append((1, front_matter_end))

    headings = []
    for index, line in enumerate(lines, start=1):
        if line.startswith("## "):
            headings.append((index, line[3:].strip()))
    for heading_index, (start, title) in enumerate(headings):
        if title not in MATERIAL_SECTIONS:
            continue
        end = headings[heading_index + 1][0] - 1 if heading_index + 1 < len(headings) else len(lines)
        ranges.append((start, end))
    return ranges


def front_matter_end_line(lines: list[str]) -> int | None:
    if not lines or lines[0].strip() != "---":
        return None
    for index, line in enumerate(lines[1:], start=2):
        if line.strip() == "---":
            return index
    return len(lines)


def material_approval_failures(repo_root: Path, contract: dict, visual: dict) -> list[str]:
    policy = contract.get("change_management", {})
    sources = policy.get("approval_sources", {})
    if not live_approval_required(sources):
        return []

    reviewers = set(visual.get("reviewers") or [])
    if not reviewers:
        owner = contract.get("ownership", {}).get("primary_owner")
        reviewers = {owner} if owner else set()
    if not reviewers:
        return ["material DESIGN.md changes require at least one visual identity reviewer"]

    mode = sources.get("mode", "artifact")
    if mode == "github":
        return github_mode_failures(sources, reviewers)
    if mode != "artifact":
        return []
    return artifact_approval_failures(repo_root, sources, reviewers)


def live_approval_required(sources: dict) -> bool:
    if not sources.get("require_live_in_ci", False):
        return False
    return os.environ.get("GITHUB_EVENT_NAME") in sources.get("ci_event_names", [])


def github_mode_failures(sources: dict, reviewers: set[str]) -> list[str]:
    if not os.environ.get("GITHUB_ACTIONS"):
        return []
    if not os.environ.get("GITHUB_TOKEN"):
        return ["GITHUB_TOKEN is required in CI for visual identity reviewer approval validation"]
    required = sorted(reviewers)
    return [f"visual identity reviewer approval for {required!r} must be enforced by the GitHub live approval gate"]


def artifact_approval_failures(repo_root: Path, sources: dict, reviewers: set[str]) -> list[str]:
    artifact_path = sources.get("live_artifact", ".artifacts/live-approval.json")
    payload = load_optional_json(repo_root / artifact_path)
    if not payload:
        return [f"missing live approval artifact {artifact_path!r} for material DESIGN.md change"]

    head_sha = os.environ.get("GITHUB_SHA")
    if head_sha and payload.get("head_sha") != head_sha:
        return [f"live approval artifact head_sha {payload.get('head_sha')!r} does not match {head_sha!r}"]

    approved = approved_reviewers(payload.get("reviews", []), head_sha, sources.get("required_review_state", "APPROVED"))
    if not reviewers & approved:
        return [f"material DESIGN.md change lacks approved review from visual identity reviewer {sorted(reviewers)!r}"]
    return []


def approved_reviewers(reviews: list[dict], head_sha: str | None, required_state: str) -> set[str]:
    approved = set()
    for review in reviews:
        if review.get("state") != required_state:
            continue
        if head_sha and review.get("commit_id") not in {None, head_sha}:
            continue
        try:
            parse_datetime(review["submitted_at"])
        except (KeyError, ValueError):
            continue
        reviewer = review.get("user")
        if isinstance(reviewer, dict):
            reviewer = reviewer.get("login")
        if reviewer:
            approved.add(reviewer)
    return approved


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
