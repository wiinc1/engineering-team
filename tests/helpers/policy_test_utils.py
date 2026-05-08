import subprocess
import tempfile
from pathlib import Path


class TempRepo:
    def __init__(self) -> None:
        self._temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self._temp_dir.name)
        self.run_git("init")
        self.run_git("config", "user.email", "test@example.com")
        self.run_git("config", "user.name", "Test User")

    def cleanup(self) -> None:
        self._temp_dir.cleanup()

    def write(self, rel_path: str, content: str) -> None:
        path = self.root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")

    def commit_all(self, message: str) -> None:
        self.run_git("add", ".")
        self.run_git("commit", "-m", message)

    def run_git(self, *args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.root,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout
