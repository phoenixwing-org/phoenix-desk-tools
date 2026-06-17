"""phoenix_cad_part_key / phoenix_cad_part_file_link 与 phoenix_cad_file_asset 同步。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.freecad.fcstd_mapping import (
    FILE_STATUS_MISSING,
    FILE_STATUS_PRESENT,
    FcstdMapDocument,
    FcstdMapEntry,
)
from phoenix.freecad.phoenix_store import (
    connect,
    format_part_key,
    get_part_key_detail,
    infer_part_file_role,
    list_part_keys,
    save_fcstd_document,
)


class TestPartKeyStore(unittest.TestCase):
    def test_infer_part_file_role(self) -> None:
        self.assertEqual(infer_part_file_role("100001.001-H-外壳.FCStd"), "part")
        self.assertEqual(infer_part_file_role("100001.001-H-外壳.Drawing.FCStd"), "drawing")
        self.assertEqual(infer_part_file_role("100001.001-H-外壳.ASSY.FCStd"), "assembly")

    def test_sync_part_keys_on_save(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            doc = FcstdMapDocument(
                entries=[
                    FcstdMapEntry(
                        repo_rel_path="./parts/a.FCStd",
                        filename="100001.001-H-本体.FCStd",
                        PartNumber="100001",
                        PartVersion="001",
                        TypeCode="H",
                        PartName="本体",
                    ),
                    FcstdMapEntry(
                        repo_rel_path="./parts/b.FCStd",
                        filename="100001.001-H-本体.Drawing.FCStd",
                        PartNumber="100001",
                        PartVersion="001",
                        TypeCode="H",
                        PartName="本体",
                    ),
                    FcstdMapEntry(
                        repo_rel_path="./old/c.FCStd",
                        filename="100002.002-R-轴.FCStd",
                        PartNumber="100002",
                        PartVersion="002",
                        TypeCode="R",
                        PartName="轴",
                        file_status=FILE_STATUS_MISSING,
                    ),
                ],
                last_scan_at="2026-01-01T00:00:00+00:00",
            )
            save_fcstd_document(
                root,
                doc,
                scan_root=".",
                stats={"total_entries": 3, "present": 2, "missing": 1},
            )

            keys = list_part_keys(root)
            self.assertEqual(len(keys), 2)
            by_key = {k["part_key"]: k for k in keys}
            k1 = by_key[format_part_key("100001", "001")]
            self.assertEqual(k1["file_count"], 2)
            self.assertEqual(k1["present_count"], 2)
            self.assertEqual(k1["PartName"], "本体")

            detail = get_part_key_detail(root, "100001", "001")
            assert detail is not None
            roles = {f["file_role"] for f in detail["files"]}
            self.assertIn("part", roles)
            self.assertIn("drawing", roles)

            k2 = by_key[format_part_key("100002", "002")]
            self.assertEqual(k2["missing_count"], 1)

    def test_upsert_preserves_file_asset_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            entry = FcstdMapEntry(
                repo_rel_path="./x.FCStd",
                filename="9.3-灯座.FCStd",
                PartNumber="9",
                PartVersion="3",
                PartName="灯座",
            )
            doc = FcstdMapDocument(entries=[entry])
            save_fcstd_document(root, doc, scan_root=".", stats={"total_entries": 1})

            with connect(root) as conn:
                row1 = conn.execute("SELECT id FROM phoenix_cad_file_asset").fetchone()
                assert row1 is not None
                id1 = int(row1["id"])

            entry.PartName = "灯座-改"
            save_fcstd_document(
                root,
                FcstdMapDocument(entries=[entry]),
                scan_root=".",
                stats={"total_entries": 1},
            )

            with connect(root) as conn:
                row2 = conn.execute("SELECT id, part_name FROM phoenix_cad_file_asset").fetchone()
                assert row2 is not None
                self.assertEqual(int(row2["id"]), id1)
                self.assertEqual(row2["part_name"], "灯座-改")


if __name__ == "__main__":
    unittest.main()
