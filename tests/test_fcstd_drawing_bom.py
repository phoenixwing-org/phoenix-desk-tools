"""图纸-primary FCStd：App::Link 挂载与只读 BOM 解析。"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from phoenix.freecad.fcstd_document_bom_props import (
    _first_bom_target_object_name,
    is_drawing_primary_mount_context,
    read_body_bom_from_document,
)
from phoenix.freecad.fcstd_drawing_bom import (
    _iter_model_xlink_candidates,
    _linked_object_fcstd_attr,
    resolve_drawing_bom,
)
from phoenix.freecad.fcstd_embedded_attrs import write_embedded_bom_attrs
from phoenix.services.bom_apply_service import load_bom_preview, save_bom_to_fcstd

MODEL_DOC = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="1">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="init"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""

DRAWING_DOC = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="2">
  <Object type="TechDraw::DrawPage" name="Page" id="1"/>
  <Object type="App::Link" name="Link" id="2"/>
 </Objects>
 <ObjectData Count="2">
  <Object name="Page">
   <Properties Count="1">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="Page"/>
    </Property>
   </Properties>
  </Object>
  <Object name="Link">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="Link"/>
    </Property>
    <Property name="LinkedObject" type="App::PropertyXLink">
     <XLink file="8003.001-H-PX-滑轨.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""

_FIXTURES = Path(__file__).resolve().parent / "fixtures/workspaces/minimal/document-xml"
SAMPLE_LINK_DRAWING = _FIXTURES / "图纸-通过link来创建-Document.xml"
SAMPLE_INTERNAL_ASSY = _FIXTURES / "内部装配示例-Document.xml"


def _write_fcstd(path: Path, xml: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Document.xml", xml.strip().encode("utf-8"))


class DrawingBomTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="phoenix_drawing_bom_")
        self.root = Path(self.tmp)

    def test_internal_assy_mounts_on_structural_root_part(self) -> None:
        import xml.etree.ElementTree as ET

        self.assertTrue(SAMPLE_INTERNAL_ASSY.is_file(), SAMPLE_INTERNAL_ASSY)
        doc_el = ET.fromstring(SAMPLE_INTERNAL_ASSY.read_text(encoding="utf-8"))
        self.assertEqual(_first_bom_target_object_name(doc_el), "PCB")

    def test_drawing_primary_mounts_on_app_link(self) -> None:
        import xml.etree.ElementTree as ET

        doc_el = ET.fromstring(DRAWING_DOC)
        self.assertTrue(is_drawing_primary_mount_context(doc_el))
        self.assertEqual(_first_bom_target_object_name(doc_el), "Link")

    def test_resolve_drawing_bom_from_xlink_model(self) -> None:
        model = self.root / "8003.001-H-PX-滑轨.FCStd"
        drawing = self.root / "8003.001-H-PX-滑轨.Drawing.FCStd"
        _write_fcstd(model, MODEL_DOC)
        _write_fcstd(drawing, DRAWING_DOC)
        write_embedded_bom_attrs(
            model,
            {
                "PartNumber": "8003",
                "PartVersion": "001",
                "TypeCode": "H",
                "ModelSeries": "PX",
                "PartName": "滑轨",
                "label": "8003.001-滑轨",
            },
        )

        res = resolve_drawing_bom(self.root, drawing.name, drawing)
        self.assertIsNotNone(res)
        assert res is not None
        self.assertTrue(res.readonly)
        self.assertEqual(res.source_repo_rel, f"./{model.name}")
        self.assertEqual(res.values["PartNumber"], "8003")
        self.assertEqual(res.values["PartVersion"], "001")
        self.assertEqual(res.values["PartName"], "滑轨")

    def test_load_bom_preview_marks_drawing_readonly(self) -> None:
        model = self.root / "part.FCStd"
        drawing = self.root / "part.Drawing.FCStd"
        _write_fcstd(model, MODEL_DOC)
        drawing_xml = DRAWING_DOC.replace("8003.001-H-PX-滑轨.FCStd", "part.FCStd")
        _write_fcstd(drawing, drawing_xml)
        write_embedded_bom_attrs(
            model,
            {
                "PartNumber": "100",
                "PartVersion": "002",
                "TypeCode": "S",
                "ModelSeries": "A",
                "PartName": "轴",
                "label": "100.002-轴",
            },
        )

        preview = load_bom_preview(self.root, Path(drawing.name))
        self.assertTrue(preview.bom_readonly)
        self.assertEqual(preview.bom_source_rel, f"./{model.name}")
        self.assertEqual(preview.fields["PartNumber"], "100")

    def test_save_bom_rejects_drawing_primary(self) -> None:
        model = self.root / "m.FCStd"
        drawing = self.root / "m.Drawing.FCStd"
        _write_fcstd(model, MODEL_DOC)
        drawing_xml = DRAWING_DOC.replace("8003.001-H-PX-滑轨.FCStd", "m.FCStd")
        _write_fcstd(drawing, drawing_xml)

        with self.assertRaises(ValueError) as ctx:
            save_bom_to_fcstd(
                self.root,
                Path(drawing.name),
                {
                    "PartNumber": "9",
                    "PartVersion": "001",
                    "TypeCode": "H",
                    "ModelSeries": "X",
                    "PartName": "改",
                    "label": "x",
                },
            )
        self.assertIn("只读", str(ctx.exception))

        vals, _ = read_body_bom_from_document(model)
        self.assertEqual(vals.get("PartNumber", ""), "")

    def test_recommend_filename_for_drawing_with_xlink(self) -> None:
        from phoenix.services.bom_apply_service import recommend_filename_for_values

        model = self.root / "8003.001-H-PX-滑轨.FCStd"
        drawing = self.root / "8003.001-H-PX-滑轨.Drawing.FCStd"
        _write_fcstd(model, MODEL_DOC)
        _write_fcstd(drawing, DRAWING_DOC)
        write_embedded_bom_attrs(
            model,
            {
                "PartNumber": "8003",
                "PartVersion": "001",
                "TypeCode": "H",
                "ModelSeries": "PX",
                "PartName": "滑轨.Drawing.FCStd",
                "label": "8003.001-H-PX-滑轨",
            },
        )

        payload = recommend_filename_for_values(
            self.root,
            Path(drawing.name),
            {
                "PartNumber": "8003",
                "PartVersion": "001",
                "TypeCode": "H",
                "ModelSeries": "PX",
                "PartName": "滑轨.Drawing.FCStd",
                "label": "8003.001-H-PX-滑轨",
                "filename": drawing.name,
                "repo_rel_path": drawing.name,
            },
            fill_empty_from_prefs=False,
            original_filename=drawing.name,
            persist_prefs=False,
        )
        self.assertEqual(payload["recommended_filename"], drawing.name)
        self.assertEqual(payload["suffix"], ".Drawing.FCStd")

    def test_sample_link_drawing_linked_object(self) -> None:
        import xml.etree.ElementTree as ET

        self.assertTrue(SAMPLE_LINK_DRAWING.is_file(), SAMPLE_LINK_DRAWING)
        xml_text = SAMPLE_LINK_DRAWING.read_text(encoding="utf-8")
        doc_el = ET.fromstring(xml_text)
        self.assertEqual(_first_bom_target_object_name(doc_el), "Link")
        self.assertEqual(
            _linked_object_fcstd_attr(doc_el, "Link"),
            "8003.001-H-PHOENIX-滑轨.FCStd",
        )

        model = self.root / "8003.001-H-PHOENIX-滑轨.FCStd"
        drawing = self.root / "8003.001-H-PX-滑轨.Drawing.FCStd"
        _write_fcstd(model, MODEL_DOC)
        _write_fcstd(drawing, xml_text)
        write_embedded_bom_attrs(
            model,
            {
                "PartNumber": "8003",
                "PartVersion": "001",
                "TypeCode": "H",
                "ModelSeries": "PHOENIX",
                "PartName": "滑轨",
                "label": "8003.001-滑轨",
            },
        )

        res = resolve_drawing_bom(self.root, drawing.name, drawing)
        assert res is not None
        self.assertEqual(res.source_repo_rel, f"./{model.name}")
        self.assertEqual(res.values["PartNumber"], "8003")
        self.assertEqual(res.values["ModelSeries"], "PHOENIX")

        drawing_path = self.root / "sample.Drawing.FCStd"
        _write_fcstd(drawing_path, xml_text)
        attrs = _iter_model_xlink_candidates(
            doc_el, drawing_path, mount_name="Link", mount_type="App::Link"
        )
        self.assertEqual(attrs[0], "8003.001-H-PHOENIX-滑轨.FCStd")


if __name__ == "__main__":
    unittest.main()
