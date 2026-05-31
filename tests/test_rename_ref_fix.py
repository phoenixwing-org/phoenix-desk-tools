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
   <Properties Count="1">
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
     <XLink file="../parts/child.FCStd"/>
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
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)

            groups = analyze_workspace_xlink_refs(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
            )
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0].hit_count, 2)

            n = apply_host_xlink_corrections(
                root,
                groups[0].host_repo_rel_path,
                list(groups[0].hits),
            )
            self.assertEqual(n, 2)

            xml = zipfile.ZipFile(root / "asm.FCStd").read("Document.xml").decode("utf-8")
            self.assertIn('file="new.FCStd"', xml)
            self.assertIn('file="../parts/new.FCStd"', xml)
            self.assertNotIn("child.FCStd", xml)

    def test_rename_service_flow(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
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
            _write_fcstd(root / "child.FCStd", "<Document/>")
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


if __name__ == "__main__":
    unittest.main()
