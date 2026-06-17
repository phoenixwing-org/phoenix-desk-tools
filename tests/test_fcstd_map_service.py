"""CAD 索引服务：SQLite 存储与缺失标记。"""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from fcdesk.fcstd_mapping import FILE_STATUS_MISSING, FILE_STATUS_PRESENT
from fcdesk.freecad.cad_index_types import (
    ASSET_KIND_FCSTD,
    ASSET_KIND_MARKDOWN,
    ASSET_KIND_PDF,
)
from fcdesk.freecad.phoenix_store import (
    WORKSPACE_DATABASE_FILENAME,
    cad_database_path,
    get_part_key_detail,
    migrate_fcstd_map_json,
)
from fcdesk.services.fcstd_map_service import (
    load_fcstd_map_payload,
    purge_missing_fcstd_map_entries,
    run_fcstd_map_scan,
    search_fcstd_map_entries,
)

_MIN_DOC = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="{label}"/>
    </Property>
    <Property name="PartNumber" type="App::PropertyString" group="CustomDefine">
     <String value="100001"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


class TestFcstdMapService(unittest.TestCase):
    def test_scan_sqlite_and_mark_missing(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_svc_"))
        try:
            (td / "a.FCStd").write_bytes(b"not-a-zip")
            sub = td / "parts"
            sub.mkdir()
            (sub / "b.FCStd").write_bytes(b"x")

            first = run_fcstd_map_scan(td)
            self.assertEqual(first["stats"]["present"], 2)
            self.assertEqual(first["stats"]["missing"], 0)
            self.assertTrue(cad_database_path(td).is_file())

            (sub / "b.FCStd").unlink()
            second = run_fcstd_map_scan(td)
            self.assertEqual(second["stats"]["present"], 1)
            self.assertEqual(second["stats"]["missing"], 1)

            missing = next(e for e in second["entries"] if e["file_status"] == FILE_STATUS_MISSING)
            self.assertIn("b.FCStd", missing["filename"])
            self.assertTrue(missing["last_seen_at"])

            with sqlite3.connect(str(cad_database_path(td))) as conn:
                n = conn.execute("SELECT COUNT(*) FROM phoenix_cad_file_asset").fetchone()[0]
                self.assertEqual(n, 2)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_purge_missing_entries(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_purge_"))
        try:
            (td / "keep.FCStd").write_bytes(b"x")
            gone = td / "gone.FCStd"
            gone.write_bytes(b"y")
            run_fcstd_map_scan(td)
            gone.unlink()
            after_scan = run_fcstd_map_scan(td)
            self.assertEqual(after_scan["stats"]["missing"], 1)

            purged = purge_missing_fcstd_map_entries(td)
            self.assertEqual(purged["purge_deleted"], 1)
            self.assertEqual(purged["stats"]["missing"], 0)
            self.assertEqual(purged["stats"]["present"], 1)
            self.assertEqual(len(purged["entries"]), 1)
            self.assertEqual(purged["entries"][0]["filename"], "keep.FCStd")

            again = purge_missing_fcstd_map_entries(td)
            self.assertEqual(again["purge_deleted"], 0)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_reads_embedded_attrs(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_emb_"))
        try:
            fc = td / "part.FCStd"
            with zipfile.ZipFile(fc, "w") as zf:
                zf.writestr("Document.xml", '<?xml version="1.0"?><Document/>')

            run_fcstd_map_scan(td)
            payload = load_fcstd_map_payload(td)
            self.assertEqual(len(payload["entries"]), 1)
            self.assertEqual(payload["entries"][0]["file_status"], FILE_STATUS_PRESENT)
            self.assertIn(WORKSPACE_DATABASE_FILENAME, payload["database_path"])
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_scan_keeps_embedded_label_without_formula(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_lbl_"))
        try:
            fc = td / "part.FCStd"
            with zipfile.ZipFile(fc, "w") as zf:
                zf.writestr(
                    "Document.xml",
                    _MIN_DOC.format(label="100001.001-文件内旧Label").encode("utf-8"),
                )

            run_fcstd_map_scan(td)
            payload = load_fcstd_map_payload(td)
            row = payload["entries"][0]
            self.assertEqual(row["label"], "100001.001-文件内旧Label")
            self.assertNotIn("-H-", row["label"])
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_scan_includes_cad_asset_types(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="cad_map_types_"))
        try:
            docs = td / "docs"
            docs.mkdir()
            (td / "part.FCStd").write_bytes(b"not-a-zip")
            (docs / "readme.md").write_text("# part\n", encoding="utf-8")
            (docs / "manual.pdf").write_bytes(b"%PDF-1.4")
            (docs / "photo.png").write_bytes(b"\x89PNG")
            (docs / "layout.dxf").write_text("0\nSECTION\n", encoding="utf-8")
            (docs / "ignore.txt").write_text("skip", encoding="utf-8")

            result = run_fcstd_map_scan(td)
            stats = result["stats"]
            self.assertEqual(stats["present"], 5)
            self.assertEqual(stats["cad_file_count"], 5)
            self.assertEqual(stats["fcstd_file_count"], 1)
            self.assertEqual(stats.get("markdown_file_count"), 1)
            self.assertEqual(stats.get("pdf_file_count"), 1)

            payload = load_fcstd_map_payload(td)
            by_kind = {e["filename"]: e["asset_kind"] for e in payload["entries"]}
            self.assertEqual(by_kind["part.FCStd"], ASSET_KIND_FCSTD)
            self.assertEqual(by_kind["readme.md"], ASSET_KIND_MARKDOWN)
            self.assertEqual(by_kind["manual.pdf"], ASSET_KIND_PDF)
            self.assertNotIn("ignore.txt", by_kind)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_scan_pdf_with_part_number_links_part_catalog(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="cad_pdf_pn_"))
        try:
            (td / "100015.001-H-SHIELD-A.pdf").write_bytes(b"%PDF-1.4")

            run_fcstd_map_scan(td)
            payload = load_fcstd_map_payload(td)
            row = next(e for e in payload["entries"] if e["filename"].endswith(".pdf"))
            self.assertEqual(row["PartNumber"], "100015")
            self.assertEqual(row["PartVersion"], "001")
            self.assertEqual(row["TypeCode"], "H")
            self.assertEqual(row["asset_kind"], ASSET_KIND_PDF)

            detail = get_part_key_detail(td, "100015", "001")
            assert detail is not None
            self.assertEqual(len(detail["files"]), 1)
            self.assertEqual(detail["files"][0]["filename"], "100015.001-H-SHIELD-A.pdf")
            self.assertEqual(detail["files"][0]["asset_kind"], ASSET_KIND_PDF)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_search_entries_single_sql_with_debug(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_page_"))
        try:
            (td / "a.FCStd").write_bytes(b"x")
            sub = td / "parts"
            sub.mkdir()
            (sub / "b.md").write_text("# x", encoding="utf-8")
            run_fcstd_map_scan(td)

            page1 = search_fcstd_map_entries(td, offset=0, limit=1)
            self.assertEqual(page1["total"], 2)
            self.assertEqual(page1["count"], 1)
            self.assertIn("debug_sql", page1)
            self.assertIn("FROM phoenix_cad_file_asset", page1["debug_sql"])
            self.assertIn("LIMIT 1", page1["debug_sql"])

            page2 = search_fcstd_map_entries(td, offset=1, limit=1)
            self.assertEqual(page2["count"], 1)
            self.assertNotEqual(
                page1["entries"][0]["repo_rel_path"],
                page2["entries"][0]["repo_rel_path"],
            )

            meta = load_fcstd_map_payload(td, include_entries=False)
            self.assertTrue(meta["exists"])
            self.assertEqual(meta["entries"], [])
            self.assertEqual(meta["stats"]["total_entries"], 2)

            filtered = search_fcstd_map_entries(td, kind="markdown", search="b.md")
            self.assertEqual(filtered["total"], 1)
            self.assertTrue(filtered["entries"][0]["filename"].endswith(".md"))
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_migrate_json_to_sqlite(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_mig_"))
        try:
            doc = {
                "schema_version": 2,
                "entries": [
                    {
                        "repo_rel_path": "./old.FCStd",
                        "filename": "old.FCStd",
                        "PartNumber": "100001",
                        "PartVersion": "001",
                        "file_status": "present",
                        "last_seen_at": "2026-01-01T00:00:00+00:00",
                    }
                ],
                "last_scan_at": "2026-01-01T00:00:00+00:00",
                "scan_stats": {"total_entries": 1, "present": 1, "missing": 0},
            }
            (td / "fcstd_map.json").write_text(json.dumps(doc), encoding="utf-8")

            self.assertTrue(migrate_fcstd_map_json(td))
            payload = load_fcstd_map_payload(td)
            self.assertTrue(payload["exists"])
            self.assertEqual(payload["entries"][0]["PartNumber"], "100001")
        finally:
            shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
