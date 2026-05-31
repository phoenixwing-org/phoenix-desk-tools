"""CAD 索引文件类型识别。"""

from __future__ import annotations

import unittest

from fcdesk.freecad.cad_index_types import (
    ASSET_KIND_CAD_EXCHANGE,
    ASSET_KIND_FCSTD,
    ASSET_KIND_IMAGE,
    ASSET_KIND_MARKDOWN,
    ASSET_KIND_PDF,
    cad_asset_kind,
    is_cad_index_filename,
)


class TestCadIndexTypes(unittest.TestCase):
    def test_is_cad_index_filename(self) -> None:
        self.assertTrue(is_cad_index_filename("part.FCStd"))
        self.assertTrue(is_cad_index_filename("readme.md"))
        self.assertTrue(is_cad_index_filename("drawing.PDF"))
        self.assertTrue(is_cad_index_filename("sheet.dxf"))
        self.assertTrue(is_cad_index_filename("photo.JPG"))
        self.assertFalse(is_cad_index_filename("notes.txt"))
        self.assertFalse(is_cad_index_filename("model.step"))

    def test_cad_asset_kind(self) -> None:
        self.assertEqual(cad_asset_kind("a.FCStd"), ASSET_KIND_FCSTD)
        self.assertEqual(cad_asset_kind("doc.md"), ASSET_KIND_MARKDOWN)
        self.assertEqual(cad_asset_kind("spec.MARKDOWN"), ASSET_KIND_MARKDOWN)
        self.assertEqual(cad_asset_kind("manual.pdf"), ASSET_KIND_PDF)
        self.assertEqual(cad_asset_kind("layout.dwg"), ASSET_KIND_CAD_EXCHANGE)
        self.assertEqual(cad_asset_kind("outline.dxf"), ASSET_KIND_CAD_EXCHANGE)
        self.assertEqual(cad_asset_kind("thumb.png"), ASSET_KIND_IMAGE)


if __name__ == "__main__":
    unittest.main()
