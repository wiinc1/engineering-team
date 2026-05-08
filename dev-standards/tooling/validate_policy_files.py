#!/usr/bin/env python3
"""Validate repo-local policy files against standards schemas."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from typing import Any

import yaml


class ValidationError(Exception):
    pass


def load_yaml(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def resolve_ref(schema: dict[str, Any], ref: str) -> Any:
    if not ref.startswith("#/"):
        raise ValidationError(f"unsupported ref {ref}")
    node: Any = schema
    for part in ref[2:].split("/"):
        node = node[part]
    return node


def validate(instance: Any, schema_node: dict[str, Any], root_schema: dict[str, Any], path: str) -> None:
    if "$ref" in schema_node:
        validate(instance, resolve_ref(root_schema, schema_node["$ref"]), root_schema, path)
        return

    expected_type = schema_node.get("type")
    if expected_type is not None:
        validate_type(instance, expected_type, path)

    if "enum" in schema_node and instance not in schema_node["enum"]:
        raise ValidationError(f"{path} must be one of {schema_node['enum']}, got {instance!r}")

    if "pattern" in schema_node:
        if not isinstance(instance, str) or re.match(schema_node["pattern"], instance) is None:
            raise ValidationError(f"{path} does not match pattern {schema_node['pattern']}")

    if expected_type == "object":
        validate_object(instance, schema_node, root_schema, path)
    elif expected_type == "array":
        validate_array(instance, schema_node, root_schema, path)


def validate_type(instance: Any, expected_type: str, path: str) -> None:
    validators = {
        "object": lambda value: isinstance(value, dict),
        "array": lambda value: isinstance(value, list),
        "string": lambda value: isinstance(value, str),
        "boolean": lambda value: isinstance(value, bool),
        "number": lambda value: isinstance(value, (int, float)) and not isinstance(value, bool),
        "integer": lambda value: isinstance(value, int) and not isinstance(value, bool),
    }
    validator = validators.get(expected_type)
    if validator is None:
        raise ValidationError(f"{path} uses unsupported schema type {expected_type}")
    if not validator(instance):
        raise ValidationError(f"{path} must be {expected_type}, got {type(instance).__name__}")


def validate_object(instance: dict[str, Any], schema_node: dict[str, Any], root_schema: dict[str, Any], path: str) -> None:
    required = schema_node.get("required", [])
    for key in required:
        if key not in instance:
            raise ValidationError(f"{path}.{key} is required")

    properties = schema_node.get("properties", {})
    additional = schema_node.get("additionalProperties", True)

    for key, value in instance.items():
        child_path = f"{path}.{key}" if path else key
        if key in properties:
            validate(value, properties[key], root_schema, child_path)
            continue

        if additional is False:
            raise ValidationError(f"{child_path} is not allowed")
        if isinstance(additional, dict):
            validate(value, additional, root_schema, child_path)


def validate_array(instance: list[Any], schema_node: dict[str, Any], root_schema: dict[str, Any], path: str) -> None:
    min_items = schema_node.get("minItems")
    if min_items is not None and len(instance) < min_items:
        raise ValidationError(f"{path} must contain at least {min_items} items")

    item_schema = schema_node.get("items")
    if item_schema is None:
        return

    for index, item in enumerate(instance):
        validate(item, item_schema, root_schema, f"{path}[{index}]")


def validate_file(instance_path: Path, schema_path: Path) -> list[str]:
    instance = load_yaml(instance_path)
    schema = load_yaml(schema_path)
    try:
        validate(instance, schema, schema, instance_path.name)
    except ValidationError as error:
        return [str(error)]
    return []


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    repo_root = Path(args.repo_root).resolve()
    checks = [
        ("repo-contract.yaml", "dev-standards/schemas/repo-contract.schema.yaml"),
        ("agent-policy.yaml", "dev-standards/schemas/agent-policy.schema.yaml"),
        ("check-manifest.yaml", "dev-standards/schemas/check-manifest.schema.yaml"),
    ]

    failures = 0
    for instance_rel, schema_rel in checks:
        errors = validate_file(repo_root / instance_rel, repo_root / schema_rel)
        if errors:
            for error in errors:
                print(f"FAIL  {instance_rel}: {error}")
                failures += 1
        else:
            print(f"PASS  {instance_rel}")

    print(f"Validated {len(checks)} policy files, {failures} failures.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
