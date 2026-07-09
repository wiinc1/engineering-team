#!/usr/bin/env python3
"""Generate a compact audit bundle from policy evidence artifacts."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_ARTIFACTS = [
    ".artifacts/approval-record.json",
    ".artifacts/live-approval.json",
    ".artifacts/live-traceability.json",
    ".artifacts/release-evidence.json",
    ".artifacts/deploy-record.json",
    ".artifacts/post-deploy-health.json",
    ".artifacts/rollback-verification.json",
    ".artifacts/rollback-record.json",
    ".artifacts/immutable-artifact.json",
    ".artifacts/test-results.json",
    ".artifacts/coverage-summary.json",
    ".artifacts/contract-test-report.json",
    ".artifacts/integration-test-report.json",
    ".artifacts/system-test-report.json",
    ".artifacts/ephemeral-environment.json",
]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--output", default=".artifacts/audit-bundle.json")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    output_path = repo_root / args.output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bundle = {
        "schema_version": "1.0",
        "generated_by": "generate_audit_bundle.py",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "commit_sha": current_commit_sha(repo_root),
        "source_system": "github-actions" if os_environ("GITHUB_ACTIONS") else "local",
        "source_record_id": str(output_path),
        "environment": current_environment(),
        "scope": "audit-bundle",
        "workflow_run_id": current_workflow_run_id(),
        "artifacts": collect_artifacts(repo_root),
    }
    output_path.write_text(json.dumps(bundle, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Wrote audit bundle to {output_path.relative_to(repo_root)}")
    return 0


def current_commit_sha(repo_root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def current_environment() -> str:
    return (
        os_environ("RELEASE_ENV")
        or os_environ("GITHUB_EVENT_NAME")
        or "local"
    )


def current_workflow_run_id() -> str:
    return os_environ("GITHUB_RUN_ID") or "local-run"


def os_environ(name: str) -> str | None:
    import os

    value = os.environ.get(name)
    return value if value else None


def collect_artifacts(repo_root: Path) -> list[dict]:
    collected = []
    for rel_path in DEFAULT_ARTIFACTS:
        path = repo_root / rel_path
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        collected.append(
            {
                "path": rel_path,
                "generated_by": payload.get("generated_by"),
                "generated_at": payload.get("generated_at"),
                "commit_sha": payload.get("commit_sha"),
            }
        )
    return collected


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
