#!/usr/bin/env python3
"""Validate live approval proof for CI-backed protected-path changes."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from repo_policy_utils import (
    any_match,
    changed_files,
    github_api_json,
    load_optional_json,
    parse_datetime,
    parse_github_reference,
    repo_contract,
)


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
        print("PASS  live-approval: no changed files to validate")
        return 0

    policy = contract["change_management"]
    mode = approval_mode(policy)
    if mode == "local" or not requires_live_approval(policy, mode):
        print("PASS  live-approval: live approval not required in this context")
        return 0

    metadata = load_metadata(repo_root, policy["metadata_file"])
    if not approval_scope_requires_live_check(touched, metadata, policy):
        print("PASS  live-approval: no changed scope requires live approval")
        return 0

    failures = ci_context_failures(metadata, policy, mode)
    if not failures:
        failures = live_approval_failures(repo_root, metadata, policy, contract["ownership"]["primary_owner"], mode)
    for failure in failures:
        print(f"FAIL  live-approval: {failure}")
    if not failures:
        print("PASS  live-approval: live approval evidence validated")
    return 1 if failures else 0


def approval_mode(policy: dict) -> str:
    return policy.get("approval_sources", {}).get("mode", "artifact")


def requires_live_approval(policy: dict, mode: str) -> bool:
    if mode not in {"artifact", "github"}:
        return False
    sources = policy.get("approval_sources", {})
    if not sources.get("require_live_in_ci", False):
        return False
    return os.environ.get("GITHUB_EVENT_NAME") in sources.get("ci_event_names", [])


def load_metadata(repo_root: Path, metadata_file: str) -> dict:
    path = repo_root / metadata_file
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {
        "change_kind": os.environ.get("CHANGE_KIND"),
        "reference": os.environ.get("CHANGE_REFERENCE"),
    }


def approval_scope_requires_live_check(touched: list[str], metadata: dict, policy: dict) -> bool:
    for rule in policy.get("approval_rules", []):
        if metadata.get("change_kind") not in rule["change_kinds"]:
            continue
        if any(any_match(path, rule["when_paths"]) for path in touched):
            return True
    return False


def live_approval_failures(repo_root: Path, metadata: dict, policy: dict, primary_owner: str, mode: str) -> list[str]:
    if mode == "github":
        return github_approval_failures(metadata, policy, primary_owner)
    return artifact_approval_failures(repo_root, primary_owner, policy["approval_sources"])


def ci_context_failures(metadata: dict, policy: dict, mode: str) -> list[str]:
    if not os.environ.get("GITHUB_ACTIONS"):
        return []
    if mode != "github" or not requires_live_approval(policy, mode):
        return []
    failures = []
    if not os.environ.get("GITHUB_TOKEN"):
        failures.append("GITHUB_TOKEN is required in CI for github approval validation")
    if os.environ.get("GITHUB_EVENT_NAME") == "pull_request" and not metadata.get("reference"):
        failures.append("CHANGE_REFERENCE is required in CI for github approval validation")
    if policy["approval_sources"].get("require_current_head_sha", False) and not os.environ.get("GITHUB_SHA"):
        failures.append("GITHUB_SHA is required in CI when current-head approval validation is enabled")
    return failures


def artifact_approval_failures(repo_root: Path, primary_owner: str, sources: dict) -> list[str]:
    payload = load_optional_json(repo_root / sources["live_artifact"])
    if not payload:
        return [f"missing live approval artifact {sources['live_artifact']!r}"]

    head_sha = os.environ.get("GITHUB_SHA")
    if head_sha and payload.get("head_sha") != head_sha:
        return [f"live approval artifact head_sha {payload.get('head_sha')!r} does not match {head_sha!r}"]

    approved_reviews = approved_reviewers(payload.get("reviews", []), head_sha)
    if primary_owner not in approved_reviews:
        return [f"live approval artifact does not contain an APPROVED review from {primary_owner!r}"]
    return []


def github_approval_failures(metadata: dict, policy: dict, primary_owner: str) -> list[str]:
    token = os.environ.get("GITHUB_TOKEN")
    reference = parse_github_reference(metadata.get("reference", ""))
    if not token:
        return ["GITHUB_TOKEN is required for github approval validation"]
    if reference is None or reference["kind"] != "pull":
        return [f"reference {metadata.get('reference')!r} is not a GitHub pull request URL"]

    api_root = f"https://api.github.com/repos/{reference['owner']}/{reference['repo']}"
    pull = github_api_json(f"{api_root}/pulls/{reference['number']}", token)
    reviews = github_api_json(f"{api_root}/pulls/{reference['number']}/reviews", token)
    head_sha = pull["head"]["sha"]
    required_state = policy["approval_sources"].get("required_review_state", "APPROVED")
    required_approvers = set(policy["approval_sources"].get("required_approvers", [primary_owner]))
    if policy["approval_sources"].get("require_current_head_sha", False):
        failures = current_head_sha_failures(head_sha)
        if failures:
            return failures
    approved = approved_reviewers(reviews, head_sha, required_state)
    if not required_approvers & approved:
        return [f"live GitHub reviews do not contain {required_state!r} from any required approver {sorted(required_approvers)!r}"]
    return []


def current_head_sha_failures(head_sha: str) -> list[str]:
    current_sha = os.environ.get("GITHUB_SHA")
    if current_sha and current_sha != head_sha:
        return [f"pull request head_sha {head_sha!r} does not match current sha {current_sha!r}"]
    return []


def approved_reviewers(reviews: list[dict], head_sha: str | None, required_state: str = "APPROVED") -> set[str]:
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
