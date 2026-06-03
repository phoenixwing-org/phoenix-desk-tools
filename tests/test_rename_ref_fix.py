"""文件改名引用扫描与修正。"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from fcdesk.freecad.rename_analysis import (
    analyze_workspace_xlink_refs,
    apply_host_xlink_corrections,
    replace_basename_in_xlink_attr,
)
from fcdesk.services.rename_analysis_service import (
    analyze_rename_references,
    apply_rename_analysis_corrections,
    export_rename_analysis_report,
    list_rename_logs_payload,
)
from fcdesk.services.rename_ref_service import execute_file_rename


def _write_fcstd(path: Path, xml: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Document.xml", xml.encode("utf-8"))


_HOST_XML = """<?xml version="1.0"?>
<Document>
 <Objects Count="1">
  <Object type="App::Part" name="Asm"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Asm">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="child-old"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
     <XLink file="../parts/child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""

_CHILD_XML = """<?xml version="1.0"?>
<Document>
 <Objects Count="1">
  <Object type="PartDesign::Body" name="Body" id="1"/>
 </Objects>
 <ObjectData Count="1">
  <Object name="Body">
   <Properties Count="1">
    <Property name="Label" type="App::PropertyString" status="134217728">
     <String value="100001.001-子件"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


class TestRenameRefFix(unittest.TestCase):
    def test_replace_basename_in_attr(self) -> None:
        self.assertEqual(
            replace_basename_in_xlink_attr("child.FCStd", "child.FCStd", "new.FCStd"),
            "new.FCStd",
        )
        self.assertEqual(
            replace_basename_in_xlink_attr("../parts/child.FCStd", "child.FCStd", "new.FCStd"),
            "../parts/new.FCStd",
        )
        self.assertIsNone(replace_basename_in_xlink_attr("other.FCStd", "child.FCStd", "new.FCStd"))

    def test_scan_and_patch_host(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(root / "asm.FCStd", _HOST_XML)

            groups = analyze_workspace_xlink_refs(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
            )
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0].hit_count, 2)

            n_x, n_l = apply_host_xlink_corrections(
                root,
                groups[0].host_repo_rel_path,
                list(groups[0].hits),
                sync_reference_labels=False,
            )
            self.assertEqual(n_x, 2)
            self.assertEqual(n_l, 0)

            xml = zipfile.ZipFile(root / "asm.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('file="new.FCStd"', xml)
            self.assertIn('file="../parts/new.FCStd"', xml)
            self.assertNotIn("child.FCStd", xml)

    def test_rename_service_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan

            run_fcstd_map_scan(root)

            out = execute_file_rename(
                root,
                Path("child.FCStd"),
                new_filename="new.FCStd",
                baseline={"PartNumber": "1"},
                current={"PartNumber": "1", "filename": "new.FCStd"},
            )
            rid = int(out["rename_log_id"])
            self.assertFalse((root / "child.FCStd").exists())
            self.assertTrue((root / "new.FCStd").is_file())

            scan = analyze_rename_references(root, rename_log_id=rid)
            self.assertEqual(scan["host_count"], 1)
            self.assertEqual(scan["hit_count"], 2)

            apply_out = apply_rename_analysis_corrections(
                root,
                rename_log_id=rid,
                host_repo_rel_paths=[scan["hosts"][0]["host_repo_rel_path"]],
            )
            self.assertEqual(apply_out["xlink_patches"], 2)
            xml = zipfile.ZipFile(root / "asm.FCStd").read("Document.xml").decode("utf-8")
            self.assertNotIn("child.FCStd", xml)

    def test_manual_analyze_and_apply_without_rename_log(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan

            run_fcstd_map_scan(root)

            scan = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
                persist=False,
            )
            self.assertEqual(scan["host_count"], 1)
            host = scan["hosts"][0]["host_repo_rel_path"]

            out = apply_rename_analysis_corrections(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
                host_repo_rel_paths=[host],
            )
            self.assertEqual(out["xlink_patches"], 2)

    def test_list_logs_and_export_report(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            execute_file_rename(
                root,
                Path("child.FCStd"),
                new_filename="new.FCStd",
                baseline={"PartNumber": "1"},
                current={"PartNumber": "1", "filename": "new.FCStd"},
            )
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan

            run_fcstd_map_scan(root)
            logs = list_rename_logs_payload(root)
            self.assertEqual(len(logs["entries"]), 1)

            scan = analyze_rename_references(root, rename_log_id=logs["entries"][0]["id"])
            report = export_rename_analysis_report(
                root,
                scan=scan,
                rename_log_id=logs["entries"][0]["id"],
            )
            self.assertTrue(Path(report["report_path"]).is_file())


    def test_apply_syncs_reference_label_single(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(root / "asm-single.FCStd", """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="Asm">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="child-old"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>""")

            groups = analyze_workspace_xlink_refs(
                root,
                old_basename="child.FCStd",
                new_basename="new-child.FCStd",
            )
            n_x, n_l = apply_host_xlink_corrections(
                root,
                groups[0].host_repo_rel_path,
                list(groups[0].hits),
                sync_reference_labels=True,
            )
            self.assertEqual(n_x, 1)
            self.assertEqual(n_l, 1)
            xml = zipfile.ZipFile(root / "asm-single.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="100001.001-子件"', xml)

    def test_apply_syncs_reference_label_multi_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(
                root / "asm-multi.FCStd",
                """<?xml version="1.0"?>
<Document>
 <ObjectData Count="2">
  <Object name="Link1">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="child-old-1"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
  <Object name="Link2">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="child-old-2"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="../parts/child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>""",
            )
            (root / "parts").mkdir()
            (root / "parts" / "child.FCStd").write_bytes((root / "child.FCStd").read_bytes())

            groups = analyze_workspace_xlink_refs(
                root,
                old_basename="child.FCStd",
                new_basename="new-child.FCStd",
            )
            n_x, n_l = apply_host_xlink_corrections(
                root,
                groups[0].host_repo_rel_path,
                list(groups[0].hits),
                sync_reference_labels=True,
            )
            self.assertEqual(n_x, 2)
            self.assertEqual(n_l, 2)
            xml = zipfile.ZipFile(root / "asm-multi.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="100001.001-子件"', xml)
            self.assertNotIn('String value="100001.001-子件.001"', xml)

    def test_apply_syncs_reference_label_same_first_level_group(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(root / "asm-dual.FCStd", _HOST_XML)

            groups = analyze_workspace_xlink_refs(
                root,
                old_basename="child.FCStd",
                new_basename="new-child.FCStd",
            )
            n_x, n_l = apply_host_xlink_corrections(
                root,
                groups[0].host_repo_rel_path,
                list(groups[0].hits),
                sync_reference_labels=True,
            )
            self.assertEqual(n_x, 2)
            self.assertEqual(n_l, 1)
            xml = zipfile.ZipFile(root / "asm-dual.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="100001.001-子件.002"', xml)


    def test_apply_reference_labels_without_xlink_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(
                root / "asm-single.FCStd",
                """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="Asm">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="child-old"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>""",
            )
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan
            from fcdesk.services.rename_analysis_service import apply_reference_label_corrections

            run_fcstd_map_scan(root)
            scan = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
                persist=False,
            )
            host = scan["hosts"][0]["host_repo_rel_path"]
            out = apply_reference_label_corrections(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
                host_repo_rel_paths=[host],
            )
            self.assertEqual(out["xlink_patches"], 0)
            self.assertGreaterEqual(out["label_patches"], 1)
            xml = zipfile.ZipFile(root / "asm-single.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="100001.001-子件"', xml)

    def test_apply_host_all_reference_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            other_xml = _CHILD_XML.replace("100001.001-子件", "900001.001-其它")
            _write_fcstd(root / "other.FCStd", other_xml)
            _write_fcstd(
                root / "asm-dual-target.FCStd",
                """<?xml version="1.0"?>
<Document>
 <ObjectData Count="2">
  <Object name="Link1">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="old-a"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
  <Object name="Link2">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="old-b"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="other.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>""",
            )
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan
            from fcdesk.services.rename_analysis_service import apply_reference_label_corrections

            run_fcstd_map_scan(root)
            out = apply_reference_label_corrections(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
                host_repo_rel_paths=["asm-dual-target.FCStd"],
                label_scope="host_all",
            )
            self.assertGreaterEqual(out["label_patches"], 2)
            xml = zipfile.ZipFile(root / "asm-dual-target.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="100001.001-子件"', xml)
            self.assertIn('String value="900001.001-其它"', xml)

    def test_apply_host_all_without_basename_args(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(root / "asm-single.FCStd", _HOST_XML)
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan
            from fcdesk.services.rename_analysis_service import apply_reference_label_corrections

            run_fcstd_map_scan(root)
            out = apply_reference_label_corrections(
                root,
                host_repo_rel_paths=["asm-single.FCStd"],
                label_scope="host_all",
            )
            self.assertGreaterEqual(out["label_patches"], 1)
            self.assertEqual(out["scan"]["host_count"], 0)

    def test_apply_incoming_labels_prefers_db_rule_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(
                root / "asm-single.FCStd",
                """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="Asm">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="child-old"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>""",
            )
            from fcdesk.freecad.phoenix_store import connect
            from fcdesk.services.fcstd_map_service import run_fcstd_map_scan
            from fcdesk.services.rename_analysis_service import apply_reference_label_corrections

            run_fcstd_map_scan(root)
            with connect(root) as conn:
                conn.execute(
                    """
                    UPDATE file_asset
                    SET part_number = ?, part_version = ?, part_name = ?, label = ?
                    WHERE repo_rel_path = ?
                    """,
                    ("200002", "002", "规则名", "", "./child.FCStd"),
                )
            out = apply_reference_label_corrections(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
                host_repo_rel_paths=["asm-single.FCStd"],
                label_scope="incoming",
            )
            self.assertGreaterEqual(out["label_patches"], 1)
            xml = zipfile.ZipFile(root / "asm-single.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="200002.002-规则名"', xml)
            self.assertNotIn('String value="100001.001-子件"', xml)

    def test_apply_explicit_link_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", _CHILD_XML)
            _write_fcstd(
                root / "asm-single.FCStd",
                """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="Asm">
   <Properties Count="2">
    <Property name="Label" type="App::PropertyString">
     <String value="手工旧名"/>
    </Property>
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>""",
            )
            from fcdesk.services.bom_xref_service import apply_explicit_link_labels

            out = apply_explicit_link_labels(
                root,
                [
                    {
                        "host_repo_rel": "asm-single.FCStd",
                        "xlink_file_attr": "child.FCStd",
                        "link_label": "自定义标签",
                    }
                ],
            )
            self.assertEqual(out["label_patches"], 1)
            xml = zipfile.ZipFile(root / "asm-single.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('String value="自定义标签"', xml)
            self.assertNotIn("手工旧名", xml)


if __name__ == "__main__":
    unittest.main()
