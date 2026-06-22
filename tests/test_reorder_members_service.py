"""reorder_members Web 服务层。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.reorder_ignore import load_ignore_patterns
from phoenix.code.reorder_workset_scope import derive_reorder_top_level_from_workset
from phoenix.code.ignore import is_ignored_name
from phoenix.code.reorder_members import (
    format_changed_file_log_line,
    normalize_reorder_file_filters,
)
from phoenix.config import user_prefs
from phoenix.services.reorder_members_service import (
    _format_batch_summary,
    list_reorder_top_level_entries,
    run_reorder_members_batch,
)

KT_ALARM_CLOCK_FIXTURE = Path(__file__).resolve().parent / "fixtures" / "KtAlarmClock"


class TestReorderMembersService(unittest.TestCase):
    def test_list_top_level_entries_dirs_and_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "ModA").mkdir()
            (ws / "ModB").mkdir()
            (ws / "ModA" / "a.cpp").write_text("void f(){}\n", encoding="utf-8")
            (ws / "Root.cpp").write_text("void r(){}\n", encoding="utf-8")
            (ws / "readme.md").write_text("x", encoding="utf-8")
            (ws / ".phoenix").mkdir()
            (ws / "build").mkdir()
            out = list_reorder_top_level_entries(ws)
            by_name = {e["name"]: e for e in out["entries"]}
            self.assertEqual(by_name["ModA"]["kind"], "dir")
            self.assertEqual(by_name["ModB"]["kind"], "dir")
            self.assertEqual(by_name["Root.cpp"]["kind"], "file")
            self.assertNotIn("readme.md", by_name)
            self.assertNotIn("build", by_name)
            self.assertGreaterEqual(by_name["ModA"]["source_file_count"], 1)

    def test_ignore_file_patterns(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            ph = ws / ".phoenix"
            ph.mkdir()
            (ph / "reorder-members.ignore").write_text("CustomSkip\n", encoding="utf-8")
            (ws / "CustomSkip").mkdir()
            (ws / "KeepMe").mkdir()
            patterns, _, exists = load_ignore_patterns(ws)
            self.assertFalse(exists)  # 无 code.ignore；legacy 仍合并进 patterns
            self.assertIn("CustomSkip", patterns)
            self.assertTrue(is_ignored_name("CustomSkip", patterns))
            self.assertFalse(is_ignored_name("KeepMe", patterns))

    def test_run_batch_dry_run_and_write(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            mod = ws / "EmptyMod"
            mod.mkdir()
            (mod / "noop.cpp").write_text("void noop() {}\n", encoding="utf-8")
            dry = run_reorder_members_batch(
                ws, targets=["EmptyMod"], dry_run=True, patch={"verbose": False}
            )
            self.assertTrue(dry["ok"])
            self.assertTrue(dry["dry_run"])
            write = run_reorder_members_batch(
                ws, targets=["EmptyMod"], dry_run=False, patch={"verbose": False}
            )
            self.assertTrue(write["ok"])
            self.assertFalse(write["dry_run"])

    def test_run_single_top_level_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "solo.cpp").write_text("void solo(){}\n", encoding="utf-8")
            out = run_reorder_members_batch(
                ws, targets=["solo.cpp"], dry_run=True, patch={"verbose": False}
            )
            self.assertTrue(out["ok"])
            self.assertEqual(out["item_results"][0]["kind"], "file")

    def test_conflicting_legacy_filters_still_scans_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            mod = ws / "Mod"
            mod.mkdir()
            (mod / "a.cpp").write_text("void a(){}\n", encoding="utf-8")
            (mod / "a.h").write_text("class A {};\n", encoding="utf-8")
            self.assertEqual(normalize_reorder_file_filters(True, True), (False, False))
            out = run_reorder_members_batch(
                ws,
                targets=["Mod"],
                dry_run=True,
                patch={"verbose": False, "cpp_only": True, "header_only": True},
            )
            self.assertTrue(out["ok"])
            self.assertGreaterEqual(out["files_scanned"], 2)

    def test_run_without_filter_keys_scans_all(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            mod = ws / "Mod"
            mod.mkdir()
            (mod / "a.cpp").write_text("void a(){}\n", encoding="utf-8")
            (mod / "a.h").write_text("class A {};\n", encoding="utf-8")
            user_prefs.merge_workspace_section(
                "code_reorder",
                {"include_cpp": True, "include_header": False},
                ws,
            )
            out = run_reorder_members_batch(
                ws,
                targets=["Mod"],
                dry_run=True,
                patch={"verbose": False},
            )
            self.assertTrue(out["ok"])
            self.assertGreaterEqual(out["files_scanned"], 2)

    def test_batch_summary_lists_changed_files(self) -> None:
        summary = _format_batch_summary(
            target_count=2,
            dry_run=False,
            total_cpp=2,
            total_hdr=1,
            total_files=10,
            changed_paths=["Mod/a.cpp", "Mod/b.cpp", "Mod/c.h"],
        )
        self.assertIn("变更 3 个文件（2 .cpp、1 头文件）", summary)
        self.assertIn("  ✎ Mod/a.cpp", summary)
        self.assertIn("  ✎ Mod/c.h", summary)

    def test_batch_summary_no_changes(self) -> None:
        summary = _format_batch_summary(
            target_count=2,
            dry_run=True,
            total_cpp=0,
            total_hdr=0,
            total_files=39,
            changed_paths=[],
        )
        self.assertIn("无变更", summary)
        self.assertIn("扫描 39 个源文件", summary)

    def test_changed_file_log_line(self) -> None:
        self.assertEqual(
            format_changed_file_log_line("KtAlarmClockUI/KtAlarmClock.cpp"),
            "  ✎ KtAlarmClockUI/KtAlarmClock.cpp",
        )

    @unittest.skipUnless(
        KT_ALARM_CLOCK_FIXTURE.is_dir(),
        "tests/fixtures/KtAlarmClock 未链接（ln -s /path/to/KtAlarmClock tests/fixtures/KtAlarmClock）",
    )
    def test_kt_alarm_clock_fixture_batch(self) -> None:
        ws = KT_ALARM_CLOCK_FIXTURE.resolve()
        listed = list_reorder_top_level_entries(ws)
        by_name = {e["name"]: e for e in listed["entries"]}
        self.assertIn("KtAlarmClockUI", by_name)
        self.assertGreater(by_name["KtAlarmClockUI"]["source_file_count"], 0)

        out = run_reorder_members_batch(
            ws,
            targets=["KtAlarmClockUI"],
            dry_run=True,
            patch={"verbose": False, "include_cpp": False, "include_header": True},
        )
        self.assertTrue(out["ok"])
        self.assertGreater(out["files_scanned"], 0)
        self.assertGreaterEqual(out["hdr_changed"], 0)

    def test_derive_top_level_from_workset_paths(self) -> None:
        valid = ["ModA", "ModB", "Root.cpp"]
        paths = [
            "ModA/src/foo.cpp",
            "ModA/bar.h",
            "./ModB/x.cpp",
            "other/deep.cpp",
            "Root.cpp",
        ]
        out = derive_reorder_top_level_from_workset(paths, valid)
        self.assertEqual(out, ["ModA", "ModB", "Root.cpp"])


if __name__ == "__main__":
    unittest.main()
