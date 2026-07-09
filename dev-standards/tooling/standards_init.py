#!/usr/bin/env python3
"""Install the repo-local standards package into another repository."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
import subprocess
import sys
from pathlib import Path

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
DEV_STANDARDS_SOURCE = REPO_ROOT / "dev-standards"
TEMPLATE_ROOT = DEV_STANDARDS_SOURCE / "bootstrap" / "template-repo"
DESIGN_TEMPLATE = DEV_STANDARDS_SOURCE / "templates" / "DESIGN.md"
DESIGN_MD_PACKAGE_VERSION = "0.1.1"
TEST_SOURCES = [
    REPO_ROOT / "tests" / "helpers" / "maintainability_test_data.py",
    REPO_ROOT / "tests" / "helpers" / "policy_test_utils.py",
    REPO_ROOT / "tests" / "helpers" / "release_evidence_test_data.py",
    REPO_ROOT / "tests" / "test_agent_intent_validator.py",
    REPO_ROOT / "tests" / "test_approval_proof_validator.py",
    REPO_ROOT / "tests" / "test_architecture_validator.py",
    REPO_ROOT / "tests" / "test_artifact_provenance_validator.py",
    REPO_ROOT / "tests" / "test_change_metadata_validator.py",
    REPO_ROOT / "tests" / "test_config_boundaries_validator.py",
    REPO_ROOT / "tests" / "test_docs_freshness_validator.py",
    REPO_ROOT / "tests" / "test_live_approval_validator.py",
    REPO_ROOT / "tests" / "test_maintainability_checker.py",
    REPO_ROOT / "tests" / "test_policy_schema_validator.py",
    REPO_ROOT / "tests" / "test_release_evidence_builder.py",
    REPO_ROOT / "tests" / "test_release_evidence_validator.py",
    REPO_ROOT / "tests" / "test_shell_boundaries_validator.py",
    REPO_ROOT / "tests" / "test_standards_init.py",
    REPO_ROOT / "tests" / "test_test_policy_validator.py",
    REPO_ROOT / "tests" / "test_traceability_validator.py",
    REPO_ROOT / "tests" / "test_visual_identity_validator.py",
    REPO_ROOT / "tests" / "test_waiver_validator.py",
]

DEFAULT_OVERLAYS = {
    "application": ["production-affecting"],
    "library": ["public-interface"],
    "infrastructure": ["production-affecting", "security-sensitive", "stateful"],
    "automation": ["production-affecting"],
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, help="Target repository path")
    parser.add_argument("--repo-name", help="Repository name override")
    parser.add_argument(
        "--profile",
        choices=sorted(DEFAULT_OVERLAYS),
        default="application",
        help="Repo profile to apply",
    )
    parser.add_argument("--owner", default="repo-owner", help="Primary/backup owner")
    parser.add_argument(
        "--primary-deployment-unit",
        help="Primary deployment unit override",
    )
    parser.add_argument(
        "--runtime-model",
        help="Runtime model override",
    )
    parser.add_argument("--python-version", default="3.12", help="Default Python version")
    parser.add_argument(
        "--verify-python-version",
        default="3.12",
        help="Python version used in the GitHub verify workflow",
    )
    parser.add_argument("--local-reference", default="ADR-001", help="Local standards reference")
    parser.add_argument(
        "--visual-identity",
        choices=["none", "optional", "required"],
        default="none",
        help="Install visual identity governance and optionally a root DESIGN.md",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    parser.add_argument("--run-verify", action="store_true", help="Run make verify in the target repo after install")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    target_root = Path(args.target).resolve()
    target_root.mkdir(parents=True, exist_ok=True)

    repo_name = args.repo_name or target_root.name
    overlays = DEFAULT_OVERLAYS[args.profile]
    replacements = {
        "{{REPO_NAME}}": repo_name,
        "{{PROFILE}}": args.profile,
        "{{OWNER}}": args.owner,
        "{{PRIMARY_DEPLOYMENT_UNIT}}": args.primary_deployment_unit or repo_name,
        "{{RUNTIME_MODEL}}": args.runtime_model or f"{args.profile}-runtime",
        "{{PYTHON_VERSION}}": args.python_version,
        "{{VERIFY_PYTHON_VERSION}}": args.verify_python_version,
        "{{LOCAL_REFERENCE}}": args.local_reference,
        "{{OVERLAYS_INLINE}}": yaml_inline_list(overlays),
    }

    copy_dev_standards(target_root, args.force)
    copy_test_support(target_root, args.force)
    install_template_files(target_root, replacements, args.force)
    install_visual_identity(target_root, args.visual_identity, args.owner, args.force)

    if args.run_verify:
        return run_verify(target_root)
    return 0


def copy_dev_standards(target_root: Path, force: bool) -> None:
    destination = target_root / "dev-standards"
    if destination.exists():
        if not force:
            raise SystemExit(f"Refusing to overwrite existing {destination}. Use --force.")
        shutil.rmtree(destination)
    shutil.copytree(DEV_STANDARDS_SOURCE, destination)


def install_template_files(target_root: Path, replacements: dict[str, str], force: bool) -> None:
    for source in TEMPLATE_ROOT.rglob("*"):
        if source.is_dir():
            continue
        relative = source.relative_to(TEMPLATE_ROOT)
        destination = target_root / render_path(relative)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and not force:
            raise SystemExit(f"Refusing to overwrite existing {destination}. Use --force.")
        if source.suffix == ".tpl":
            rendered = render_text(source.read_text(encoding="utf-8"), replacements)
            destination.write_text(rendered, encoding="utf-8")
        else:
            shutil.copy2(source, destination)


def install_visual_identity(target_root: Path, mode: str, owner: str, force: bool) -> None:
    if mode == "none":
        return

    contract_path = target_root / "repo-contract.yaml"
    if not contract_path.exists():
        raise SystemExit("Cannot configure visual identity without repo-contract.yaml")

    if mode == "required":
        install_design_md(target_root, force)

    contract = yaml.safe_load(contract_path.read_text(encoding="utf-8"))
    contract["visual_identity"] = visual_identity_block(target_root, mode, owner)
    if mode == "required":
        append_unique(contract["directories"]["protected_paths"], "DESIGN.md")
        append_unique(contract["architecture"]["source_of_truth"], "DESIGN.md")
    contract_path.write_text(yaml.safe_dump(contract, sort_keys=False), encoding="utf-8")

    if mode == "required":
        configure_npm_design_lint(target_root)


def install_design_md(target_root: Path, force: bool) -> None:
    destination = target_root / "DESIGN.md"
    if destination.exists() and not force:
        raise SystemExit(f"Refusing to overwrite existing {destination}. Use --force.")
    shutil.copy2(DESIGN_TEMPLATE, destination)


def visual_identity_block(target_root: Path, mode: str, owner: str) -> dict:
    required = mode == "required"
    command = "npm run design:lint" if (target_root / "package.json").exists() else pinned_design_lint_command()
    if not required:
        return {"required": False}
    return {
        "required": True,
        "file": "DESIGN.md",
        "validator_command": command,
        "owner": owner,
        "reviewers": [owner],
        "review": {
            "cadence_days": 90,
            "last_reviewed": dt.date.today().isoformat(),
        },
    }


def pinned_design_lint_command() -> str:
    return f"npx @google/design.md@{DESIGN_MD_PACKAGE_VERSION} lint DESIGN.md"


def configure_npm_design_lint(target_root: Path) -> None:
    package_path = target_root / "package.json"
    if not package_path.exists():
        return
    package = json.loads(package_path.read_text(encoding="utf-8"))
    scripts = package.setdefault("scripts", {})
    scripts.setdefault("design:lint", "design.md lint DESIGN.md")
    dev_dependencies = package.setdefault("devDependencies", {})
    dev_dependencies.setdefault("@google/design.md", DESIGN_MD_PACKAGE_VERSION)
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")


def append_unique(items: list[str], value: str) -> None:
    if value not in items:
        items.append(value)


def copy_test_support(target_root: Path, force: bool) -> None:
    for source in TEST_SOURCES:
        destination = target_root / source.relative_to(REPO_ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and not force:
            raise SystemExit(f"Refusing to overwrite existing {destination}. Use --force.")
        shutil.copy2(source, destination)


def render_path(relative_path: Path) -> Path:
    if relative_path.suffix == ".tpl":
        return relative_path.with_suffix("")
    return relative_path


def render_text(text: str, replacements: dict[str, str]) -> str:
    rendered = text
    for token, value in replacements.items():
        rendered = rendered.replace(token, value)
    return rendered


def yaml_inline_list(items: list[str]) -> str:
    return "[" + ", ".join(items) + "]"


def run_verify(target_root: Path) -> int:
    result = subprocess.run(
        ["make", "verify"],
        cwd=target_root,
        text=True,
    )
    return result.returncode


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
