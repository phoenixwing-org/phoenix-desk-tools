"""工作空间偏好 SQLite 存储单测。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from phoenix.config import user_prefs as prefs
from phoenix.config.workspace_prefs_store import (
    import_dotfile_to_sqlite_if_needed,
    load_prefs_from_sqlite,
    prefs_table_empty,
    save_prefs_to_sqlite,
)
from phoenix.config.user_prefs import workspace_dotfile_path
from phoenix.freecad.phoenix_schema import WORKSPACE_DATABASE_FILENAME


class TestWorkspacePrefsStore(unittest.TestCase):
    def test_save_load_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            save_prefs_to_sqlite(
                repo,
                {
                    "PartVersion": 1,
                    "step_batch": {"step_dir": "in/step", "view_fit": "all"},
                },
            )
            raw = load_prefs_from_sqlite(repo)
            self.assertEqual(raw["step_batch"]["step_dir"], "in/step")
            db = repo / ".phoenix" / WORKSPACE_DATABASE_FILENAME
            self.assertTrue(db.is_file())

    def test_merge_workspace_section_uses_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            prefs.merge_workspace_section("bom_apply", {"last_part_number": "PN001"}, repo)
            self.assertFalse(prefs_table_empty(repo))
            loaded = prefs.load_workspace_prefs(repo)
            self.assertEqual(loaded["bom_apply"]["last_part_number"], "PN001")
            dot = workspace_dotfile_path(repo)
            self.assertFalse(dot.is_file())

    def test_import_json_once(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            ph = repo / ".phoenix"
            ph.mkdir()
            workspace_dotfile_path(repo).write_text(
                json.dumps({"code_rename": {"scope": "src/"}}),
                encoding="utf-8",
            )
            self.assertTrue(import_dotfile_to_sqlite_if_needed(repo))
            self.assertFalse(import_dotfile_to_sqlite_if_needed(repo))
            self.assertEqual(
                load_prefs_from_sqlite(repo)["code_rename"]["scope"],
                "src/",
            )

    def test_after_sqlite_import_json_is_not_rewritten(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            ph = repo / ".phoenix"
            ph.mkdir()
            dot = workspace_dotfile_path(repo)
            dot.write_text(
                json.dumps({"bom_apply": {"last_part_number": "OLD"}}),
                encoding="utf-8",
            )
            mtime_before = dot.stat().st_mtime
            prefs.merge_workspace_section("bom_apply", {"last_part_number": "NEW"}, repo)
            self.assertEqual(prefs.load_workspace_prefs(repo)["bom_apply"]["last_part_number"], "NEW")
            self.assertLessEqual(dot.stat().st_mtime, mtime_before + 0.001)


if __name__ == "__main__":
    unittest.main()
