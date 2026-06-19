"""过程目录启发式与忽略推荐。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.ignore import is_ignored_name, load_ignore_config
from phoenix.code.process_dirs import (
    is_process_dir_name,
    patterns_to_seed_from_suggestions,
    suggest_process_dir_ignores,
)
from phoenix.services.code_ignore_service import get_code_ignore_prefs
from phoenix.services.reorder_members_service import list_reorder_top_level_entries


class TestProcessDirs(unittest.TestCase):
    def test_build_ui_matches_builtin_glob(self) -> None:
        patterns = load_ignore_config(Path("."))["ignore_patterns"]
        self.assertTrue(is_ignored_name("build-ui", patterns))
        self.assertTrue(is_process_dir_name("build-ui"))

    def test_is_process_dir_name(self) -> None:
        self.assertTrue(is_process_dir_name("build-ui"))
        self.assertTrue(is_process_dir_name("cmake-build-debug"))
        self.assertTrue(is_process_dir_name(".cache"))
        self.assertFalse(is_process_dir_name("src"))
        self.assertFalse(is_process_dir_name("MyProject"))

    def test_suggest_skips_already_ignored(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "build-ui").mkdir()
            (ws / "src").mkdir()
            (ws / ".phoenix").mkdir()
            suggestions = suggest_process_dir_ignores(ws)
            names = {s["name"] for s in suggestions}
            self.assertNotIn("build-ui", names)
            self.assertNotIn("src", names)

    def test_suggest_unknown_process_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "artifacts").mkdir()
            (ws / ".phoenix").mkdir()
            suggestions = suggest_process_dir_ignores(ws)
            self.assertEqual(len(suggestions), 1)
            self.assertEqual(suggestions[0]["name"], "artifacts")
            self.assertEqual(suggestions[0]["suggested_pattern"], "artifacts")

    def test_patterns_to_seed_prefers_glob(self) -> None:
        pats = patterns_to_seed_from_suggestions(
            [
                {"name": "build-ui", "suggested_pattern": "build-*"},
                {"name": "build-foo", "suggested_pattern": "build-*"},
            ]
        )
        self.assertEqual(pats, ["build-*"])

    def test_auto_seed_on_first_prefs_load(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "artifacts").mkdir()
            (ws / ".phoenix").mkdir()
            prefs = get_code_ignore_prefs(ws)
            self.assertTrue(prefs["process_dirs_seeded"])
            self.assertIn("artifacts", prefs["process_dirs_auto_seeded"])
            self.assertIn("artifacts", prefs["ignore_custom_patterns"])
            prefs2 = get_code_ignore_prefs(ws)
            self.assertEqual(prefs2["process_dirs_auto_seeded"], [])

    def test_reorder_list_ignores_build_ui(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "build-ui").mkdir()
            (ws / "src").mkdir()
            (ws / ".phoenix").mkdir()
            out = list_reorder_top_level_entries(ws)
            entry_names = {e["name"] for e in out["entries"]}
            ignored_names = {e["name"] for e in out["ignored"]}
            self.assertIn("src", entry_names)
            self.assertIn("build-ui", ignored_names)


if __name__ == "__main__":
    unittest.main()
