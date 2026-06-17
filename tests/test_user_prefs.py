"""用户偏好：启动器与工作空间点文件。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from phoenix.config import user_prefs as prefs
from phoenix.config.launcher_paths import platform_launcher_prefs_file
from phoenix.config.user_prefs import legacy_workspace_dotfile_path, workspace_dotfile_path
from phoenix.shell.state import AppState


def _patch_launcher_storage(platform: Path, *, web: Path | None = None, legacy: Path | None = None):
    platform.parent.mkdir(parents=True, exist_ok=True)
    web_path = web if web is not None else platform.parent / "_no_web_launcher.json"
    no_flat = platform.parent / "_no_flat_launcher.json"
    no_vendor_fcdesk = platform.parent / "_no_vendor_fcdesk_launcher.json"
    legacy_path = legacy if legacy is not None else platform.parent / "_no_legacy.json"
    patches: dict[str, mock.Mock] = {
        "platform_launcher_prefs_file": mock.Mock(return_value=platform),
        "launcher_prefs_file": mock.Mock(return_value=platform),
        "web_launcher_prefs_file": mock.Mock(return_value=web_path),
        "legacy_flat_launcher_prefs_file": mock.Mock(return_value=no_flat),
        "legacy_vendor_fcdesk_launcher_prefs_file": mock.Mock(return_value=no_vendor_fcdesk),
        "legacy_launcher_prefs_file": mock.Mock(return_value=legacy_path),
    }
    return mock.patch.multiple(prefs, **patches)


class TestUserPrefs(unittest.TestCase):
    def _mk_test_ws(self, name: str) -> Path:
        p = Path.home() / f".fcdesk_test_{name}"
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
            good = Path.home() / ".fcdesk_recent_test_proj"
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

    def test_migrate_keeps_platform_recent_after_legacy_delete(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            platform = Path(td) / "launcher.json"
            legacy = Path(td) / "legacy.json"
            keep = self._mk_test_ws("migrate_keep")
            ghost = self._mk_test_ws("migrate_ghost")
            try:
                legacy.write_text(
                    json.dumps({"version": 1, "recent_workspaces": [str(ghost.resolve())]}),
                    encoding="utf-8",
                )
                with _patch_launcher_storage(platform, legacy=legacy):
                    prefs.save_launcher_prefs(
                        {"version": 2, "recent_workspaces": [str(keep.resolve())]}
                    )
                    prefs.migrate_launcher_prefs()
                    data = prefs.load_launcher_prefs()
                self.assertEqual(data["recent_workspaces"], [str(keep.resolve())])
            finally:
                keep.rmdir()
                ghost.rmdir()

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

    def test_migrate_workspace_dotfile_to_phoenix(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / "proj"
            repo.mkdir()
            legacy = legacy_workspace_dotfile_path(repo)
            legacy.write_text(
                json.dumps({"version": 1, "step_batch": {"step_dir": "step"}}),
                encoding="utf-8",
            )
            self.assertTrue(prefs.migrate_workspace_dotfile(repo))
            target = workspace_dotfile_path(repo)
            self.assertTrue(target.is_file())
            loaded = prefs.load_workspace_prefs(repo)
            self.assertEqual(loaded["step_batch"]["step_dir"], "step")
            self.assertFalse(prefs.migrate_workspace_dotfile(repo))

    def test_migrate_legacy_launcher(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            repo = root / "myrepo"
            repo.mkdir()
            legacy = root / "workspace.custom.json"
            platform = root / "platform" / "launcher.json"
            legacy_data = {
                "version": 1,
                "toolbar": {
                    "repo_root": str(repo),
                    "freecad_dir": str(root / "fc"),
                },
                "step_batch": {"step_dir": "step"},
            }
            legacy.write_text(json.dumps(legacy_data), encoding="utf-8")
            (root / "fc").mkdir()

            with _patch_launcher_storage(platform, legacy=legacy):
                prefs.migrate_legacy_workspace_prefs()
                new_launcher = prefs.load_launcher_prefs()
                ws = prefs.load_workspace_prefs(repo)

            self.assertNotIn("step_batch", new_launcher)
            self.assertEqual(ws["step_batch"]["step_dir"], "step")
            self.assertEqual(new_launcher["recent_workspaces"][0], str(repo.resolve()))
            self.assertEqual(
                Path(str(new_launcher["freecad_dir"])).resolve(),
                (root / "fc").resolve(),
            )
            self.assertTrue(platform.is_file())

    def test_migrate_web_local_to_platform(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            cad = root / "cad-root"
            cad.mkdir()
            web_launcher = root / "web-ui" / ".local" / "launcher.json"
            platform = root / "platform" / "launcher.json"
            web_launcher.parent.mkdir(parents=True)
            web_launcher.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "recent_workspaces": [str(cad)],
                        "freecad_dir": "/Applications/FreeCAD.app",
                    }
                ),
                encoding="utf-8",
            )

            with _patch_launcher_storage(platform, web=web_launcher):
                changed = prefs.migrate_launcher_prefs()
                data = prefs.load_launcher_prefs()

            self.assertTrue(changed)
            self.assertTrue(platform.is_file())
            self.assertEqual(data["recent_workspaces"][0], str(cad.resolve()))
            self.assertEqual(data["freecad_dir"], "/Applications/FreeCAD.app")

    def test_migrate_recent_from_legacy_when_web_empty(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            cad = root / "cad-root"
            cad.mkdir()
            legacy = root / "workspace.custom.json"
            web_launcher = root / "web-ui" / ".local" / "launcher.json"
            platform = root / "platform" / "launcher.json"
            legacy.write_text(
                json.dumps(
                    {
                        "version": 2,
                        "recent_workspaces": [str(cad)],
                        "freecad_dir": "/Applications/FreeCAD.app",
                    }
                ),
                encoding="utf-8",
            )
            web_launcher.parent.mkdir(parents=True)
            web_launcher.write_text(
                json.dumps({"version": 2, "recent_workspaces": [], "freecad_dir": None}),
                encoding="utf-8",
            )

            with _patch_launcher_storage(platform, web=web_launcher, legacy=legacy):
                prefs.migrate_launcher_prefs()
                data = prefs.load_launcher_prefs()

            self.assertEqual(data["recent_workspaces"][0], str(cad.resolve()))
            self.assertEqual(data["freecad_dir"], "/Applications/FreeCAD.app")
            self.assertTrue(platform.is_file())

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
