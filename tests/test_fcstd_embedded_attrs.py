"""fcdesk.fcstd_embedded_attrs：Document.xml Body Property 读写与旧侧车迁移。"""

import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import unittest

from fcdesk.fcstd_document_bom_props import FCDESK_EMBEDDED_BOM_PROPERTY_GROUP
from fcdesk.fcstd_embedded_attrs import (
    EDITABLE_ENTRY_ATTRS,
    EMBEDDED_BOM_XML,
    read_embedded_bom_attrs,
    write_embedded_bom_attrs,
)


MIN_DOC_TEMPLATE = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="1">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="init-label"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


MIN_DOC_TEMPLATE_WITH_REFERENCE_USER_PROP = """<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="init-label"/>
    </Property>
    <Property name="TempKevin" type="App::PropertyString" group="Base" doc="" attr="X9" ro="0" hide="1" status="999991">
     <String value="ref"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


def _prop_value_from_document_xml(xml_bytes: bytes, prop_local_name: str) -> str | None:
    doc_el = ET.fromstring(xml_bytes.decode("utf-8"))
    od_root = doc_el.find("ObjectData")
    assert od_root is not None
    body = od_root.find("Object[@name='Body']")
    if body is None:
        body = od_root.find("Object")
    assert body is not None
    props = body.find("Properties")
    assert props is not None
    for p in props.findall("Property"):
        if p.get("name") == prop_local_name:
            s_el = p.find("String")
            if s_el is not None:
                return (s_el.get("value") or "").strip()
    return None


def _properties_count(xml_bytes: bytes) -> str | None:
    doc_el = ET.fromstring(xml_bytes.decode("utf-8"))
    od_root = doc_el.find("ObjectData")
    assert od_root is not None
    body = od_root.find("Object[@name='Body']")
    if body is None:
        body = od_root.find("Object")
    props = body.find("Properties")
    assert props is not None
    return props.get("Count")


def _property_wrapper_attrib(xml_bytes: bytes, prop_local_name: str) -> dict[str, str]:
    doc_el = ET.fromstring(xml_bytes.decode("utf-8"))
    od_root = doc_el.find("ObjectData")
    assert od_root is not None
    body = od_root.find("Object[@name='Body']")
    if body is None:
        body = od_root.find("Object")
    props = body.find("Properties")
    assert props is not None
    for p in props.findall("Property"):
        if p.get("name") == prop_local_name:
            return dict(p.attrib)
    return {}


class EmbeddedBomAttrsTest(unittest.TestCase):
    def test_write_read_via_document_xml(self) -> None:
        td = Path(self.tmp)
        fc = td / "x.FCStd"
        fc.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(fc, "w") as z:
            z.writestr("Document.xml", MIN_DOC_TEMPLATE.strip().encode("utf-8"))

        vals = {
            "PartNumber": "100346",
            "PartVersion": "001",
            "TypeCode": "H",
            "ModelSeries": "3TB",
            "PartName": "外壳",
            "label": "灯座",
        }
        write_embedded_bom_attrs(fc, vals)

        got = read_embedded_bom_attrs(fc)
        self.assertEqual(got["PartNumber"], "100346")
        self.assertEqual(got["PartVersion"], "001")
        self.assertEqual(got["TypeCode"], "H")
        self.assertEqual(got["ModelSeries"], "3TB")
        self.assertEqual(got["PartName"], "外壳")
        self.assertEqual(got["label"], "灯座")

        with zipfile.ZipFile(fc, "r") as z:
            self.assertNotIn(EMBEDDED_BOM_XML, z.namelist())
            raw = z.read("Document.xml")
        self.assertEqual(_prop_value_from_document_xml(raw, "PartNumber"), "100346")
        self.assertEqual(_prop_value_from_document_xml(raw, "Label"), "灯座")
        self.assertEqual(
            _property_wrapper_attrib(raw, "PartNumber").get("group"),
            FCDESK_EMBEDDED_BOM_PROPERTY_GROUP,
        )
        self.assertEqual(_property_wrapper_attrib(raw, "PartNumber").get("doc"), "零件号")
        self.assertEqual(_property_wrapper_attrib(raw, "PartVersion").get("doc"), "零件版本")
        self.assertEqual(_prop_value_from_document_xml(raw, "PartName"), "外壳")

        write_embedded_bom_attrs(fc, {k: "" for k in EDITABLE_ENTRY_ATTRS})
        with zipfile.ZipFile(fc, "r") as z:
            raw_after = z.read("Document.xml")
        self.assertIsNone(_prop_value_from_document_xml(raw_after, "PartNumber"))

    def test_attributes_persist_with_document_payload(self) -> None:
        td = Path(self.tmp)
        fc = td / "part.FCStd"
        fc.parent.mkdir(parents=True, exist_ok=True)
        doc_stub = MIN_DOC_TEMPLATE.strip().encode("utf-8")
        gui_stub = b"<?xml version='1.0'?><GuiDocument/>"
        with zipfile.ZipFile(fc, "w") as z:
            z.writestr("Document.xml", doc_stub)
            z.writestr("GuiDocument.xml", gui_stub)

        vals = {
            "PartNumber": "PN-9",
            "PartVersion": "003",
            "TypeCode": "S",
            "ModelSeries": "KV",
            "PartName": "支座",
            "label": "试件",
        }
        write_embedded_bom_attrs(fc, vals)

        with zipfile.ZipFile(fc, "r") as z:
            names = z.namelist()
            raw_doc = z.read("Document.xml")
            gui_got = z.read("GuiDocument.xml")
        self.assertNotIn(EMBEDDED_BOM_XML, names)
        self.assertNotEqual(raw_doc, doc_stub)
        self.assertEqual(gui_got, gui_stub)

        self.assertEqual(_prop_value_from_document_xml(raw_doc, "PartNumber"), "PN-9")
        self.assertEqual(_prop_value_from_document_xml(raw_doc, "PartVersion"), "003")

        ct = _properties_count(raw_doc)
        self.assertEqual(ct, str(len(EDITABLE_ENTRY_ATTRS)))
        raw_xml_preview = raw_doc.decode("utf-8")
        self.assertIn("PartNumber", raw_xml_preview)
        self.assertNotIn("TempKevin", raw_xml_preview)

        self.assertEqual(read_embedded_bom_attrs(fc), vals)

    def test_bom_props_clone_property_wrapper_from_existing_user_strings(self) -> None:
        """Bitmask 等与参照一致；分组为 ``CustomDefine``（``FCDESK_EMBEDDED_BOM_PROPERTY_GROUP``），且 ``doc`` 为工具提示。"""
        td = Path(self.tmp)
        fc = td / "ref.FCStd"
        fc.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(fc, "w") as z:
            z.writestr(
                "Document.xml",
                MIN_DOC_TEMPLATE_WITH_REFERENCE_USER_PROP.strip().encode("utf-8"),
            )
        vals = dict.fromkeys(EDITABLE_ENTRY_ATTRS, "")
        vals["PartNumber"] = "cloned-wrap"
        write_embedded_bom_attrs(fc, vals)
        with zipfile.ZipFile(fc, "r") as z:
            xml = z.read("Document.xml")
        ref_wrap = _property_wrapper_attrib(xml, "TempKevin")
        pn_wrap = _property_wrapper_attrib(xml, "PartNumber")
        r_name = ref_wrap.pop("name", None)
        p_name = pn_wrap.pop("name", None)
        self.assertEqual(r_name, "TempKevin")
        self.assertEqual(p_name, "PartNumber")
        self.assertEqual(ref_wrap.pop("group", None), "Base")
        self.assertEqual(ref_wrap.pop("doc", None), "")
        self.assertEqual(pn_wrap.pop("group", None), FCDESK_EMBEDDED_BOM_PROPERTY_GROUP)
        self.assertEqual(pn_wrap.pop("doc", None), "零件号")
        self.assertEqual(pn_wrap, ref_wrap)

    def test_legacy_sidecar_fallback_until_saved(self) -> None:
        td = Path(self.tmp)
        fc = td / "mig.FCStd"
        fc.parent.mkdir(parents=True, exist_ok=True)
        legacy = (
            "<?xml version='1.0' encoding='utf-8'?>"
            '<FcdeskBomAttrs version="1">'
            "<PartNumber>LEG-99</PartNumber>"
            "</FcdeskBomAttrs>"
        )
        with zipfile.ZipFile(fc, "w") as z:
            z.writestr("Document.xml", MIN_DOC_TEMPLATE.strip().encode("utf-8"))
            z.writestr(EMBEDDED_BOM_XML, legacy.encode("utf-8"))

        got = read_embedded_bom_attrs(fc)
        self.assertEqual(got["PartNumber"], "LEG-99")

        mig = {k: "" for k in EDITABLE_ENTRY_ATTRS}
        mig["PartNumber"] = "LEG-99"
        write_embedded_bom_attrs(fc, mig)
        with zipfile.ZipFile(fc, "r") as z:
            self.assertNotIn(EMBEDDED_BOM_XML, z.namelist())
            pn = _prop_value_from_document_xml(z.read("Document.xml"), "PartNumber")
        self.assertEqual(pn, "LEG-99")

    def setUp(self) -> None:
        import tempfile

        self.tmp = tempfile.mkdtemp(prefix="fcdesk_embedded_")

    def tearDown(self) -> None:
        import shutil

        shutil.rmtree(self.tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
