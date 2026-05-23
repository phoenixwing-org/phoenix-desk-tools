"""用户偏好：启动器与工作空间点文件。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from fcdesk.config import user_prefs as prefs
from fcdesk.shell.state import AppState


class TestUserPrefs(unittest.TestCase):
    def test_record_recent_dedupes_and_caps(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            d1 = root / "a"
            d2 = root / "b"
            d1.mkdir()
            d2.mkdir()
            launcher = root / "launcher.json"

            with mock.patch.object(prefs, "launcher_prefs_file", return_value=launcher):
                prefs.record_recent_workspace(d1)
                prefs.record_recent_workspace(d2)
                prefs.record_recent_workspace(d1)
                data = prefs.load_launcher_prefs()
            recent = data["recent_workspaces"]
            self.assertEqual(recent[0], str(d1.resolve()))
            self.assertEqual(recent[1], str(d2.resolve()))
            self.assertEqual(len(recent), 2)

    def test_workspace_dotfile_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / "proj"
            repo.mkdir()
            with mock.patch.object(prefs, "launcher_prefs_file", return_value=repo / "launcher.json"):
                prefs.merge_workspace_section(
                    "step_batch",
                    {"step_dir": "step", "view_fit": "last"},
                    repo,
                )
            dot = repo / prefs.WORKSPACE_DOTFILE_NAME
            self.assertTrue(dot.is_file())
            loaded = prefs.load_workspace_prefs(repo)
            self.assertEqual(loaded["step_batch"]["step_dir"], "step")
            self.assertEqual(loaded["step_batch"]["view_fit"], "last")

    def test_migrate_legacy_launcher(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            repo = root / "myrepo"
            repo.mkdir()
            launcher = root / "workspace.custom.json"
            legacy = {
                "version": 1,
                "toolbar": {
                    "repo_root": str(repo),
                    "freecad_dir": str(root / "fc"),
                },
                "step_batch": {"step_dir": "step"},
            }
            launcher.write_text(json.dumps(legacy), encoding="utf-8")
            (root / "fc").mkdir()

            with mock.patch.object(prefs, "launcher_prefs_file", return_value=launcher):
                prefs.migrate_legacy_workspace_prefs()
                new_launcher = prefs.load_launcher_prefs()
                ws = prefs.load_workspace_prefs(repo)

            self.assertNotIn("step_batch", new_launcher)
            self.assertEqual(ws["step_batch"]["step_dir"], "step")
            self.assertEqual(new_launcher["recent_workspaces"][0], str(repo.resolve()))
            self.assertEqual(new_launcher["freecad_dir"], str((root / "fc").resolve()))

    def test_apply_launcher_sets_recent_repo(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            repo = root / "proj"
            repo.mkdir()
            launcher = root / "launcher.json"
            launcher.write_text(
                json.dumps({"version": 2, "recent_workspaces": [str(repo)]}),
                encoding="utf-8",
            )
            state = AppState(repo_root=root)
            with mock.patch.object(prefs, "launcher_prefs_file", return_value=launcher):
                prefs.apply_launcher_prefs_to_state(state)
            self.assertEqual(state.repo_root, repo.resolve())


if __name__ == "__main__":
    unittest.main()
