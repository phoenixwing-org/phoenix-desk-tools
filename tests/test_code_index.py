"""Code 工作空间索引：扫描、存储与查询。"""

from __future__ import annotations

import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from phoenix.code.kinds import code_asset_kind
from phoenix.code.scan_index import scan_code_workspace
from phoenix.code.schema import T_CODE_FILE, T_CODE_SCAN
from phoenix.code.store import (
    FILE_STATUS_MISSING,
    FILE_STATUS_PRESENT,
    load_code_index_meta,
    query_code_files,
    save_code_index,
)
from phoenix.freecad.phoenix_store import cad_database_path
from phoenix.services.code_index_service import (
    load_code_index_payload,
    run_code_index_scan,
    search_code_index_entries,
)


class TestCodeKinds(unittest.TestCase):
    def test_classify_extensions(self) -> None:
        self.assertEqual(code_asset_kind(Path("foo.cpp")), "source")
        self.assertEqual(code_asset_kind(Path("bar.hpp")), "source")
        self.assertEqual(code_asset_kind(Path("readme.md")), "doc")
        self.assertEqual(code_asset_kind(Path("app.json")), "config")
        self.assertEqual(code_asset_kind(Path("icon.png")), "resource")
        self.assertIsNone(code_asset_kind(Path("binary.exe")))


class TestCodeIndexService(unittest.TestCase):
    def test_scan_store_and_mark_missing(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="code_index_"))
        try:
            (td / "main.cpp").write_text("int main(){}", encoding="utf-8")
            (td / "README.md").write_text("# hi", encoding="utf-8")
            sub = td / "src"
            sub.mkdir()
            (sub / "util.h").write_bytes(b"\xef\xbb\xbf// h\n")

            first = run_code_index_scan(td)
            self.assertGreaterEqual(first["stats"]["total"], 3)
            self.assertEqual(first["stats"]["source"], 2)
            self.assertEqual(first["stats"]["doc"], 1)
            self.assertTrue(cad_database_path(td).is_file())

            entries, _ = query_code_files(td)
            by_name = {e["filename"]: e for e in entries}
            self.assertEqual(by_name["main.cpp"]["text_encoding"], "ascii")
            self.assertEqual(by_name["util.h"]["text_encoding"], "utf-8-bom")

            (sub / "util.h").unlink()
            second = run_code_index_scan(td)
            self.assertEqual(second["present_count"], 2)
            entries, total = query_code_files(td, status="missing")
            self.assertEqual(total, 1)
            self.assertEqual(entries[0]["filename"], "util.h")
            self.assertEqual(entries[0]["file_status"], FILE_STATUS_MISSING)

            with sqlite3.connect(str(cad_database_path(td))) as conn:
                n = conn.execute(f"SELECT COUNT(*) FROM {T_CODE_FILE}").fetchone()[0]
                self.assertEqual(n, 3)
                scans = conn.execute(f"SELECT COUNT(*) FROM {T_CODE_SCAN}").fetchone()[0]
                self.assertEqual(scans, 2)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_search_entries(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="code_index_search_"))
        try:
            (td / "alpha.cpp").write_text("", encoding="utf-8")
            (td / "beta.json").write_text("{}", encoding="utf-8")
            run_code_index_scan(td)

            out = search_code_index_entries(td, kind="source", q="alpha")
            self.assertEqual(out["total"], 1)
            self.assertEqual(out["entries"][0]["filename"], "alpha.cpp")

            payload = load_code_index_payload(td)
            self.assertIn("source", payload["kinds"])
            self.assertEqual(payload["kind_labels"]["doc"], "文档")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_search_filename_mode(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="code_index_fname_"))
        try:
            (td / "KtAlarmClockCmd.cpp").write_text("", encoding="utf-8")
            sub = td / "KtAlarmClockUI"
            sub.mkdir()
            (sub / "KtAlarmClockCmd.cpp").write_text("", encoding="utf-8")
            (sub / "util.cpp").write_text("", encoding="utf-8")
            run_code_index_scan(td)

            fuzzy = search_code_index_entries(td, q="KtAlarmClock", search_mode="contains")
            self.assertEqual(fuzzy["total"], 3)

            by_name = search_code_index_entries(td, q="KtAlarmClock", search_mode="filename")
            self.assertEqual(by_name["total"], 2)
            self.assertTrue(all("KtAlarmClock" in e["filename"] for e in by_name["entries"]))

            exact = search_code_index_entries(td, q="KtAlarmClockCmd.cpp", search_mode="filename")
            self.assertEqual(exact["total"], 2)

            path_exact = search_code_index_entries(
                td, q="KtAlarmClockUI/KtAlarmClockCmd.cpp", search_mode="filename"
            )
            self.assertEqual(path_exact["total"], 1)
            self.assertEqual(path_exact["entries"][0]["repo_rel_path"], "KtAlarmClockUI/KtAlarmClockCmd.cpp")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_scan_skips_build_dirs(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="code_index_skip_"))
        try:
            build = td / "build"
            build.mkdir()
            (build / "junk.cpp").write_text("", encoding="utf-8")
            (td / "real.cpp").write_text("", encoding="utf-8")

            records = scan_code_workspace(td)
            paths = {r.repo_rel_path for r in records}
            self.assertIn("real.cpp", paths)
            self.assertNotIn("build/junk.cpp", paths)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_save_empty_scan_marks_all_missing(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="code_index_empty_"))
        try:
            (td / "gone.cpp").write_text("", encoding="utf-8")
            records = scan_code_workspace(td)
            save_code_index(td, records, scan_root=".")
            (td / "gone.cpp").unlink()

            save_code_index(td, [], scan_root=".")
            meta = load_code_index_meta(td)
            self.assertEqual(meta["present_count"], 0)
            entries, _ = query_code_files(td, status=FILE_STATUS_PRESENT)
            self.assertEqual(len(entries), 0)
        finally:
            shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
