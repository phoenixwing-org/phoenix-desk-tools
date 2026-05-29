"""fcdesk.fcstd_document_kind：Document.xml 类别推断。"""

from __future__ import annotations

import unittest
import zipfile
from pathlib import Path
import tempfile
import shutil

from fcdesk.fcstd_document_kind import (
    FcstdDocumentKinds,
    FcstdKindFilters,
    classify_document_xml,
    kinds_match_filters,
    read_fcstd_document_kinds,
    recommend_fcstd_filename_suffix,
)

DOC_PART = """<?xml version='1.0' encoding='utf-8'?>
<Document><Objects Count="1">
  <Object type="PartDesign::Body" name="Body"/>
</Objects></Document>"""

DOC_ASSY = """<?xml version='1.0' encoding='utf-8'?>
<Document><Objects Count="1">
  <Object type="AssemblyWorkbench::Container" name="AssyRoot"/>
</Objects></Document>"""

DOC_DRAWING = """<?xml version='1.0' encoding='utf-8'?>
<Document><Objects Count="1">
  <Object type="TechDraw::DrawPage" name="Page"/>
</Objects></Document>"""

DOC_ASSY_DRAWING = """<?xml version='1.0' encoding='utf-8'?>
<Document><Objects Count="2">
  <Object type="AssemblyWorkbench::Container" name="AssyRoot"/>
  <Object type="TechDraw::DrawPage" name="Page"/>
</Objects></Document>"""

DOC_XLINK_ASSY = """<?xml version='1.0' encoding='utf-8'?>
<Document><Objects Count="1">
  <Object type="App::Part" name="Asm"/>
</Objects>
<ObjectData><Object name="Asm"><Properties>
<Property name="x" type="App::PropertyXLink"><XLink file="a.FCStd"/></Property>
</Properties></Object></ObjectData></Document>"""


class TestClassifyDocumentXml(unittest.TestCase):
    def test_part_body(self) -> None:
        k = classify_document_xml(DOC_PART)
        self.assertTrue(k.part)
        self.assertFalse(k.assembly)
        self.assertFalse(k.drawing)

    def test_assembly_container(self) -> None:
        k = classify_document_xml(DOC_ASSY)
        self.assertTrue(k.assembly)
        self.assertFalse(k.part)

    def test_drawing(self) -> None:
        k = classify_document_xml(DOC_DRAWING)
        self.assertTrue(k.drawing)
        self.assertEqual(recommend_fcstd_filename_suffix(k), ".Drawing.FCStd")

    def test_assy_and_drawing(self) -> None:
        k = classify_document_xml(DOC_ASSY_DRAWING)
        self.assertTrue(k.assembly and k.drawing)
        self.assertTrue(k.drawing_and_assembly)
        self.assertEqual(recommend_fcstd_filename_suffix(k), ".ASSY.FCStd")

    def test_xlink_without_body_is_assembly(self) -> None:
        k = classify_document_xml(DOC_XLINK_ASSY)
        self.assertTrue(k.assembly)


class TestKindFilters(unittest.TestCase):
    def test_drawing_and_assembly_filter(self) -> None:
        k = classify_document_xml(DOC_ASSY_DRAWING)
        f = FcstdKindFilters(part=False, assembly=False, drawing=False, drawing_and_assembly=True)
        self.assertTrue(kinds_match_filters(k, f))
        f2 = FcstdKindFilters(part=True, assembly=False, drawing=False, drawing_and_assembly=False)
        self.assertFalse(kinds_match_filters(k, f2))


class TestReadZip(unittest.TestCase):
    def test_read_from_fcstd_zip(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="fcdesk_kind_"))
        try:
            fc = td / "t.FCStd"
            with zipfile.ZipFile(fc, "w") as z:
                z.writestr("Document.xml", DOC_ASSY.encode("utf-8"))
            k = read_fcstd_document_kinds(fc)
            self.assertTrue(k.assembly)
        finally:
            shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
