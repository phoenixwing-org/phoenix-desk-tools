"""BOM XLink 引用关系表。"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path

from fcdesk.services.bom_xref_service import (
    host_ref_groups_from_db,
    rebuild_bom_xrefs,
    search_incoming_refs,
    search_outgoing_refs,
)
from fcdesk.services.fcstd_map_service import run_fcstd_map_scan
from fcdesk.services.rename_analysis_service import analyze_rename_references
from fcdesk.services.rename_ref_service import execute_file_rename


def _write_fcstd(path: Path, xml: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("Document.xml", xml.encode("utf-8"))


_HOST_XML = """<?xml version="1.0"?>
<Document>
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

_SUB_ASM_XML = """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="SubAsm">
   <Properties Count="1">
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="leaf.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""

_TOP_ASM_XML = """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="TopAsm">
   <Properties Count="1">
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="sub/sub-assy.FCStd"/>
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""


class TestBomXref(unittest.TestCase):
    def test_index_builds_xref_table(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)

            out = run_fcstd_map_scan(root)
            xref = out.get("bom_xref") or {}
            self.assertGreaterEqual(xref.get("edge_count", 0), 2)

            incoming = search_incoming_refs(root, basename="child.FCStd")
            self.assertEqual(incoming["count"], 1)
            partial = search_incoming_refs(root, basename="child")
            self.assertEqual(partial["count"], 1)
            self.assertEqual(incoming["direct_count"], 1)
            self.assertEqual(len(incoming["refs"]), 2)
            hosts = {h["host_repo_rel_path"] for h in incoming["hosts"]}
            self.assertEqual(hosts, {"./asm.FCStd"})

            outgoing = search_outgoing_refs(root, "./asm.FCStd")
            self.assertEqual(outgoing["count"], 2)

    def test_nested_assembly_refs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)

            run_fcstd_map_scan(root)

            leaf_in = search_incoming_refs(root, basename="leaf.FCStd")
            self.assertEqual(leaf_in["count"], 2)
            host_paths = {h["host_repo_rel_path"] for h in leaf_in["hosts"]}
            self.assertEqual(host_paths, {"./sub/sub-assy.FCStd", "./top-assy.FCStd"})
            depths = {h["host_repo_rel_path"]: h["depth"] for h in leaf_in["hosts"]}
            self.assertEqual(depths["./sub/sub-assy.FCStd"], 0)
            self.assertEqual(depths["./top-assy.FCStd"], 1)
            top_host = next(h for h in leaf_in["hosts"] if h["host_repo_rel_path"] == "./top-assy.FCStd")
            self.assertEqual(top_host["via_chain"], ["./sub/sub-assy.FCStd"])

            direct_only = search_incoming_refs(root, basename="leaf.FCStd", transitive=False)
            self.assertEqual(direct_only["count"], 1)
            self.assertEqual(direct_only["hosts"][0]["host_repo_rel_path"], "./sub/sub-assy.FCStd")

            sub_out = search_outgoing_refs(root, "./sub/sub-assy.FCStd")
            self.assertEqual(sub_out["count"], 1)
            self.assertEqual(sub_out["refs"][0]["target_basename"], "leaf.FCStd")

            top_out = search_outgoing_refs(root, "./top-assy.FCStd")
            targets = {r["target_basename"] for r in top_out["refs"]}
            self.assertEqual(targets, {"sub-assy.FCStd", "child.FCStd"})

    def test_rename_analysis_transitive_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            run_fcstd_map_scan(root)

            direct = analyze_rename_references(
                root,
                old_basename="leaf.FCStd",
                new_basename="leaf.FCStd",
                persist=False,
                transitive=False,
            )
            self.assertEqual(direct["host_count"], 1)

            full = analyze_rename_references(
                root,
                old_basename="leaf.FCStd",
                new_basename="leaf.FCStd",
                persist=False,
                transitive=True,
            )
            self.assertEqual(full["host_count"], 2)
            self.assertEqual(full["direct_host_count"], 1)
            paths = {h["host_repo_rel_path"] for h in full["hosts"]}
            self.assertEqual(paths, {"./sub/sub-assy.FCStd", "./top-assy.FCStd"})

    def test_rename_analysis_reads_from_db(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            groups = host_ref_groups_from_db(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
            )
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0].hit_count, 2)

            audit = host_ref_groups_from_db(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
            )
            self.assertEqual(len(audit), 1)
            self.assertEqual(audit[0].hit_count, 2)

            scan = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
                persist=False,
            )
            self.assertEqual(scan["host_count"], 1)
            self.assertEqual(scan["hit_count"], 2)

            scan_rename = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
                persist=False,
            )
            self.assertEqual(scan_rename["host_count"], 1)
            self.assertEqual(scan_rename["hit_count"], 2)

    def test_rename_flow_with_db_refs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            out = execute_file_rename(
                root,
                Path("child.FCStd"),
                new_filename="new.FCStd",
                baseline={"PartNumber": "1"},
                current={"PartNumber": "1", "filename": "new.FCStd"},
            )
            rid = int(out["rename_log_id"])
            scan = analyze_rename_references(root, rename_log_id=rid)
            self.assertEqual(scan["host_count"], 1)


    def test_auto_rebuild_when_fcstd_scan_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            from fcdesk.freecad.phoenix_store import cad_database_path, connect

            with connect(root) as conn:
                conn.execute("DELETE FROM bom_xref")
                conn.execute("DELETE FROM fcstd_scan")
                conn.execute("DELETE FROM meta WHERE key = 'last_bom_xref_at'")
                conn.execute("DELETE FROM meta WHERE key = 'last_bom_xref_stats'")

            groups = host_ref_groups_from_db(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
            )
            self.assertEqual(len(groups), 1)

    def test_auto_rebuild_bom_xref_from_existing_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            from fcdesk.freecad.phoenix_store import cad_database_path, connect

            with connect(root) as conn:
                conn.execute("DELETE FROM bom_xref")
                conn.execute("DELETE FROM meta WHERE key = 'last_bom_xref_at'")
                conn.execute("DELETE FROM meta WHERE key = 'last_bom_xref_stats'")

            groups = host_ref_groups_from_db(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
            )
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0].hit_count, 2)


if __name__ == "__main__":
    unittest.main()
