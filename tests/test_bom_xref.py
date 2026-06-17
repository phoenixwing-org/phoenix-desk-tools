"""BOM XLink 引用关系表。"""

from __future__ import annotations

import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

from phoenix.services.assembly_tree_cache import build_assembly_tree_payload, load_assembly_tree_cached
from phoenix.services.bom_tree_occurrence import query_target_usage_stats
from phoenix.services.bom_xref_service import (
    host_ref_groups_from_db,
    load_assembly_bom_catalog,
    load_assembly_tree,
    query_xref_counts_for_rel,
    search_file_detail_xrefs,
    search_incoming_refs,
    search_outgoing_refs,
)
from phoenix.freecad.phoenix_store import connect, insert_bom_xref_edges
from phoenix.services.cad_index import (
    rebuild_bom_xrefs,
    refresh_bom_xref_index_for_host,
    refresh_bom_xrefs_for_hosts,
)
from phoenix.services.fcstd_map_service import run_fcstd_map_scan
from phoenix.services.rename_analysis_service import analyze_rename_references
from phoenix.services.rename_ref_service import execute_file_rename


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

            log = str(xref.get("log") or "")
            self.assertIn("重建内容: bom_xref", log)
            self.assertIn("写入引用边:", log)
            self.assertIn("读取 FCStd（present）:", log)

    def test_rebuild_log_includes_before_after(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            first = rebuild_bom_xrefs(root, scan_id=1, scan_root=root)
            self.assertIn("较上次:", first["log"])
            self.assertEqual(first["host_files_scanned"], 2)
            self.assertEqual(first["hosts_with_xlink"], 1)

            second = rebuild_bom_xrefs(root, scan_id=1, scan_root=root)
            self.assertIn("较上次: 边 2 → 2", second["log"])

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

    def test_refresh_host_index_recursive_subtree(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            run_fcstd_map_scan(root)

            from phoenix.freecad.phoenix_store import connect

            with connect(root) as conn:
                conn.execute("DELETE FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = ?", ("./top-assy.FCStd",))

            out = refresh_bom_xref_index_for_host(root, "./top-assy.FCStd", recursive=True)
            self.assertGreaterEqual(out["hosts_refreshed"], 2)
            self.assertIn("./sub/sub-assy.FCStd", out["hosts"])
            self.assertEqual(out["outgoing_count"], 2)

            listed = search_outgoing_refs(root, "./top-assy.FCStd", refresh_disk=False)
            self.assertEqual(listed["count"], 2)

            only_root = refresh_bom_xref_index_for_host(root, "./top-assy.FCStd", recursive=False)
            self.assertEqual(only_root["hosts_refreshed"], 1)
            self.assertEqual(only_root["hosts"], ["./top-assy.FCStd"])

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
            self.assertEqual(direct["hit_count"], 1)
            self.assertEqual(direct["hosts"][0]["hits"][0]["proposed_text"], "../leaf.FCStd")

            full = analyze_rename_references(
                root,
                old_basename="leaf.FCStd",
                new_basename="leaf.FCStd",
                persist=False,
                transitive=True,
            )
            self.assertEqual(full["host_count"], 2)
            self.assertEqual(full["direct_host_count"], 1)

    def test_apply_indirect_host_expands_to_direct(self) -> None:
        from phoenix.services.rename_analysis_service import apply_rename_analysis_corrections

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            run_fcstd_map_scan(root)

            scan = analyze_rename_references(
                root,
                old_basename="leaf.FCStd",
                new_basename="new-leaf.FCStd",
                transitive=True,
                persist=False,
            )
            top = "./top-assy.FCStd"
            self.assertIn(top, {h["host_repo_rel_path"] for h in scan["hosts"]})

            out = apply_rename_analysis_corrections(
                root,
                old_basename="leaf.FCStd",
                new_basename="new-leaf.FCStd",
                host_repo_rel_paths=[top],
                transitive=True,
            )
            self.assertIn("./sub/sub-assy.FCStd", out["applied_hosts"])
            self.assertNotIn(top, out["applied_hosts"])

    def test_rename_analysis_flags_path_mismatch_by_basename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            audit = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
                target_repo_rel="./child.FCStd",
                persist=False,
            )
            self.assertEqual(audit["host_count"], 1)
            hits = audit["hosts"][0]["hits"]
            matched = {h["matched_text"] for h in hits}
            self.assertIn("../parts/child.FCStd", matched)
            self.assertIn("child.FCStd", matched)
            bad = next(h for h in hits if h["matched_text"] == "../parts/child.FCStd")
            self.assertEqual(bad["status"], "pending")
            ok = next(h for h in hits if h["matched_text"] == "child.FCStd")
            self.assertEqual(ok["status"], "ok")

    def test_rename_analysis_updates_basename_and_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            scan = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="new-child.FCStd",
                persist=False,
            )
            self.assertEqual(scan["host_count"], 1)
            self.assertEqual(scan["hit_count"], 2)
            props = {h["proposed_text"] for host in scan["hosts"] for h in host["hits"]}
            self.assertEqual(props, {"new-child.FCStd"})

    def test_apply_then_reanalyze_pending_does_not_grow(self) -> None:
        from phoenix.services.rename_analysis_service import apply_rename_analysis_corrections

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            scan1 = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
                persist=False,
            )
            pending1 = scan1.get("pending_hit_count", scan1["hit_count"])
            self.assertEqual(pending1, 2)

            host = scan1["hosts"][0]["host_repo_rel_path"]
            apply_rename_analysis_corrections(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
                host_repo_rel_paths=[host],
            )

            scan2 = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="new.FCStd",
                persist=False,
            )
            pending2 = scan2.get("pending_hit_count", scan2["hit_count"])
            self.assertEqual(pending2, 0)

    def test_rename_log_reanalyze_after_apply_no_duplicate_hits(self) -> None:
        from phoenix.services.rename_analysis_service import apply_rename_analysis_corrections
        from phoenix.services.rename_ref_service import execute_file_rename

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

            scan1 = analyze_rename_references(root, rename_log_id=rid, persist=True)
            self.assertEqual(scan1.get("pending_hit_count", scan1["hit_count"]), 2)

            apply_rename_analysis_corrections(
                root,
                rename_log_id=rid,
                host_repo_rel_paths=[scan1["hosts"][0]["host_repo_rel_path"]],
            )

            scan2 = analyze_rename_references(root, rename_log_id=rid, persist=True)
            self.assertEqual(scan2.get("pending_hit_count", scan2["hit_count"]), 0)
            self.assertEqual(scan2["host_count"], 0)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            parts = root / "parts"
            parts.mkdir()
            _write_fcstd(parts / "new-child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            scan = analyze_rename_references(
                root,
                old_basename="child.FCStd",
                new_basename="new-child.FCStd",
                new_repo_rel_path="./parts/new-child.FCStd",
                persist=False,
            )
            self.assertEqual(scan["hit_count"], 2)
            props = {h["proposed_text"] for host in scan["hosts"] for h in host["hits"]}
            self.assertEqual(props, {"parts/new-child.FCStd"})

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

            from phoenix.freecad.phoenix_store import cad_database_path, connect

            with connect(root) as conn:
                conn.execute("DELETE FROM phoenix_cad_bom_xref")
                conn.execute("DELETE FROM phoenix_cad_scan")
                conn.execute("DELETE FROM phoenix_meta WHERE key = 'last_bom_xref_at'")
                conn.execute("DELETE FROM phoenix_meta WHERE key = 'last_bom_xref_stats'")

            groups = host_ref_groups_from_db(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
            )
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0].hit_count, 2)

    def test_auto_rebuild_bom_xref_from_existing_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", _HOST_XML)
            run_fcstd_map_scan(root)

            from phoenix.freecad.phoenix_store import cad_database_path, connect

            with connect(root) as conn:
                conn.execute("DELETE FROM phoenix_cad_bom_xref")
                conn.execute("DELETE FROM phoenix_meta WHERE key = 'last_bom_xref_at'")
                conn.execute("DELETE FROM phoenix_meta WHERE key = 'last_bom_xref_stats'")

            groups = host_ref_groups_from_db(
                root,
                old_basename="child.FCStd",
                new_basename="child.FCStd",
            )
            self.assertEqual(len(groups), 1)
            self.assertEqual(groups[0].hit_count, 2)

    def test_refresh_outgoing_legacy_host_path_and_duplicate_xlink(self) -> None:
        """路径未规范化或 XML 重复 XLink 时，refresh 不应触发 UNIQUE 冲突。"""
        dup_xml = """<?xml version="1.0"?>
<Document>
 <ObjectData Count="1">
  <Object name="Asm">
   <Properties Count="1">
    <Property name="Group" type="App::PropertyLinkList">
     <XLink file="child.FCStd"/>
     <XLink file="child.FCStd"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", dup_xml)
            run_fcstd_map_scan(root)

            from phoenix.freecad.phoenix_store import ensure_fcstd_scan_record, get_file_asset_id

            asset_id = get_file_asset_id(root, "./asm.FCStd")
            self.assertIsNotNone(asset_id)
            scan_id = ensure_fcstd_scan_record(root)
            self.assertIsNotNone(scan_id)

            with connect(root) as conn:
                conn.execute("DELETE FROM phoenix_cad_bom_xref WHERE host_repo_rel_path = ?", ("./asm.FCStd",))

            child_id = get_file_asset_id(root, "./child.FCStd")
            insert_bom_xref_edges(
                root,
                scan_id=int(scan_id),
                edges=[
                    {
                        "host_file_asset_id": asset_id,
                        "host_repo_rel_path": "asm.FCStd",
                        "xlink_file_attr": "child.FCStd",
                        "target_basename": "child.FCStd",
                        "target_file_asset_id": child_id,
                        "target_repo_rel_path": "./child.FCStd",
                        "resolve_status": "resolved",
                        "detail_json": None,
                    }
                ],
            )

            out = search_outgoing_refs(root, "./asm.FCStd", refresh_disk=True)
            self.assertEqual(out["count"], 1)

            refresh_bom_xrefs_for_hosts(root, ["./asm.FCStd"])
            listed = search_outgoing_refs(root, "./asm.FCStd", refresh_disk=False)
            self.assertEqual(listed["count"], 1)

    def test_assembly_bom_catalog_lists_hosts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            _write_fcstd(root / "drawing-only.drawing.fcstd", _HOST_XML)
            run_fcstd_map_scan(root)

            catalog = load_assembly_bom_catalog(root)
            paths = {h["host_repo_rel_path"] for h in catalog["hosts"]}
            self.assertIn("./top-assy.FCStd", paths)
            self.assertNotIn("./drawing-only.drawing.fcstd", paths)
            top = next(h for h in catalog["hosts"] if h["host_repo_rel_path"] == "./top-assy.FCStd")
            self.assertGreaterEqual(top["ref_count"], 2)

    def test_materialized_path_incoming_usage(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            run_fcstd_map_scan(root)

            leaf_stats = query_target_usage_stats(root, "./leaf.FCStd")
            self.assertGreaterEqual(leaf_stats["direct_incoming_host_count"], 1)
            self.assertGreaterEqual(leaf_stats["bom_occurrence_count"], 1)
            paths = {o["tree_path"] for o in leaf_stats["occurrences"]}
            self.assertTrue(paths)

    def test_assembly_tree_single_query_and_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            run_fcstd_map_scan(root)

            first = load_assembly_tree(root, "./top-assy.FCStd", full=True, refresh_disk=False)
            self.assertGreaterEqual(first["node_count"], 2)
            self.assertTrue(first.get("nodes"))

            second = load_assembly_tree_cached(root, "./top-assy.FCStd", full=True)
            self.assertTrue(second.get("cached"))
            self.assertEqual(second["node_count"], first["node_count"])

            paths = {
                n.get("tree_path")
                for n in second["nodes"]
                if n.get("tree_path")
            }
            self.assertTrue(paths)

    def test_file_detail_xrefs_combined_and_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "leaf.FCStd", "<Document/>")
            _write_fcstd(root / "sub/sub-assy.FCStd", _SUB_ASM_XML)
            _write_fcstd(root / "top-assy.FCStd", _TOP_ASM_XML)
            run_fcstd_map_scan(root)

            counts = query_xref_counts_for_rel(root, "./top-assy.FCStd")
            self.assertEqual(counts["outgoing_count"], 2)
            self.assertEqual(counts["direct_incoming_count"], 0)

            leaf_counts = query_xref_counts_for_rel(root, "./leaf.FCStd")
            self.assertEqual(leaf_counts["direct_incoming_count"], 1)

            payload = search_file_detail_xrefs(root, "./top-assy.FCStd")
            self.assertEqual(payload["outgoing"]["count"], 2)
            self.assertGreaterEqual(payload["incoming"]["count"], 0)
            self.assertNotIn("direct_refs", payload["incoming"]["hosts"][0] if payload["incoming"]["hosts"] else {})
            for ref in payload["outgoing"]["refs"]:
                self.assertIn("rule_label", ref)

            top_out = search_outgoing_refs(root, "./top-assy.FCStd")
            self.assertEqual(top_out["count"], 2)
            for ref in top_out["refs"]:
                self.assertIn("rule_label", ref)

    def test_outgoing_link_label_from_index_without_disk_read(self) -> None:
        labeled_host = """<?xml version="1.0"?>
<Document>
 <ObjectData Count="2">
  <Object name="Asm">
   <Properties Count="1">
    <Property name="Group" type="App::PropertyLinkList">
     <LinkList count="1">
      <Link value="LinkChild"/>
     </LinkList>
    </Property>
   </Properties>
  </Object>
  <Object name="LinkChild">
   <Properties Count="2">
    <Property name="LinkedObject" type="App::PropertyXLink">
     <XLink file="child.FCStd"/>
    </Property>
    <Property name="Label" type="App::PropertyString">
     <String value="子件显示名"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", labeled_host)
            run_fcstd_map_scan(root)

            with patch(
                "phoenix.freecad.rename_analysis.xlink.read_host_reference_labels"
            ) as disk_read:
                out = search_outgoing_refs(root, "./asm.FCStd")
                disk_read.assert_not_called()

            self.assertEqual(out["count"], 1)
            self.assertEqual(out["refs"][0]["link_label"], "子件显示名")

    def test_outgoing_missing_index_fields_never_reads_disk(self) -> None:
        """索引缺 link_label / 目标 BOM 字段时，出向引用查询不回退读宿主 FCStd。"""
        host_xml = """<?xml version="1.0"?>
<Document>
 <ObjectData Count="2">
  <Object name="Asm">
   <Properties Count="1">
    <Property name="Group" type="App::PropertyLinkList">
     <LinkList count="1">
      <Link value="LinkChild"/>
     </LinkList>
    </Property>
   </Properties>
  </Object>
  <Object name="LinkChild">
   <Properties Count="2">
    <Property name="LinkedObject" type="App::PropertyXLink">
     <XLink file="child.FCStd"/>
    </Property>
    <Property name="Label" type="App::PropertyString">
     <String value="仅存在于 XML 的 Label"/>
    </Property>
   </Properties>
  </Object>
 </ObjectData>
</Document>
"""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_fcstd(root / "child.FCStd", "<Document/>")
            _write_fcstd(root / "asm.FCStd", host_xml)
            run_fcstd_map_scan(root)
            from phoenix.freecad.phoenix_store import connect

            with connect(root) as conn:
                conn.execute(
                    "UPDATE phoenix_cad_bom_xref SET link_label = '' WHERE host_repo_rel_path LIKE '%asm.FCStd'"
                )
                conn.commit()

            with patch(
                "phoenix.freecad.rename_analysis.xlink.read_host_reference_labels"
            ) as disk_read, patch(
                "phoenix.freecad.fcstd_embedded_attrs.read_embedded_bom_attrs"
            ) as embedded_read:
                out = search_outgoing_refs(root, "./asm.FCStd")
                disk_read.assert_not_called()
                embedded_read.assert_not_called()

            self.assertEqual(out["count"], 1)
            self.assertEqual(out["refs"][0]["link_label"], "")
            self.assertEqual(out["refs"][0]["rule_label"], "child")


if __name__ == "__main__":
    unittest.main()
