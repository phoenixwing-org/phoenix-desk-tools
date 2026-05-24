"""fcdesk.fcstd_embedded_attrs：ZIP 内 FcdeskBomAttrs.xml 读写。"""

import zipfile
from pathlib import Path

import unittest

from fcdesk.fcstd_embedded_attrs import (
    EMBEDDED_BOM_XML,
    read_embedded_bom_attrs,
    write_embedded_bom_attrs,
)


class EmbeddedBomAttrsTest(unittest.TestCase):
    def test_write_read_and_remove(self) -> None:
        td = Path(self.tmp)
        fc = td / "x.FCStd"
        fc.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(fc, "w") as z:
            z.writestr("Document.xml", b"<Document/>")

        write_embedded_bom_attrs(
            fc,
            {"PartNumber": "100346", "PartVersion": "001", "TypeCode": "H", "ModelSeries": "3TB", "label": "灯座"},
        )
        got = read_embedded_bom_attrs(fc)
        self.assertEqual(got["PartNumber"], "100346")
        self.assertEqual(got["PartVersion"], "001")
        self.assertEqual(got["TypeCode"], "H")
        self.assertEqual(got["ModelSeries"], "3TB")
        self.assertEqual(got["label"], "灯座")

        write_embedded_bom_attrs(fc, {k: "" for k in ("PartNumber", "PartVersion", "TypeCode", "ModelSeries", "label")})
        with zipfile.ZipFile(fc, "r") as z:
            self.assertNotIn(EMBEDDED_BOM_XML, z.namelist())

    def setUp(self) -> None:
        import tempfile

        self.tmp = tempfile.mkdtemp(prefix="fcdesk_embedded_")

    def tearDown(self) -> None:
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
