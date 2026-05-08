"""Core maintainability evaluation helpers."""

from __future__ import annotations

import ast
import subprocess
from dataclasses import dataclass
from pathlib import Path

import yaml


FUNCTION_WARNING_KEY = "function_lines"
FILE_SOURCE_KEY = "authored_source_file_lines"
FILE_TEST_KEY = "test_file_lines"
COMPLEXITY_KEY = "complexity"
NESTING_KEY = "nesting_depth"
EXPORTS_KEY = "public_exports"


@dataclass(frozen=True)
class Threshold:
    warning: int
    hard_fail: int


@dataclass(frozen=True)
class FileMetrics:
    path: str
    line_count: int
    max_function_length: int
    over_limit_function_count: int
    max_complexity: int
    max_nesting_depth: int
    public_export_count: int


@dataclass(frozen=True)
class FileEvaluation:
    path: str
    warnings: list[str]
    failures: list[str]


def load_repo_contract(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def get_thresholds(contract: dict) -> dict[str, Threshold]:
    raw = contract["maintainability"]["thresholds"]
    return {
        key: Threshold(
            warning=int(value["warning"]),
            hard_fail=int(value["hard_fail"]),
        )
        for key, value in raw.items()
    }


def maintainability_scope(contract: dict) -> tuple[list[str], list[str]]:
    config = contract["maintainability"]
    return config.get("include_globs", []), config.get("exclude_globs", [])


def list_changed_files(repo_root: Path, base_ref: str) -> list[Path]:
    result = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", f"{base_ref}...HEAD"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=True,
    )
    return [repo_root / line for line in result.stdout.splitlines() if line.strip()]


def read_file_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def read_git_file(repo_root: Path, base_ref: str, rel_path: str) -> str | None:
    result = subprocess.run(
        ["git", "show", f"{base_ref}:{rel_path}"],
        cwd=repo_root,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    return result.stdout


def is_test_file(path: Path) -> bool:
    parts = set(path.parts)
    return "tests" in parts or path.name.startswith("test_") or path.name.endswith("_test.py")


def is_text_file(path: Path) -> bool:
    return path.suffix.lower() in {
        ".py",
        ".sh",
        ".md",
        ".yaml",
        ".yml",
        ".toml",
        ".json",
        ".txt",
        ".cfg",
        ".ini",
        ".plist",
    }


def glob_matches(rel_path: str, pattern: str) -> bool:
    path = Path(rel_path)
    return path.match(pattern) or ("/**/" in pattern and path.match(pattern.replace("/**/", "/")))


def path_in_scope(rel_path: str, include_globs: list[str], exclude_globs: list[str]) -> bool:
    if include_globs and not any(glob_matches(rel_path, pattern) for pattern in include_globs):
        return False
    if exclude_globs and any(glob_matches(rel_path, pattern) for pattern in exclude_globs):
        return False
    return True


def governed_files(
    repo_root: Path,
    paths: list[Path],
    include_globs: list[str],
    exclude_globs: list[str],
) -> list[tuple[Path, str]]:
    scoped = []
    for path in paths:
        if not path.exists() or not is_text_file(path):
            continue
        rel_path = path.relative_to(repo_root).as_posix()
        if path_in_scope(rel_path, include_globs, exclude_globs):
            scoped.append((path, rel_path))
    return scoped


def physical_line_count(text: str) -> int:
    return len(text.splitlines()) if text else 0


class ComplexityVisitor(ast.NodeVisitor):
    MATCH_NODE = getattr(ast, "Match", None)
    BRANCH_NODES = (
        ast.If,
        ast.For,
        ast.AsyncFor,
        ast.While,
        ast.ExceptHandler,
        ast.IfExp,
        ast.With,
        ast.AsyncWith,
        ast.comprehension,
    )
    NESTING_NODES = (
        ast.If,
        ast.For,
        ast.AsyncFor,
        ast.While,
        ast.Try,
        ast.With,
        ast.AsyncWith,
    )
    if MATCH_NODE is not None:
        NESTING_NODES = NESTING_NODES + (MATCH_NODE,)

    def __init__(self) -> None:
        self.complexity = 1
        self.max_nesting = 0
        self._nesting = 0

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        self.complexity += max(0, len(node.values) - 1)
        self.generic_visit(node)

    def generic_visit(self, node: ast.AST) -> None:
        if isinstance(node, self.BRANCH_NODES):
            self.complexity += 1
        if isinstance(node, self.NESTING_NODES):
            self._nesting += 1
            self.max_nesting = max(self.max_nesting, self._nesting)
            super().generic_visit(node)
            self._nesting -= 1
            return
        super().generic_visit(node)


def python_public_export_count(tree: ast.Module) -> int:
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "__all__":
                if isinstance(node.value, (ast.List, ast.Tuple)):
                    return len(node.value.elts)
    return 0


def python_metrics(rel_path: str, text: str, thresholds: dict[str, Threshold]) -> FileMetrics:
    tree = ast.parse(text)
    max_function_length = 0
    over_limit_function_count = 0
    max_complexity = 0
    max_nesting = 0

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        function_length = int(node.end_lineno or node.lineno) - node.lineno + 1
        max_function_length = max(max_function_length, function_length)
        if function_length > thresholds[FUNCTION_WARNING_KEY].hard_fail:
            over_limit_function_count += 1

        visitor = ComplexityVisitor()
        visitor.visit(node)
        max_complexity = max(max_complexity, visitor.complexity)
        max_nesting = max(max_nesting, visitor.max_nesting)

    return FileMetrics(
        path=rel_path,
        line_count=physical_line_count(text),
        max_function_length=max_function_length,
        over_limit_function_count=over_limit_function_count,
        max_complexity=max_complexity,
        max_nesting_depth=max_nesting,
        public_export_count=python_public_export_count(tree),
    )


def generic_metrics(rel_path: str, text: str) -> FileMetrics:
    return FileMetrics(
        path=rel_path,
        line_count=physical_line_count(text),
        max_function_length=0,
        over_limit_function_count=0,
        max_complexity=0,
        max_nesting_depth=0,
        public_export_count=0,
    )


def file_metrics(path: Path, rel_path: str, text: str, thresholds: dict[str, Threshold]) -> FileMetrics:
    if path.suffix == ".py":
        return python_metrics(rel_path, text, thresholds)
    return generic_metrics(rel_path, text)


def evaluate_threshold(
    label: str,
    actual: int,
    threshold: Threshold,
    failures: list[str],
    warnings: list[str],
) -> None:
    if actual > threshold.hard_fail:
        failures.append(f"{label} {actual} exceeds hard cap {threshold.hard_fail}")
    elif actual > threshold.warning:
        warnings.append(f"{label} {actual} exceeds warning threshold {threshold.warning}")


def evaluate_static_thresholds(
    metrics: FileMetrics,
    path: Path,
    thresholds: dict[str, Threshold],
) -> tuple[list[str], list[str]]:
    file_key = FILE_TEST_KEY if is_test_file(path) else FILE_SOURCE_KEY
    failures: list[str] = []
    warnings: list[str] = []
    evaluate_threshold("file lines", metrics.line_count, thresholds[file_key], failures, warnings)

    if path.suffix == ".py":
        evaluate_threshold("max function lines", metrics.max_function_length, thresholds[FUNCTION_WARNING_KEY], failures, warnings)
        evaluate_threshold("max complexity", metrics.max_complexity, thresholds[COMPLEXITY_KEY], failures, warnings)
        evaluate_threshold("max nesting depth", metrics.max_nesting_depth, thresholds[NESTING_KEY], failures, warnings)
        evaluate_threshold("public exports", metrics.public_export_count, thresholds[EXPORTS_KEY], failures, warnings)

    return failures, warnings


def metric_value(metrics: FileMetrics, key: str) -> int:
    return {
        "total_file_line_count": metrics.line_count,
        "over_limit_function_count": metrics.over_limit_function_count,
        "maximum_function_length": metrics.max_function_length,
        "maximum_complexity": metrics.max_complexity,
        "maximum_nesting_depth": metrics.max_nesting_depth,
        "public_export_count": metrics.public_export_count,
    }[key]


def is_noncompliant(metrics: FileMetrics, path: Path, thresholds: dict[str, Threshold]) -> bool:
    failures, _ = evaluate_static_thresholds(metrics, path, thresholds)
    return bool(failures)
