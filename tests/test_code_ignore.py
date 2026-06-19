"""Code 模块共用忽略配置。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.ignore import load_ignore_config, merge_ignore_patterns, read_ignore_file_patterns
from phoenix.services.code_ignore_service import get_code_ignore_prefs, save_code_ignore_prefs


class TestCodeIgnore(unittest.TestCase):
    def test_code_ignore_file_primary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            ph = ws / ".phoenix"
            ph.mkdir()
            (ph / "code.ignore").write_text("FromCodeIgnore\n", encoding="utf-8")
            file_only, _, primary_exists, legacy = read_ignore_file_patterns(ws)
            self.assertTrue(primary_exists)
            self.assertEqual(file_only, ["FromCodeIgnore"])
            self.assertEqual(legacy, [])

    def test_legacy_files_when_no_primary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            ph = ws / ".phoenix"
            ph.mkdir()
            (ph / "reorder-members.ignore").write_text("LegacyReorder\n", encoding="utf-8")
            file_only, _, primary_exists, legacy = read_ignore_file_patterns(ws)
            self.assertFalse(primary_exists)
            self.assertIn("LegacyReorder", file_only)
            self.assertEqual(len(legacy), 1)

    def test_file_and_custom_merge(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            ph = ws / ".phoenix"
            ph.mkdir()
            (ph / "code.ignore").write_text("FromFile\n", encoding="utf-8")
            save_code_ignore_prefs(ws, {"custom_ignore": ["CustomDir"]})
            cfg = load_ignore_config(ws)
            self.assertIn("FromFile", cfg["ignore_file_patterns"])
            self.assertIn("CustomDir", cfg["ignore_custom_patterns"])
            self.assertIn("build", cfg["ignore_patterns"])

    def test_prefs_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / ".phoenix").mkdir()
            save_code_ignore_prefs(ws, {"custom_ignore": ["intel_a"], "ignore_preset": "caa"})
            prefs = get_code_ignore_prefs(ws)
            self.assertEqual(prefs["ignore_custom_patterns"], ["intel_a"])
            self.assertEqual(prefs["ignore_preset"], "caa")
            self.assertIn("code_index", prefs["consumers"])

    def test_merge_dedupes(self) -> None:
        merged = merge_ignore_patterns(file_patterns=["build"], custom_patterns=["build", "ModA"])
        self.assertEqual(merged.count("build"), 1)
        self.assertIn("ModA", merged)


if __name__ == "__main__":
    unittest.main()
