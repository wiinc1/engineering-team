import subprocess
import tempfile
import unittest
from pathlib import Path

from tests.helpers.maintainability_test_data import CONTRACT_TEXT, legacy_function


REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT_PATH = REPO_ROOT / "dev-standards" / "tooling" / "check_maintainability.py"


def run_checker(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["python3", str(SCRIPT_PATH), "--repo-root", str(repo_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def write_file(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def init_git_repo(repo_root: Path) -> None:
    run_git(repo_root, "init")
    run_git(repo_root, "config", "user.email", "test@example.com")
    run_git(repo_root, "config", "user.name", "Test User")


def run_git(repo_root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo_root, check=True, capture_output=True)


def waiver_block(path: str, suffix: int) -> str:
    return (
        "  - rule: maintainability:file-size\n"
        f"    path: {path}\n"
        "    reason: test\n"
        "    owner: owner\n"
        "    created_at: 2026-01-01\n"
        "    expires_at: 2026-12-31\n"
        "    mitigation: reduce size\n"
        f"    follow_up: ADR-{suffix}\n"
    )


class MaintainabilityCheckerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_root = Path(self.temp_dir.name)
        init_git_repo(self.repo_root)
        write_file(self.repo_root / "repo-contract.yaml", CONTRACT_TEXT)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def commit_all(self, message: str) -> None:
        run_git(self.repo_root, "add", ".")
        run_git(self.repo_root, "commit", "-m", message)

    def test_new_oversized_file_fails(self) -> None:
        write_file(
            self.repo_root / "src" / "too_long.py",
            "\n".join([f"line_{index} = {index}" for index in range(12)]) + "\n",
        )

        result = run_checker(self.repo_root, "--files", "src/too_long.py")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("file lines 12 exceeds hard cap 10", result.stdout)

    def test_python_function_complexity_fails(self) -> None:
        logic = "\n".join(
            [
                "def f(a, b, c):",
                "    if a:",
                "        if b:",
                "            if c:",
                "                if a and b and c:",
                "                    return 1",
                "    return 0",
                "",
            ]
        )
        write_file(self.repo_root / "src" / "logic.py", logic)

        result = run_checker(self.repo_root, "--files", "src/logic.py")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("max nesting depth", result.stdout)

    def test_legacy_noncompliant_file_must_improve(self) -> None:
        self.assert_legacy_case(
            before=legacy_function(5, "1"),
            after=legacy_function(5, "2"),
            expected="did not improve any protected maintainability signal",
        )

    def test_legacy_noncompliant_file_with_improvement_requests_waiver(self) -> None:
        self.assert_legacy_case(
            before=legacy_function(6, "1"),
            after=legacy_function(5, "1"),
            expected="requires a waiver",
        )

    def test_files_outside_scope_are_ignored(self) -> None:
        write_file(
            self.repo_root / "docs" / "ignored.md",
            "\n".join([f"line {index}" for index in range(30)]) + "\n",
        )

        result = run_checker(self.repo_root, "--files", "docs/ignored.md")

        self.assertEqual(result.returncode, 0)
        self.assertIn("Checked 0 files", result.stdout)

    def test_repeated_waivers_can_hard_fail(self) -> None:
        waivers = "".join(waiver_block("src/waived.py", index) for index in range(1, 5))
        contract = CONTRACT_TEXT + "waivers:\n" + waivers
        write_file(self.repo_root / "repo-contract.yaml", contract)
        write_file(self.repo_root / "src" / "waived.py", "x = 1\n")

        result = run_checker(self.repo_root, "--files", "src/waived.py")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("above hard fail count 3", result.stdout)

    def assert_legacy_case(self, before: str, after: str, expected: str) -> None:
        legacy_path = self.repo_root / "src" / "legacy.py"
        write_file(legacy_path, before)
        self.commit_all("baseline")
        write_file(legacy_path, after)

        result = run_checker(
            self.repo_root,
            "--base-ref",
            "HEAD~0",
            "--files",
            "src/legacy.py",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(expected, result.stdout)


if __name__ == "__main__":
    unittest.main()
