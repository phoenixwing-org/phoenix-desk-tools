"""phoenix.shell.git — 工作空间根 Git CLI 适配（不含子模块 / 父仓）。"""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from phoenix.shell.git import git_changes, git_commit, git_diff, git_info, git_init, git_restore, git_stage
from phoenix.shell.git.paths import normalize_repo_rel


class TestShellGitWorkspace(unittest.TestCase):
    def _run(self, ws: Path, *args: str) -> None:
        subprocess.run(["git", *args], cwd=ws, check=True, capture_output=True)

    def test_info_uninitialized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            info = git_info(ws)
            self.assertTrue(info["git_installed"])
            self.assertFalse(info["repo_initialized"])
            self.assertIsNone(info["git_root"])

    def test_init_changes_stage_unstage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            self.assertTrue(git_info(ws)["repo_initialized"])

            target = ws / "Mod" / "a.cpp"
            target.parent.mkdir()
            target.write_text("void a();\n", encoding="utf-8")
            self._run(ws, "config", "user.email", "t@test")
            self._run(ws, "config", "user.name", "test")
            self._run(ws, "add", ".")
            self._run(ws, "commit", "-m", "init")

            target.write_text("void b();\n", encoding="utf-8")
            payload = git_changes(ws)
            self.assertEqual(payload["unstaged_count"], 1)
            self.assertEqual(payload["changes"][0]["path"], "Mod/a.cpp")

            git_stage(ws, ["Mod/a.cpp"])
            payload2 = git_changes(ws)
            self.assertEqual(payload2["staged_count"], 1)
            self.assertEqual(payload2["staged"][0]["path"], "Mod/a.cpp")

            git_restore(ws, ["Mod/a.cpp"], scope="staged")
            payload3 = git_changes(ws)
            self.assertEqual(payload3["staged_count"], 0)
            self.assertEqual(payload3["unstaged_count"], 1)

    def test_commit_requires_staged_and_clears_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            self._run(ws, "config", "user.email", "t@test")
            self._run(ws, "config", "user.name", "test")

            target = ws / "Mod" / "a.cpp"
            target.parent.mkdir()
            target.write_text("void a();\n", encoding="utf-8")
            git_stage(ws, ["Mod/a.cpp"])

            out = git_commit(ws, "add a.cpp")
            self.assertEqual(out["committed_paths"], ["Mod/a.cpp"])
            self.assertTrue(out["commit_sha"])
            self.assertEqual(out["message"], "add a.cpp")

            payload = git_changes(ws)
            self.assertEqual(payload["staged_count"], 0)
            self.assertEqual(payload["unstaged_count"], 0)

            with self.assertRaisesRegex(ValueError, "没有已暂存的改动"):
                git_commit(ws, "nothing staged")

            with self.assertRaisesRegex(ValueError, "提交说明不能为空"):
                git_commit(ws, "   ")

    def test_untracked_listed_separately(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            self._run(ws, "config", "user.email", "t@test")
            self._run(ws, "config", "user.name", "test")
            (ws / "tracked.txt").write_text("v1\n", encoding="utf-8")
            self._run(ws, "add", "tracked.txt")
            self._run(ws, "commit", "-m", "init")
            (ws / "tracked.txt").write_text("v2\n", encoding="utf-8")
            (ws / "new.txt").write_text("new\n", encoding="utf-8")

            payload = git_changes(ws)
            self.assertEqual(payload["changes"][0]["path"], "tracked.txt")
            self.assertFalse(payload["changes"][0]["untracked"])
            self.assertEqual(payload["untracked"][0]["path"], "new.txt")
            self.assertTrue(payload["untracked"][0]["untracked"])
            self.assertEqual(payload["untracked_count"], 1)
            self.assertEqual(payload["unstaged_count"], 2)

    def test_git_root_only_at_workspace_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp) / "parent"
            ws = parent / "workspace"
            ws.mkdir(parents=True)
            self._run(parent, "init")
            info = git_info(ws)
            self.assertFalse(info["repo_initialized"])

    def test_normalize_repo_rel_preserves_dotfiles(self) -> None:
        self.assertEqual(normalize_repo_rel(".gitignore"), ".gitignore")
        self.assertEqual(normalize_repo_rel("./Mod/foo.h"), "Mod/foo.h")
        self.assertEqual(normalize_repo_rel(".hidden/x"), ".hidden/x")

    def test_restore_dotfile_unstage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            self._run(ws, "config", "user.email", "t@test")
            self._run(ws, "config", "user.name", "test")
            ignore = ws / ".gitignore"
            ignore.write_text("*.log\n", encoding="utf-8")
            self._run(ws, "add", ".gitignore")
            self._run(ws, "commit", "-m", "init")
            ignore.write_text("*.log\n*.tmp\n", encoding="utf-8")
            git_stage(ws, [".gitignore"])
            self.assertEqual(git_changes(ws)["staged_count"], 1)

            git_restore(ws, [".gitignore"], scope="staged")
            payload = git_changes(ws)
            self.assertEqual(payload["staged_count"], 0)
            self.assertEqual(payload["unstaged_count"], 1)
            self.assertEqual(payload["changes"][0]["path"], ".gitignore")

    def test_restore_untracked_deletes_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            target = ws / "Mod" / "new.cpp"
            target.parent.mkdir()
            target.write_text("new\n", encoding="utf-8")
            self.assertEqual(git_changes(ws)["untracked_count"], 1)

            git_restore(ws, ["Mod/new.cpp"], scope="untracked")
            self.assertFalse(target.exists())
            self.assertEqual(git_changes(ws)["untracked_count"], 0)

    def test_untracked_path_with_spaces_from_porcelain_quotes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            self._run(ws, "config", "user.email", "t@test")
            self._run(ws, "config", "user.name", "test")
            target = ws / "Mod" / "KTCAutoHSO copy 3.h"
            target.parent.mkdir(parents=True)
            target.write_text("x\n", encoding="utf-8")

            payload = git_changes(ws)
            self.assertEqual(payload["untracked"][0]["path"], "Mod/KTCAutoHSO copy 3.h")

            git_restore(ws, [payload["untracked"][0]["path"]], scope="untracked")
            self.assertFalse(target.exists())
            self.assertEqual(git_changes(ws)["untracked_count"], 0)

    def test_git_diff_worktree_and_staged(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            git_init(ws)
            self._run(ws, "config", "user.email", "t@test")
            self._run(ws, "config", "user.name", "test")
            target = ws / "Mod" / "a.cpp"
            target.parent.mkdir()
            target.write_text("void a();\n", encoding="utf-8")
            self._run(ws, "add", ".")
            self._run(ws, "commit", "-m", "init")

            target.write_text("void b();\n", encoding="utf-8")
            empty = git_diff(ws, "Mod/a.cpp", scope="worktree")
            self.assertTrue(empty["has_diff"])
            self.assertIn("void b", empty["unified_diff"])

            git_stage(ws, ["Mod/a.cpp"])
            staged = git_diff(ws, "Mod/a.cpp", scope="staged")
            self.assertTrue(staged["has_diff"])
            self.assertIn("void b", staged["unified_diff"])

            git_restore(ws, ["Mod/a.cpp"], scope="worktree")
            clean = git_diff(ws, "Mod/a.cpp", scope="worktree")
            self.assertFalse(clean["has_diff"])

            with self.assertRaisesRegex(ValueError, "文件不存在"):
                git_diff(ws, "Mod/missing.cpp", scope="worktree")


if __name__ == "__main__":
    unittest.main()
