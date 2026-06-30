"""Code 批量改名 / UUID 引擎。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.rename.apply import apply_text_rename
from phoenix.code.rename.apply_batch import apply_rename_all
from phoenix.code.rename.types import RenameScanOptions
from phoenix.code.rename.scan import preview_rename_all, preview_text_rename
from phoenix.code.rename.uuid_apply import apply_uuid_hits
from phoenix.code.rename.uuid_scan import UuidScanOptions, make_hit_id, scan_uuid_hits
from phoenix.testing.fixture_prefs import resolve_fixture_path

UUID_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "uuid"
PNX_CAA_STUDY = resolve_fixture_path("PNXCaaStudy")


class TestCodeRenameEngine(unittest.TestCase):
    def test_text_preview_and_apply(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            mod = ws / "ModA"
            mod.mkdir()
            f = mod / "Widget.cpp"
            f.write_text('class OldName {\n  OldName() {}\n};\n', encoding="utf-8")

            opts = RenameScanOptions(old="OldName", new="NewName", levels=["text"])
            prev = preview_text_rename(ws, opts)
            self.assertTrue(prev["implemented"])
            self.assertEqual(prev["summary"]["total_hits"], 2)
            self.assertEqual(len(prev["hits"]), 1)

            dry = apply_text_rename(ws, opts, dry_run=True)
            self.assertEqual(dry["summary"]["total_hits"], 2)
            self.assertIn("OldName", f.read_text(encoding="utf-8"))

            write = apply_text_rename(ws, opts, dry_run=False)
            self.assertEqual(write["summary"]["text_files"], 1)
            text = f.read_text(encoding="utf-8")
            self.assertNotIn("OldName", text)
            self.assertIn("NewName", text)

    def test_dir_and_file_rename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            old_dir = ws / "OldMod"
            old_dir.mkdir()
            nested = old_dir / "OldMod"
            nested.mkdir()
            old_file = old_dir / "OldPart.cpp"
            old_file.write_text("OldMod\n", encoding="utf-8")

            opts = RenameScanOptions(old="OldMod", new="NewMod", levels=["dir", "file"])
            prev = preview_rename_all(ws, opts)
            self.assertTrue(prev["implemented"])
            self.assertEqual(prev["summary"]["dirs"], 2)
            self.assertEqual(prev["summary"]["files"], 0)

            file_opts = RenameScanOptions(old="OldPart.cpp", new="NewPart.cpp", levels=["file"])
            prev_files = preview_rename_all(ws, file_opts)
            self.assertEqual(prev_files["summary"]["files"], 1)

            apply_path = apply_rename_all(ws, opts, dry_run=False)
            self.assertEqual(apply_path["summary"]["dirs"], 2)
            self.assertTrue((ws / "NewMod").is_dir())
            self.assertTrue((ws / "NewMod" / "NewMod").is_dir())

            apply_rename_all(ws, file_opts, dry_run=False)
            self.assertTrue((ws / "NewMod" / "OldPart.cpp").exists() is False)
            self.assertTrue((ws / "NewMod" / "NewPart.cpp").is_file())

            text_opts = RenameScanOptions(old="OldMod", new="NewMod", levels=["text"])
            apply_rename_all(ws, text_opts, dry_run=False)
            self.assertIn("NewMod", (ws / "NewMod" / "NewPart.cpp").read_text(encoding="utf-8"))

    def test_respects_ignore_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            ph = ws / ".phoenix"
            ph.mkdir()
            (ph / "code.ignore").write_text("build\n", encoding="utf-8")
            build = ws / "build"
            build.mkdir()
            (build / "x.cpp").write_text("OldName\n", encoding="utf-8")
            (ws / "keep.cpp").write_text("OldName\n", encoding="utf-8")

            opts = RenameScanOptions(old="OldName", new="New", levels=["text"])
            prev = preview_text_rename(ws, opts)
            paths = [h["repo_rel_path"] for h in prev["hits"]]
            self.assertIn("keep.cpp", paths)
            self.assertNotIn("build/x.cpp", paths)

    def test_apply_all_levels_in_one_batch(self) -> None:
        """执行顺序：文件夹 → 文件 → 文本（同一 batch）。"""
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            pkg = ws / "OldPkg"
            pkg.mkdir()
            src = pkg / "OldPkg.cpp"
            src.write_text("OldPkg symbol\n", encoding="utf-8")

            opts = RenameScanOptions(
                old="OldPkg",
                new="NewPkg",
                levels=["dir", "file", "text"],
            )
            prev = preview_rename_all(ws, opts)
            self.assertEqual(prev["summary"]["dirs"], 1)
            self.assertEqual(prev["summary"]["files"], 0)
            self.assertEqual(prev["summary"]["text_files"], 1)

            out = apply_rename_all(ws, opts, dry_run=False)
            self.assertEqual(out["summary"]["dirs"], 1)
            self.assertEqual(out["summary"]["text_files"], 1)
            self.assertTrue((ws / "NewPkg").is_dir())
            self.assertTrue((ws / "NewPkg" / "OldPkg.cpp").is_file())
            self.assertIn("NewPkg", (ws / "NewPkg" / "OldPkg.cpp").read_text(encoding="utf-8"))

            file_opts = RenameScanOptions(old="OldPkg.cpp", new="NewPkg.cpp", levels=["file"])
            apply_rename_all(ws, file_opts, dry_run=False)
            self.assertTrue((ws / "NewPkg" / "NewPkg.cpp").is_file())

    def test_dir_rename_case_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            d = ws / "mydir"
            d.mkdir()
            (d / "x.txt").write_text("ok", encoding="utf-8")
            opts = RenameScanOptions(old="mydir", new="MyDir", levels=["dir"])
            out = apply_rename_all(ws, opts, dry_run=False)
            self.assertEqual(out["summary"]["dirs"], 1)
            self.assertTrue((ws / "MyDir").is_dir())
            self.assertTrue((ws / "MyDir" / "x.txt").is_file())
            # 大小写不敏感文件系统上旧 Path 对象仍可能 resolve 到同一目录
            names = {p.name for p in ws.iterdir() if p.is_dir()}
            self.assertIn("MyDir", names)


class TestCodeUuidEngine(unittest.TestCase):
    def test_scan_and_apply_map_per_value(self) -> None:
        uid = "550e8400-e29b-41d4-a716-446655440000"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            a = ws / "a.json"
            b = ws / "b.json"
            a.write_text(f'{{ "id": "{uid}" }}\n', encoding="utf-8")
            b.write_text(f'{{ "ref": "{uid}" }}\n', encoding="utf-8")

            scanned = scan_uuid_hits(ws, UuidScanOptions())
            self.assertTrue(scanned["implemented"])
            self.assertEqual(scanned["summary"]["total_hits"], 2)
            self.assertEqual(scanned["summary"]["unique_uuids"], 1)
            ids = [h["hit_id"] for h in scanned["hits"]]

            dry = apply_uuid_hits(ws, ids, strategy="map_per_value", dry_run=False)
            self.assertEqual(dry["summary"]["total_hits"], 2)
            new_a = a.read_text(encoding="utf-8")
            new_b = b.read_text(encoding="utf-8")
            self.assertNotIn(uid, new_a)
            self.assertNotIn(uid, new_b)
            # 同一旧 UUID 映射为同一新值
            import re

            m_a = re.search(r'"id": "([^"]+)"', new_a)
            m_b = re.search(r'"ref": "([^"]+)"', new_b)
            assert m_a and m_b
            self.assertEqual(m_a.group(1), m_b.group(1))

    def test_uuid_scan_respects_index_paths(self) -> None:
        uid = "550e8400-e29b-41d4-a716-446655440000"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            indexed = ws / "in_index.json"
            other = ws / "not_index.json"
            indexed.write_text(f'{{ "id": "{uid}" }}\n', encoding="utf-8")
            other.write_text(f'{{ "id": "{uid}" }}\n', encoding="utf-8")

            all_hits = scan_uuid_hits(ws, UuidScanOptions())
            self.assertEqual(all_hits["summary"]["total_hits"], 2)

            scoped = scan_uuid_hits(
                ws,
                UuidScanOptions(indexed_paths=frozenset({"in_index.json"})),
            )
            self.assertEqual(scoped["summary"]["total_hits"], 1)
            self.assertEqual(scoped["hits"][0]["repo_rel_path"], "in_index.json")

    def test_scan_uuids_service_repo_rel_paths(self) -> None:
        uid = "550e8400-e29b-41d4-a716-446655440000"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            a = ws / "only.cpp"
            b = ws / "skip.cpp"
            a.write_text(f'const char* id = "{uid}";\n', encoding="utf-8")
            b.write_text(f'const char* id = "{uid}";\n', encoding="utf-8")

            from phoenix.code.rename.service import scan_uuids

            out = scan_uuids(ws, {"repo_rel_paths": ["only.cpp"], "kinds": ["uuid"]})
            self.assertEqual(out["repo_rel_paths"], ["only.cpp"])
            self.assertEqual(out["summary"]["total_hits"], 1)
            self.assertEqual(out["hits"][0]["repo_rel_path"], "only.cpp")

    def test_preview_rename_repo_rel_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            a = ws / "only.cpp"
            b = ws / "skip.cpp"
            a.write_text("OldName();\n", encoding="utf-8")
            b.write_text("OldName();\n", encoding="utf-8")

            from phoenix.code.rename.service import preview_rename

            out = preview_rename(
                ws,
                {
                    "old": "OldName",
                    "new": "NewName",
                    "levels": ["text"],
                    "repo_rel_paths": ["only.cpp"],
                },
            )
            self.assertEqual(out["repo_rel_paths"], ["only.cpp"])
            self.assertEqual(out["summary"]["total_hits"], 1)
            self.assertEqual(out["hits"][0]["repo_rel_path"], "only.cpp")

    def test_hit_id_roundtrip(self) -> None:
        hid = make_hit_id("src/x.cpp", 3, 10, "{ABC}")
        from phoenix.code.rename.uuid_scan import parse_hit_id

        parsed = parse_hit_id(hid)
        self.assertEqual(parsed["repo_rel_path"], "src/x.cpp")
        self.assertEqual(parsed["line"], 3)

    def test_uuid_fixture_bundle(self) -> None:
        """case_id=uuid-fixture-bundle — 仓库内 uuid/ 小样本（JSON + CAA GUID/IID）"""
        scanned = scan_uuid_hits(UUID_FIXTURES, UuidScanOptions())
        self.assertTrue(scanned["implemented"])
        self.assertGreaterEqual(scanned["summary"]["total_hits"], 7)
        self.assertGreaterEqual(scanned["summary"]["unique_uuids"], 3)
        paths = {h["repo_rel_path"] for h in scanned["hits"]}
        self.assertIn("sample_feature.json", paths)
        self.assertIn("sample_ref.json", paths)
        self.assertIn("caa_iid_factory_snippet.cpp", paths)
        self.assertIn("caa_dictionary.iid", paths)
        factory_hits = [
            h for h in scanned["hits"] if h["repo_rel_path"] == "caa_iid_factory_snippet.cpp"
        ]
        self.assertEqual(len(factory_hits), 1)
        self.assertEqual(factory_hits[0]["uuid_normalized"], "0a61c15671d84be0a5ac797bd454f831")
        self.assertTrue(factory_hits[0]["matched_text"].lower().startswith("0x"))

    def test_map_per_value_lowercase_cross_format(self) -> None:
        """同值组全小写 → .iid 与 CAA 块替换后均小写"""
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "dict.iid").write_text(
                "{0a61c156-71d8-4be0-a5ac-797bd454f831} Foo\n", encoding="utf-8"
            )
            (ws / "factory.cpp").write_text(
                "0x0a61c156, 0x71d8, 0x4be0, {0xa5, 0xac, 0x79, 0x7b, 0xd4, 0x54, 0xf8, 0x31};\n",
                encoding="utf-8",
            )
            scanned = scan_uuid_hits(ws, UuidScanOptions())
            ids = [h["hit_id"] for h in scanned["hits"]]
            apply_uuid_hits(ws, ids, strategy="map_per_value", dry_run=False)
            iid_text = (ws / "dict.iid").read_text(encoding="utf-8")
            cpp_text = (ws / "factory.cpp").read_text(encoding="utf-8")
            import re

            iid_m = re.search(r"\{([0-9a-fA-F-]+)\}", iid_text)
            assert iid_m
            self.assertNotRegex(iid_m.group(1), r"[A-F]")
            for tok in re.findall(r"0x[0-9a-fA-F]+", cpp_text):
                self.assertNotRegex(tok, r"[A-F]", msg=tok)

    def test_map_per_value_uppercase_cross_format(self) -> None:
        """同值组全大写 → .iid 与 CAA 块替换后均大写"""
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "dict.iid").write_text(
                "{0A61C156-71D8-4BE0-A5AC-797BD454F831} Foo\n", encoding="utf-8"
            )
            (ws / "factory.cpp").write_text(
                "0x0A61C156, 0x71D8, 0x4BE0, {0xA5, 0xAC, 0x79, 0x7B, 0xD4, 0x54, 0xF8, 0x31};\n",
                encoding="utf-8",
            )
            scanned = scan_uuid_hits(ws, UuidScanOptions())
            ids = [h["hit_id"] for h in scanned["hits"]]
            apply_uuid_hits(ws, ids, strategy="map_per_value", dry_run=False)
            iid_text = (ws / "dict.iid").read_text(encoding="utf-8")
            cpp_text = (ws / "factory.cpp").read_text(encoding="utf-8")
            import re

            iid_m = re.search(r"\{([0-9a-fA-F-]+)\}", iid_text)
            assert iid_m
            self.assertRegex(iid_m.group(1), r"^[0-9A-F-]+$")
            for tok in re.findall(r"0x[0-9a-fA-F]+", cpp_text):
                self.assertNotRegex(tok, r"[a-f]", msg=tok)

    def test_map_per_value_cross_format_same_new_uuid(self) -> None:
        """同一 UUID 的 .iid 连字符与 CAA 0x 块 → 同一 uuid4，各自格式写回"""
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "dict.iid").write_text(
                "{0a61c156-71d8-4be0-a5ac-797bd454f831} PNXICombinedCurveFactory\n",
                encoding="utf-8",
            )
            (ws / "factory.cpp").write_text(
                "IID x = { 0x0a61c156, 0x71d8, 0x4be0, "
                "{0xa5, 0xac, 0x79, 0x7b, 0xd4, 0x54, 0xf8, 0x31}};\n",
                encoding="utf-8",
            )
            scanned = scan_uuid_hits(ws, UuidScanOptions())
            self.assertEqual(scanned["summary"]["unique_uuids"], 1)
            self.assertEqual(len(scanned["hits"]), 2)
            ids = [h["hit_id"] for h in scanned["hits"]]
            out = apply_uuid_hits(ws, ids, strategy="map_per_value", dry_run=False)
            self.assertEqual(out["summary"].get("unique_new_uuids"), 1)
            from phoenix.code.rename.uuid_scan import normalize_uuid_text

            iid_text = (ws / "dict.iid").read_text(encoding="utf-8")
            cpp_text = (ws / "factory.cpp").read_text(encoding="utf-8")
            self.assertNotIn("0a61c156", iid_text.lower())
            iid_m = __import__("re").search(r"\{([0-9a-fA-F-]+)\}", iid_text)
            cpp_m = __import__("re").search(
                r"0x([0-9a-fA-F]{8}),\s*0x([0-9a-fA-F]{4}),\s*0x([0-9a-fA-F]{4}),\s*"
                r"\{0x([0-9a-fA-F]{2}),\s*0x([0-9a-fA-F]{2}),\s*0x([0-9a-fA-F]{2}),\s*0x([0-9a-fA-F]{2}),\s*"
                r"0x([0-9a-fA-F]{2}),\s*0x([0-9a-fA-F]{2}),\s*0x([0-9a-fA-F]{2}),\s*0x([0-9a-fA-F]{2})\}",
                cpp_text,
                __import__("re").IGNORECASE,
            )
            assert iid_m and cpp_m
            iid_norm = normalize_uuid_text("{" + iid_m.group(1) + "}")
            cpp_norm = normalize_uuid_text(cpp_m.group(0))
            self.assertEqual(iid_norm, cpp_norm)

    def test_map_per_value_two_norms_two_new_uuids(self) -> None:
        """勾选两个不同旧 UUID → 两个新 uuid4"""
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            a = "550e8400-e29b-41d4-a716-446655440000"
            b = "c17e43d3-2b56-4753-bfe5-bb5f289e2091"
            (ws / "a.json").write_text(f'{{"id":"{a}"}}\n', encoding="utf-8")
            (ws / "b.json").write_text(f'{{"id":"{b}"}}\n', encoding="utf-8")
            scanned = scan_uuid_hits(ws, UuidScanOptions())
            ids = [h["hit_id"] for h in scanned["hits"]]
            out = apply_uuid_hits(ws, ids, strategy="map_per_value", dry_run=False)
            self.assertEqual(out["summary"].get("unique_new_uuids"), 2)

    def test_caa_guid_flat_brace_scan_and_apply(self) -> None:
        """case_id=uuid-caa-flat-brace — {0x.., 0x.., …} 扁平大括号"""
        src = UUID_FIXTURES / "caa_guid_flat_brace.cpp"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            dst = ws / "flat.cpp"
            dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            scanned = scan_uuid_hits(ws, UuidScanOptions())
            self.assertEqual(scanned["summary"]["total_hits"], 1)
            hit = scanned["hits"][0]
            self.assertEqual(hit["uuid_normalized"], "0a61c15671d84be0a5ac797bd454f831")
            self.assertEqual(hit.get("caa_style"), "flat_brace")
            self.assertTrue(hit["matched_text"].startswith("{"))
            apply_uuid_hits(ws, [hit["hit_id"]], strategy="map_per_value", dry_run=False)
            new_text = dst.read_text(encoding="utf-8")
            self.assertNotIn("0a61c156", new_text.lower())
            self.assertRegex(new_text, r"\{0x[0-9a-fA-F]+,")

    def test_caa_guid_flat_run_scan(self) -> None:
        """case_id=uuid-caa-flat-run — 连续 11 个 0x 无内层 {}"""
        src = UUID_FIXTURES / "caa_guid_flat_run.cpp"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "flat_run.cpp").write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            scanned = scan_uuid_hits(ws, UuidScanOptions())
        self.assertEqual(scanned["summary"]["total_hits"], 1)
        hit = scanned["hits"][0]
        self.assertEqual(hit.get("caa_style"), "flat_run")
        self.assertEqual(hit["uuid_normalized"], "0a61c15671d84be0a5ac797bd454f831")

    def test_caa_formats_normalize_same_uuid(self) -> None:
        from phoenix.code.rename.uuid_scan import normalize_uuid_text

        nested = "0x0a61c156, 0x71d8, 0x4be0, {0xa5, 0xac, 0x79, 0x7b, 0xd4, 0x54, 0xf8, 0x31}"
        flat = "{0x0a61c156, 0x71d8, 0x4be0, 0xa5, 0xac, 0x79, 0x7b, 0xd4, 0x54, 0xf8, 0x31}"
        iid = "{0a61c156-71d8-4be0-a5ac-797bd454f831}"
        norm = "0a61c15671d84be0a5ac797bd454f831"
        self.assertEqual(normalize_uuid_text(nested), norm)
        self.assertEqual(normalize_uuid_text(flat), norm)
        self.assertEqual(normalize_uuid_text(iid), norm)

    def test_caa_guid_block_scan_and_apply(self) -> None:
        """case_id=uuid-caa-iid-block — CAA 0x.., 0x.., {0x..} 块可扫可换"""
        src = UUID_FIXTURES / "caa_iid_factory_snippet.cpp"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            dst = ws / "factory.cpp"
            dst.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
            scanned = scan_uuid_hits(ws, UuidScanOptions())
            self.assertEqual(scanned["summary"]["total_hits"], 1)
            old = scanned["hits"][0]["matched_text"]
            self.assertIn("0x0a61c156", old.lower())
            apply_uuid_hits(ws, [scanned["hits"][0]["hit_id"]], strategy="map_per_value", dry_run=False)
            new_text = dst.read_text(encoding="utf-8")
            self.assertNotIn(old, new_text)
            self.assertIn("0x", new_text.lower())
            # 与 .iid 字典条目同值 UUID 替换后仍保持 CAA 块形态
            self.assertRegex(new_text.lower(), r"0x[0-9a-f]{8},\s*0x[0-9a-f]{4}")

    @unittest.skipUnless(
        PNX_CAA_STUDY.is_dir(),
        "PNXCaaStudy 未检出到 phoenix-desk-tools 同级目录",
    )
    def test_uuid_scan_pnx_caa_study_sample(self) -> None:
        """case_id=uuid-pnx-tree — 同级目录 PNXCaaStudy：.iid + IID 块 + Cmd GUID"""
        scanned = scan_uuid_hits(
            PNX_CAA_STUDY,
            UuidScanOptions(scope="PNXCombinedCurveWsp/PNXCombinedCurve.edu"),
        )
        self.assertTrue(scanned["implemented"])
        self.assertGreater(scanned["summary"]["total_hits"], 2)
        paths = {h["repo_rel_path"] for h in scanned["hits"]}
        self.assertTrue(
            any("PNXICombinedCurveFactory.cpp" in p for p in paths),
            msg=f"expected factory cpp IID block, got {sorted(paths)}",
        )
        self.assertTrue(
            any(p.endswith("PNXCombinedCurve.edu.iid") for p in paths),
            msg=f"expected .iid dictionary, got {sorted(paths)}",
        )


if __name__ == "__main__":
    unittest.main()
