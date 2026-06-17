"""属性回写：改名与写入并改名。"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from phoenix.services.bom_apply_service import has_unsaved_document_attrs, rename_bom_fcstd_file

_MIN_DOC = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="1">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="old"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


def _write_fcstd(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Document.xml", _MIN_DOC.encode("utf-8"))


class TestBomRename(unittest.TestCase):
    def test_blocks_rename_when_unsaved_without_write_flag(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("a.FCStd")
            _write_fcstd(root / rel)
            baseline = {"PartNumber": "1", "label": "old"}
            current = {"PartNumber": "2", "label": "new"}
            self.assertTrue(has_unsaved_document_attrs(baseline, current))
            with self.assertRaises(ValueError) as ctx:
                rename_bom_fcstd_file(
                    root,
                    rel,
                    "b.FCStd",
                    baseline=baseline,
                    current=current,
                )
            self.assertIn("写入并改名", str(ctx.exception))

    def test_write_attrs_first_then_rename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            rel = Path("old.FCStd")
            _write_fcstd(root / rel)
            baseline = {"PartNumber": "1", "PartVersion": "", "TypeCode": "", "ModelSeries": "", "PartName": "", "label": "old"}
            current = {
                "PartNumber": "100001",
                "PartVersion": "001",
                "TypeCode": "H",
                "ModelSeries": "",
                "PartName": "本体",
                "label": "100001.001-H-本体",
                "filename": "new.FCStd",
            }
            out = rename_bom_fcstd_file(
                root,
                rel,
                "new.FCStd",
                baseline=baseline,
                current=current,
                write_attrs_first=True,
            )
            self.assertTrue(out["attrs_saved"])
            self.assertEqual(out["filename"], "new.FCStd")
            self.assertFalse((root / "old.FCStd").exists())
            self.assertTrue((root / "new.FCStd").is_file())


if __name__ == "__main__":
    unittest.main()
