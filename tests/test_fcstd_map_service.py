"""FCStd 索引服务：SQLite 存储与缺失标记。"""

from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path

from fcdesk.fcstd_mapping import FILE_STATUS_MISSING, FILE_STATUS_PRESENT
from fcdesk.phoenix_store import CAD_DATABASE_FILENAME, cad_database_path, migrate_fcstd_map_json
from fcdesk.services.fcstd_map_service import load_fcstd_map_payload, run_fcstd_map_scan


class TestFcstdMapService(unittest.TestCase):
    def test_scan_sqlite_and_mark_missing(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcstd_map_svc_"))
        try:
            (td / "a.FCStd").write_bytes(b"not-a-zip")
            sub = td / "parts"
            sub.mkdir()
            (sub / "b.FCStd").write_bytes(b"x")

            first = run_fcstd_map_scan(td, scan_root_input=".")
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
                n = conn.execute("SELECT COUNT(*) FROM file_asset").fetchone()[0]
                self.assertEqual(n, 2)
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
            self.assertIn(CAD_DATABASE_FILENAME, payload["database_path"])
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
