from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "standards_init.py"


class StandardsInitTests(unittest.TestCase):
    def test_installs_template_payload(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "sample-repo"
            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT_PATH),
                    "--target",
                    str(target),
                    "--repo-name",
                    "sample-repo",
                    "--profile",
                    "library",
                    "--owner",
                    "alice",
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((target / "dev-standards" / "README.md").exists())
            self.assertTrue((target / ".github" / "workflows" / "verify.yml").exists())
            self.assertTrue((target / "docs" / "adr" / "ADR-001.md").exists())
            self.assertTrue((target / "requirements-standards.txt").exists())
            self.assertTrue((target / "tests" / "test_policy_schema_validator.py").exists())
            repo_contract = (target / "repo-contract.yaml").read_text(encoding="utf-8")
            self.assertIn("name: sample-repo", repo_contract)
            self.assertIn("profile: library", repo_contract)
            self.assertIn("overlays: [public-interface]", repo_contract)
            agent_policy = (target / "agent-policy.yaml").read_text(encoding="utf-8")
            self.assertIn("task: release", agent_policy)
            self.assertIn("mode: never-automated", agent_policy)

    def test_refuses_to_overwrite_without_force(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "sample-repo"
            target.mkdir(parents=True)
            (target / "Makefile").write_text("existing\n", encoding="utf-8")
            result = subprocess.run(
                ["python3", str(SCRIPT_PATH), "--target", str(target)],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Use --force", result.stderr or result.stdout)

    def test_installs_required_visual_identity(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            target = Path(tmp_dir) / "sample-repo"
            result = subprocess.run(
                [
                    "python3",
                    str(SCRIPT_PATH),
                    "--target",
                    str(target),
                    "--repo-name",
                    "sample-repo",
                    "--owner",
                    "alice",
                    "--visual-identity",
                    "required",
                ],
                cwd=REPO_ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((target / "DESIGN.md").exists())
            repo_contract = (target / "repo-contract.yaml").read_text(encoding="utf-8")
            self.assertIn("visual_identity:", repo_contract)
            self.assertIn("required: true", repo_contract)
            self.assertIn("file: DESIGN.md", repo_contract)
            self.assertIn("npx @google/design.md@0.1.1 lint DESIGN.md", repo_contract)
            self.assertIn("- DESIGN.md", repo_contract)


if __name__ == "__main__":
    unittest.main()
