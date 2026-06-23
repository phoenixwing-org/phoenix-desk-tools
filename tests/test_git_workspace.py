"""Git 工作区 diff / restore / init。"""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from phoenix.code.git_workspace import (
    git_diff_file,
    git_init_repo,
    git_restore_files,
    git_workspace_info,
)


class TestGitWorkspace(unittest.TestCase):
    def _init_repo(self, ws: Path) -> None:
        subprocess.run(["git", "init"], cwd=ws, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "t@test"], cwd=ws, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "test"], cwd=ws, check=True, capture_output=True)

    def test_info_without_git(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            info = git_workspace_info(ws)
            self.assertTrue(info["git_installed"])
            self.assertFalse(info["repo_initialized"])

    def test_init_and_diff_restore(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            self.assertFalse(git_workspace_info(ws)["repo_initialized"])
            git_init_repo(ws)
            self.assertTrue(git_workspace_info(ws)["repo_initialized"])

            target = ws / "Mod" / "a.cpp"
            target.parent.mkdir()
            target.write_text("void a();\nvoid b();\n", encoding="utf-8")
            subprocess.run(["git", "add", "."], cwd=ws, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "init"], cwd=ws, check=True, capture_output=True)

            target.write_text("void b();\nvoid a();\n", encoding="utf-8")
            diff = git_diff_file(ws, "Mod/a.cpp")
            self.assertTrue(diff["has_diff"])
            self.assertFalse(diff["is_binary"])
            self.assertIn("a.cpp", diff["unified_diff"])

            out = git_restore_files(ws, ["Mod/a.cpp"])
            self.assertEqual(out["restored"], ["Mod/a.cpp"])
            self.assertEqual(target.read_text(encoding="utf-8"), "void a();\nvoid b();\n")

    def test_binary_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            self._init_repo(ws)
            target = ws / "blob.bin"
            target.write_bytes(b"\x00\x01")
            subprocess.run(["git", "add", "blob.bin"], cwd=ws, check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "bin"], cwd=ws, check=True, capture_output=True)
            target.write_bytes(b"\x00\x02")
            diff = git_diff_file(ws, "blob.bin")
            self.assertTrue(diff["is_binary"])
            self.assertEqual(diff["unified_diff"], "")
