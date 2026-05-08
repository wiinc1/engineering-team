"""Shared helpers for repo policy validators."""

from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

import yaml


def load_yaml(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def git_stdout(repo_root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def try_git_stdout(repo_root: Path, *args: str) -> str | None:
    result = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else None


def repo_contract(repo_root: Path) -> dict:
    return load_yaml(repo_root / "repo-contract.yaml")


def agent_policy(repo_root: Path) -> dict:
    return load_yaml(repo_root / "agent-policy.yaml")


def check_manifest(repo_root: Path) -> dict:
    return load_yaml(repo_root / "check-manifest.yaml")


def load_optional_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return load_json(path)


def current_head_sha(repo_root: Path) -> str:
    return git_stdout(repo_root, "rev-parse", "HEAD").strip()


def github_api_json(url: str, token: str) -> dict:
    request = Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "didactic-chainsaw-verify",
        },
    )
    with urlopen(request) as response:
        return json.load(response)


def parse_github_reference(reference: str) -> dict | None:
    parsed = urlparse(reference)
    if parsed.netloc != "github.com":
        return None
    parts = parsed.path.strip("/").split("/")
    if len(parts) < 4:
        return None
    owner, repo, kind, number = parts[:4]
    if kind not in {"pull", "issues"} or not number.isdigit():
        return None
    return {
        "owner": owner,
        "repo": repo,
        "kind": "issue" if kind == "issues" else kind,
        "number": int(number),
    }


def glob_matches(rel_path: str, pattern: str) -> bool:
    path = Path(rel_path)
    if path.match(pattern):
        return True
    if pattern.endswith("/**"):
        prefix = pattern[:-3].rstrip("/")
        return rel_path == prefix or rel_path.startswith(prefix + "/")
    if "/**/" in pattern and path.match(pattern.replace("/**/", "/")):
        return True
    return False


def any_match(rel_path: str, patterns: list[str]) -> bool:
    return any(glob_matches(rel_path, pattern) for pattern in patterns)


def changed_files(repo_root: Path, base_ref: str | None = None) -> list[str]:
    if base_ref:
        files = try_diff_files(repo_root, f"{base_ref}...HEAD")
        if files is not None:
            return files

    porcelain = try_git_stdout(repo_root, "status", "--porcelain")
    if porcelain:
        paths = porcelain_paths(porcelain)
        if paths:
            return paths

    previous = try_git_stdout(repo_root, "rev-parse", "--verify", "HEAD~1")
    if previous:
        return diff_files(repo_root, "HEAD~1..HEAD")
    return []


def diff_files(repo_root: Path, revision_range: str) -> list[str]:
    output = git_stdout(repo_root, "diff", "--name-only", "--diff-filter=ACMR", revision_range)
    return [line for line in output.splitlines() if line.strip()]


def try_diff_files(repo_root: Path, revision_range: str) -> list[str] | None:
    output = try_git_stdout(repo_root, "diff", "--name-only", "--diff-filter=ACMR", revision_range)
    if output is None:
        return None
    return [line for line in output.splitlines() if line.strip()]


def porcelain_paths(output: str) -> list[str]:
    paths = []
    for line in output.splitlines():
        if not line:
            continue
        candidate = line[3:]
        if " -> " in candidate:
            candidate = candidate.split(" -> ", 1)[1]
        if candidate:
            paths.append(candidate)
    return paths


def file_text(repo_root: Path, rel_path: str) -> str:
    return (repo_root / rel_path).read_text(encoding="utf-8")


def parse_date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


def parse_datetime(value: str) -> dt.datetime:
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def bool_from_value(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "y", "on"}


def existing_paths(repo_root: Path, patterns: list[str]) -> list[str]:
    matches = []
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        rel_path = path.relative_to(repo_root).as_posix()
        if any_match(rel_path, patterns):
            matches.append(rel_path)
    return sorted(matches)


def diff_added_lines(repo_root: Path, base_ref: str | None = None) -> dict[str, set[int]]:
    if base_ref:
        output = try_git_stdout(repo_root, "diff", "--unified=0", "--diff-filter=ACMR", f"{base_ref}...HEAD")
    else:
        output = try_git_stdout(repo_root, "diff", "--unified=0", "--diff-filter=ACMR", "HEAD")
    if output is None:
        return {}
    return parse_added_lines(output)


def changed_diff_stats(repo_root: Path, base_ref: str | None = None) -> dict[str, int]:
    revision_range = f"{base_ref}...HEAD" if base_ref else "HEAD"
    output = try_git_stdout(repo_root, "diff", "--numstat", "--diff-filter=ACMR", revision_range)
    if output is None:
        return {}
    stats = {}
    for line in output.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, deleted, rel_path = parts
        added_count = 0 if added == "-" else int(added)
        deleted_count = 0 if deleted == "-" else int(deleted)
        stats[rel_path] = added_count + deleted_count
    return stats


def parse_added_lines(diff_text: str) -> dict[str, set[int]]:
    changed: dict[str, set[int]] = {}
    current_path: str | None = None
    pattern = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
    for line in diff_text.splitlines():
        if line.startswith("+++ b/"):
            current_path = line[6:]
            changed.setdefault(current_path, set())
            continue
        if not line.startswith("@@") or current_path is None:
            continue
        match = pattern.match(line)
        if not match:
            continue
        start = int(match.group(1))
        count = int(match.group(2) or "1")
        if count == 0:
            continue
        changed[current_path].update(range(start, start + count))
    return changed
