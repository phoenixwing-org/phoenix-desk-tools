"""属性回写单字段推荐。"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from phoenix.freecad.fcstd_mapping import FcstdMapDocument, FcstdMapEntry
from phoenix.freecad.phoenix_store import save_fcstd_document
from phoenix.services.bom_apply_service import recommend_bom_field, recommend_bom_fields_all

_MIN_DOC = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="1">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="{label}"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


def _write_fcstd(path: Path, *, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Document.xml", _MIN_DOC.format(label=label).encode("utf-8"))


class TestRecommendBomField(unittest.TestCase):
    def test_recommend_from_index_same_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            fcstd = root / "parts" / "100001.001-H-本体.FCStd"
            fcstd.parent.mkdir(parents=True)
            fcstd.write_bytes(b"not a zip")

            doc = FcstdMapDocument(
                entries=[
                    FcstdMapEntry(
                        repo_rel_path="./parts/100001.001-H-本体.FCStd",
                        filename="100001.001-H-本体.FCStd",
                        PartNumber="100001",
                        PartVersion="001",
                        TypeCode="H",
                        PartName="本体",
                    )
                ]
            )
            save_fcstd_document(root, doc, scan_root=".", stats={"total_entries": 1})

            out = recommend_bom_field(
                root,
                Path("parts/100001.001-H-本体.FCStd"),
                "PartNumber",
                {"PartNumber": "", "PartVersion": "", "filename": fcstd.name},
            )
            self.assertTrue(out["filled"])
            self.assertEqual(out["value"], "100001")
            self.assertIn("索引库", str(out["source_note"]))

    def test_recommend_does_not_require_other_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = recommend_bom_field(
                root,
                Path("missing.FCStd"),
                "PartNumber",
                {
                    "PartNumber": "9",
                    "PartVersion": "3",
                    "TypeCode": "",
                    "ModelSeries": "",
                    "PartName": "",
                    "label": "",
                    "filename": "9.3-x.FCStd",
                },
            )
            self.assertFalse(out["filled"])

    def test_label_recommend_uses_formula_not_embedded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("parts/a.FCStd")
            fcstd = root / rel
            _write_fcstd(fcstd, label="100001.001-旧格式内部名")

            doc = FcstdMapDocument(
                entries=[
                    FcstdMapEntry(
                        repo_rel_path="./parts/a.FCStd",
                        filename="a.FCStd",
                        PartNumber="100001",
                        PartVersion="001",
                        TypeCode="H",
                        PartName="表单名",
                        label="100001.001-旧格式内部名",
                    )
                ]
            )
            save_fcstd_document(root, doc, scan_root=".", stats={"total_entries": 1})

            out = recommend_bom_field(
                root,
                rel,
                "label",
                {
                    "PartNumber": "100001",
                    "PartVersion": "001",
                    "TypeCode": "H",
                    "ModelSeries": "",
                    "PartName": "表单名",
                    "label": "100001.001-旧格式内部名",
                    "filename": fcstd.name,
                },
            )
            self.assertTrue(out["filled"])
            self.assertEqual(out["value"], "100001.001-表单名")
            self.assertIn("编号公式", str(out["source_note"]))

    def test_assy_suffix_recognized_as_fcstd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("parts/100001.001-H-本体.ASSY.FCStd")
            fcstd = root / rel
            _write_fcstd(fcstd, label="100001.001-本体")

            from phoenix.services.bom_apply_service import load_bom_preview

            preview = load_bom_preview(root, rel)
            self.assertTrue(preview.is_fcstd)
            self.assertIsNotNone(preview.file_size_bytes)
            self.assertGreater(preview.file_size_bytes or 0, 0)
            self.assertTrue(preview.file_size_display)

            out = recommend_bom_field(
                root,
                rel,
                "label",
                {
                    "PartNumber": "100001",
                    "PartVersion": "001",
                    "TypeCode": "H",
                    "ModelSeries": "",
                    "PartName": "本体",
                    "label": "",
                    "filename": fcstd.name,
                },
            )
            self.assertTrue(out["filled"])
            self.assertEqual(out["value"], "100001.001-本体")

    def test_label_formula_uses_part_name_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("parts/b.FCStd")
            fcstd = root / rel
            _write_fcstd(fcstd, label="")

            out = recommend_bom_field(
                root,
                rel,
                "label",
                {
                    "PartNumber": "100002",
                    "PartVersion": "001",
                    "TypeCode": "H",
                    "ModelSeries": "ABC",
                    "PartName": "磁芯",
                    "label": "",
                    "filename": fcstd.name,
                },
            )
            self.assertTrue(out["filled"])
            self.assertEqual(out["value"], "100002.001-磁芯")
            self.assertIn("编号公式", str(out["source_note"]))

    def test_recommend_from_filename_without_reading_fcstd(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("parts/100003.002-S-M6X12螺栓.FCStd")
            # 故意不写有效 FCStd，仅依赖文件名推断 + 空索引
            out = recommend_bom_field(
                root,
                rel,
                "PartNumber",
                {
                    "PartNumber": "",
                    "PartVersion": "",
                    "TypeCode": "",
                    "ModelSeries": "",
                    "PartName": "",
                    "label": "",
                    "filename": rel.name,
                },
            )
            self.assertTrue(out["filled"])
            self.assertEqual(out["value"], "100003")
            self.assertIn("文件名", str(out["source_note"]))

    def test_recommend_all_fields_single_pass(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("parts/100001.001-H-本体.FCStd")
            fcstd = root / rel
            _write_fcstd(fcstd, label="100001.001-本体")

            doc = FcstdMapDocument(
                entries=[
                    FcstdMapEntry(
                        repo_rel_path="./parts/100001.001-H-本体.FCStd",
                        filename="100001.001-H-本体.FCStd",
                        PartNumber="100001",
                        PartVersion="001",
                        TypeCode="H",
                        PartName="本体",
                    )
                ]
            )
            save_fcstd_document(root, doc, scan_root=".", stats={"total_entries": 1})

            out = recommend_bom_fields_all(
                root,
                rel,
                {
                    "PartNumber": "",
                    "PartVersion": "",
                    "TypeCode": "",
                    "ModelSeries": "",
                    "PartName": "",
                    "label": "",
                    "filename": fcstd.name,
                },
            )
            self.assertIn("PartNumber", out["filled_keys"])
            self.assertEqual(out["results"]["PartNumber"]["value"], "100001")
            self.assertIn("PartVersion", out["filled_keys"])

    def test_standard_part_clears_model_series_recommend(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = recommend_bom_field(
                root,
                Path("parts/bolt.FCStd"),
                "ModelSeries",
                {
                    "PartNumber": "8007",
                    "PartVersion": "001",
                    "TypeCode": "S",
                    "ModelSeries": "PX",
                    "PartName": "M6X12螺栓",
                    "label": "",
                    "filename": "bolt.FCStd",
                },
            )
            self.assertTrue(out["filled"])
            self.assertEqual(out["value"], "")
            self.assertIn("标准件", str(out["source_note"]))


if __name__ == "__main__":
    unittest.main()
