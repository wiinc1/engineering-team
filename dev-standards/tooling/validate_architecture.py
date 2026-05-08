#!/usr/bin/env python3
"""Validate architecture boundaries, imports, and runtime boundary rules."""

from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

from repo_policy_utils import any_match, changed_files, file_text, repo_contract


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
        print("PASS  architecture: no changed files to validate")
        return 0

    failures = []
    failures.extend(boundary_failures(repo_root, contract, touched))
    failures.extend(layer_edge_failures(repo_root, contract, touched))
    failures.extend(import_rule_failures(repo_root, contract, touched))
    failures.extend(runtime_boundary_failures(repo_root, contract, touched))
    failures.extend(banned_pattern_failures(repo_root, contract, touched))

    for failure in failures:
        print(f"FAIL  architecture: {failure}")
    if not failures:
        print(f"PASS  architecture: validated {len(touched)} changed files")
    return 1 if failures else 0


def boundary_failures(repo_root: Path, contract: dict, touched: list[str]) -> list[str]:
    failures = []
    scan_globs = contract["architecture"].get("reference_scan_globs", [])
    for rule in contract["architecture"]["boundary_map"]:
        if rule["rule"] != "forbid":
            continue
        for rel_path in touched:
            if not rel_path.startswith(rule["from"].rstrip("/") + "/") and rel_path != rule["from"].rstrip("/"):
                continue
            if scan_globs and not any_match(rel_path, scan_globs):
                continue
            text = file_text(repo_root, rel_path)
            if rule["to"] in text:
                failures.append(f"{rel_path} references forbidden boundary {rule['to']}")
    return failures


def import_rule_failures(repo_root: Path, contract: dict, touched: list[str]) -> list[str]:
    failures = []
    rules = contract["architecture"].get("python_import_rules", [])
    for rel_path in touched:
        if not rel_path.endswith(".py"):
            continue
        tree = ast.parse(file_text(repo_root, rel_path), filename=rel_path)
        imports = imported_modules(tree)
        for rule in rules:
            if not any_match(rel_path, rule["from_paths"]):
                continue
            for forbidden in rule["forbidden_modules"]:
                if any(module == forbidden or module.startswith(forbidden + ".") for module in imports):
                    failures.append(f"{rel_path} imports forbidden module prefix {forbidden}")
    return failures


def layer_edge_failures(repo_root: Path, contract: dict, touched: list[str]) -> list[str]:
    layers = contract["architecture"].get("python_layers", [])
    allowed_edges = contract["architecture"].get("allowed_layer_edges", {})
    failures = []
    for rel_path in touched:
        if not rel_path.endswith(".py"):
            continue
        source_layer = layer_for_path(rel_path, layers)
        if source_layer is None:
            continue
        tree = ast.parse(file_text(repo_root, rel_path), filename=rel_path)
        imports = imported_modules(tree)
        for imported in imports:
            target_layer = layer_for_module(imported, layers)
            if target_layer is None or target_layer == source_layer:
                continue
            allowed = allowed_edges.get(source_layer, [])
            if target_layer not in allowed:
                failures.append(
                    f"{rel_path} imports layer {target_layer!r} from {source_layer!r}, which is not an allowed edge"
                )
    return failures


def layer_for_path(rel_path: str, layers: list[dict]) -> str | None:
    for layer in layers:
        if any_match(rel_path, layer["paths"]):
            return layer["name"]
    return None


def layer_for_module(module: str, layers: list[dict]) -> str | None:
    for layer in layers:
        for prefix in layer["module_prefixes"]:
            if module == prefix or module.startswith(prefix + "."):
                return layer["name"]
    return None


def imported_modules(tree: ast.AST) -> set[str]:
    modules = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name)
        elif isinstance(node, ast.ImportFrom) and node.module:
            modules.add(node.module)
    return modules


def runtime_boundary_failures(repo_root: Path, contract: dict, touched: list[str]) -> list[str]:
    failures = []
    rules = contract["architecture"].get("runtime_boundary_rules", [])
    for rel_path in touched:
        if not rel_path.endswith(".py"):
            continue
        tree = ast.parse(file_text(repo_root, rel_path), filename=rel_path)
        aliases = import_aliases(tree)
        for rule in rules:
            if not any_match(rel_path, rule["paths"]):
                continue
            if any_match(rel_path, rule.get("allowed_in", [])):
                continue
            forbidden = set(rule["forbidden_references"])
            for reference in forbidden_reference_hits(tree, aliases, forbidden):
                failures.append(f"{rel_path} violates runtime boundary {rule['description']}: {reference}")
    return failures


def import_aliases(tree: ast.AST) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                aliases[alias.asname or alias.name] = alias.name
        elif isinstance(node, ast.ImportFrom) and node.module:
            for alias in node.names:
                aliases[alias.asname or alias.name] = f"{node.module}.{alias.name}"
    return aliases


def forbidden_reference_hits(tree: ast.AST, aliases: dict[str, str], forbidden: set[str]) -> list[str]:
    hits = []
    for node in ast.walk(tree):
        dotted = dotted_reference(node, aliases)
        if dotted and dotted in forbidden:
            hits.append(dotted)
    return sorted(set(hits))


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


def banned_pattern_failures(repo_root: Path, contract: dict, touched: list[str]) -> list[str]:
    failures = []
    for rule in contract["architecture"].get("banned_patterns", []):
        pattern = re.compile(rule["pattern"])
        for rel_path in touched:
            if not any_match(rel_path, rule["forbidden_in"]):
                continue
            if any_match(rel_path, rule.get("allowed_in", [])):
                continue
            if pattern.search(file_text(repo_root, rel_path)):
                failures.append(f"{rel_path} violates banned pattern rule: {rule['description']}")
    return failures


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
