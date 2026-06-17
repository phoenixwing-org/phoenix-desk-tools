"""用户偏好：启动器与工作空间点文件。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from phoenix.config import user_prefs as prefs
from phoenix.config.launcher_paths import platform_launcher_prefs_file
from phoenix.config.user_prefs import workspace_dotfile_path
from phoenix.shell.state import AppState


def _patch_launcher_storage(platform: Path):
    platform.parent.mkdir(parents=True, exist_ok=True)
    return mock.patch.multiple(
        prefs,
        platform_launcher_prefs_file=mock.Mock(return_value=platform),
        launcher_prefs_file=mock.Mock(return_value=platform),
    )


class TestUserPrefs(unittest.TestCase):
    def _mk_test_ws(self, name: str) -> Path:
        p = Path.home() / f".phoenix_test_{name}"
        p.mkdir(parents=True, exist_ok=True)
        return p

    def test_record_recent_dedupes_and_caps(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d1 = self._mk_test_ws("recent_a")
            d2 = self._mk_test_ws("recent_b")
            launcher = Path(td) / "launcher.json"
            try:
                with _patch_launcher_storage(launcher):
                    prefs.record_recent_workspace(d1)
                    prefs.record_recent_workspace(d2)
                    prefs.record_recent_workspace(d1)
                    data = prefs.load_launcher_prefs()
                recent = data["recent_workspaces"]
                self.assertEqual(recent[0], str(d1.resolve()))
                self.assertEqual(recent[1], str(d2.resolve()))
                self.assertEqual(len(recent), 2)
                self.assertTrue(launcher.is_file())
            finally:
                d1.rmdir()
                d2.rmdir()

    def test_remove_recent_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            d1 = self._mk_test_ws("remove_a")
            d2 = self._mk_test_ws("remove_b")
            launcher = Path(td) / "launcher.json"
            try:
                with _patch_launcher_storage(launcher):
                    prefs.record_recent_workspace(d1)
                    prefs.record_recent_workspace(d2)
                    self.assertTrue(prefs.remove_recent_workspace(d1))
                    data = prefs.load_launcher_prefs()
                self.assertEqual(data["recent_workspaces"], [str(d2.resolve())])
                with _patch_launcher_storage(launcher):
                    self.assertFalse(prefs.remove_recent_workspace(Path("/no/such/path")))
            finally:
                d1.rmdir()
                d2.rmdir()

    def test_record_recent_skips_ephemeral_temp(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            launcher = Path(td) / "launcher.json"
            tmp_ws = Path(tempfile.mkdtemp(prefix="fcstd_map_svc_"))
            try:
                with _patch_launcher_storage(launcher):
                    prefs.record_recent_workspace(tmp_ws)
                    data = prefs.load_launcher_prefs()
                self.assertEqual(data.get("recent_workspaces"), [])
            finally:
                tmp_ws.rmdir()

    def test_prune_recent_removes_ephemeral(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            launcher = Path(td) / "launcher.json"
            good = Path.home() / ".phoenix_recent_test_proj"
            tmp_ws = Path(tempfile.mkdtemp(prefix="fcstd_map_svc_"))
            good.mkdir(parents=True, exist_ok=True)
            try:
                with _patch_launcher_storage(launcher):
                    prefs.save_launcher_prefs(
                        {
                            "version": 2,
                            "recent_workspaces": [str(good.resolve()), str(tmp_ws)],
                        }
                    )
                    n = prefs.prune_recent_workspaces(persist=True)
                    data = prefs.load_launcher_prefs()
                self.assertEqual(n, 1)
                self.assertEqual(data["recent_workspaces"], [str(good.resolve())])
            finally:
                tmp_ws.rmdir()
                good.rmdir()

    def test_workspace_dotfile_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / "proj"
            repo.mkdir()
            with _patch_launcher_storage(repo / "launcher.json"):
                prefs.merge_workspace_section(
                    "step_batch",
                    {"step_dir": "step", "view_fit": "last"},
                    repo,
                )
            dot = workspace_dotfile_path(repo)
            self.assertTrue(dot.is_file())
            self.assertEqual(dot.parent.name, prefs.WORKSPACE_PHOENIX_DIR)
            loaded = prefs.load_workspace_prefs(repo)
            self.assertEqual(loaded["step_batch"]["step_dir"], "step")
            self.assertEqual(loaded["step_batch"]["view_fit"], "last")

    def test_apply_launcher_sets_recent_repo(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = self._mk_test_ws("apply_proj")
            launcher = Path(td) / "launcher.json"
            launcher.write_text(
                json.dumps({"version": 2, "recent_workspaces": [str(repo)]}),
                encoding="utf-8",
            )
            state = AppState(repo_root=Path(td))
            try:
                with _patch_launcher_storage(launcher):
                    prefs.apply_launcher_prefs_to_state(state)
                self.assertEqual(state.repo_root, repo.resolve())
            finally:
                repo.rmdir()


class TestLauncherPaths(unittest.TestCase):
    def test_platform_file_under_dir(self) -> None:
        p = platform_launcher_prefs_file()
        self.assertEqual(p.name, "launcher.json")
        self.assertEqual(p.parent.name, "phoenix")
        self.assertEqual(p.parent.parent.name, "phoenix-wing")


if __name__ == "__main__":
    unittest.main()
