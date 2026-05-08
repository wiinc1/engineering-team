#!/usr/bin/env python3
"""Maintainability checker for standards v0.1."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from maintainability_core import (
    FileEvaluation,
    evaluate_static_thresholds,
    file_metrics,
    get_thresholds,
    governed_files,
    is_noncompliant,
    list_changed_files,
    load_repo_contract,
    maintainability_scope,
    metric_value,
    read_file_text,
    read_git_file,
)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".", help="Repository root.")
    parser.add_argument("--repo-contract", default="repo-contract.yaml", help="Repo contract path.")
    parser.add_argument("--base-ref", help="Git ref used for ratchet evaluation.")
    parser.add_argument("--files", nargs="*", help="Optional explicit file list.")
    return parser.parse_args(argv)


def gather_files(args: argparse.Namespace, repo_root: Path) -> list[Path]:
    if args.files:
        return [repo_root / relative for relative in args.files]
    if args.base_ref:
        return list_changed_files(repo_root, args.base_ref)
    return [path for path in repo_root.rglob("*") if path.is_file()]


def previous_metrics(path: Path, rel_path: str, thresholds: dict, repo_root: Path, base_ref: str | None):
    if base_ref is None:
        return None
    previous_text = read_git_file(repo_root, base_ref, rel_path)
    if previous_text is None:
        return None
    return file_metrics(path, rel_path, previous_text, thresholds)


def ratchet_failures(
    failures: list[str],
    regressions: list[str],
    improvements: list[str],
) -> list[str]:
    result = list(failures)
    if regressions:
        result.extend(regressions)
    message = (
        "noncompliant legacy file still exceeds limits and requires a waiver"
        if improvements
        else "noncompliant legacy file did not improve any protected maintainability signal"
    )
    result.append(message)
    return result


def ratchet_evaluation(
    current,
    previous,
    failures: list[str],
    warnings: list[str],
    protected_signals: list[str],
) -> FileEvaluation:
    regressions = []
    improvements = []
    for signal in protected_signals:
        current_value = metric_value(current, signal)
        previous_value = metric_value(previous, signal)
        if current_value > previous_value:
            regressions.append(f"{signal} regressed from {previous_value} to {current_value}")
        elif current_value < previous_value:
            improvements.append(f"{signal} improved from {previous_value} to {current_value}")
    return FileEvaluation(current.path, warnings, ratchet_failures(failures, regressions, improvements))


def evaluate_file(
    path: Path,
    rel_path: str,
    text: str,
    thresholds: dict,
    protected_signals: list[str],
    repo_root: Path,
    base_ref: str | None,
) -> FileEvaluation:
    current = file_metrics(path, rel_path, text, thresholds)
    failures, warnings = evaluate_static_thresholds(current, path, thresholds)
    previous = previous_metrics(path, rel_path, thresholds, repo_root, base_ref)

    if previous is None or not failures or not is_noncompliant(previous, path, thresholds):
        return FileEvaluation(rel_path, warnings, failures)
    return ratchet_evaluation(current, previous, failures, warnings, protected_signals)


def print_messages(level: str, path: str, messages: list[str]) -> int:
    for message in messages:
        print(f"{level}  {path}: {message}")
    return len(messages)


def print_evaluations(evaluations: list[FileEvaluation]) -> tuple[int, int]:
    total_warnings = 0
    total_failures = 0
    for evaluation in evaluations:
        total_warnings += print_messages("WARN", evaluation.path, evaluation.warnings)
        total_failures += print_messages("FAIL", evaluation.path, evaluation.failures)
    return total_warnings, total_failures


def advisory_warnings(repo_root: Path, contract: dict, rel_path: str, text: str) -> list[str]:
    warnings = []
    warnings.extend(duplication_warnings(contract, rel_path, text))
    warnings.extend(hotspot_warnings(repo_root, contract, rel_path))
    warnings.extend(repeated_waiver_warnings(contract, rel_path))
    return warnings


def advisory_failures(repo_root: Path, contract: dict, rel_path: str, text: str) -> list[str]:
    failures = []
    failures.extend(duplication_failures(contract, rel_path, text))
    failures.extend(hotspot_failures(repo_root, contract, rel_path))
    failures.extend(repeated_waiver_failures(contract, rel_path))
    return failures


def duplication_warnings(contract: dict, rel_path: str, text: str) -> list[str]:
    policy = contract["maintainability"].get("duplication")
    if not policy or not rel_path.endswith(".py"):
        return []
    threshold = int(policy["warning_block_lines"])
    repeated = repeated_block_count(text.splitlines(), threshold)
    if repeated == 0:
        return []
    return [f"detected {repeated} duplicate code blocks of at least {threshold} lines"]


def duplication_failures(contract: dict, rel_path: str, text: str) -> list[str]:
    policy = contract["maintainability"].get("duplication")
    if not policy or not rel_path.endswith(".py"):
        return []
    threshold = int(policy.get("hard_fail_block_lines", 0))
    if threshold <= 0:
        return []
    repeated = repeated_block_count(text.splitlines(), threshold)
    if repeated == 0:
        return []
    return [f"detected {repeated} duplicate code blocks of at least {threshold} lines"]


def repeated_block_count(lines: list[str], block_size: int) -> int:
    normalized = [line.strip() for line in lines if line.strip()]
    seen = {}
    repeated = 0
    for index in range(len(normalized) - block_size + 1):
        block = tuple(normalized[index:index + block_size])
        if seen.get(block):
            repeated += 1
        seen[block] = True
    return repeated


def hotspot_warnings(repo_root: Path, contract: dict, rel_path: str) -> list[str]:
    policy = contract["maintainability"].get("hotspots")
    if not policy:
        return []
    touches = hotspot_touch_count(repo_root, rel_path, policy["history_window"])
    if touches <= int(policy["warning_touches"]):
        return []
    return [f"file touched {touches} times in last {policy['history_window']} commits"]


def hotspot_failures(repo_root: Path, contract: dict, rel_path: str) -> list[str]:
    policy = contract["maintainability"].get("hotspots")
    if not policy:
        return []
    touches = hotspot_touch_count(repo_root, rel_path, policy["history_window"])
    if touches <= int(policy.get("hard_fail_touches", 0)):
        return []
    return [f"file touched {touches} times in last {policy['history_window']} commits"]


def repeated_waiver_warnings(contract: dict, rel_path: str) -> list[str]:
    policy = contract["maintainability"].get("repeated_waiver_limits")
    if not policy:
        return []
    count = sum(1 for waiver in contract.get("waivers", []) if waiver["path"] == rel_path)
    if count <= int(policy["warning_count"]):
        return []
    return [f"file has {count} waivers, above warning count {policy['warning_count']}"]


def repeated_waiver_failures(contract: dict, rel_path: str) -> list[str]:
    policy = contract["maintainability"].get("repeated_waiver_limits")
    if not policy:
        return []
    count = sum(1 for waiver in contract.get("waivers", []) if waiver["path"] == rel_path)
    if count <= int(policy.get("hard_fail_count", 0)):
        return []
    return [f"file has {count} waivers, above hard fail count {policy['hard_fail_count']}"]


def hotspot_touch_count(repo_root: Path, rel_path: str, history_window: int) -> int:
    result = subprocess.run(
        ["git", "log", "--format=%H", f"--max-count={history_window}", "--", rel_path],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return 0
    return len([line for line in result.stdout.splitlines() if line.strip()])


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    contract = load_repo_contract((repo_root / args.repo_contract).resolve())
    thresholds = get_thresholds(contract)
    protected_signals = contract["maintainability"]["protected_signals"]
    include_globs, exclude_globs = maintainability_scope(contract)

    evaluations = []
    for path, rel_path in governed_files(
        repo_root,
        gather_files(args, repo_root),
        include_globs,
        exclude_globs,
    ):
        evaluations.append(
            merge_advisory_failures(
                merge_advisory_warnings(
                    evaluate_file(
                    path=path,
                    rel_path=rel_path,
                    text=read_file_text(path),
                    thresholds=thresholds,
                    protected_signals=protected_signals,
                    repo_root=repo_root,
                    base_ref=args.base_ref,
                    ),
                    advisory_warnings(repo_root, contract, rel_path, read_file_text(path)),
                ),
                advisory_failures(repo_root, contract, rel_path, read_file_text(path)),
            )
        )

    total_warnings, total_failures = print_evaluations(evaluations)
    print(f"Checked {len(evaluations)} files, {total_warnings} warnings, {total_failures} failures.")
    return 1 if total_failures else 0


def merge_advisory_warnings(evaluation: FileEvaluation, extra_warnings: list[str]) -> FileEvaluation:
    return FileEvaluation(evaluation.path, evaluation.warnings + extra_warnings, evaluation.failures)


def merge_advisory_failures(evaluation: FileEvaluation, extra_failures: list[str]) -> FileEvaluation:
    return FileEvaluation(evaluation.path, evaluation.warnings, evaluation.failures + extra_failures)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
