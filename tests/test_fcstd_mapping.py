"""fcdesk.fcstd_mapping：结构化映射与遗留 JSON 兼容性。"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from fcdesk.fcstd_mapping import (
    FcstdMapDocument,
    FcstdMapEntry,
    compose_fcstd_body_label_display,
    compose_fcstd_recommended_filename,
    coerce_inferred_part_name,
    coerce_payload_to_basename_rel_paths,
    hints_from_fcstd_filename,
    hints_from_fcstd_location,
    infer_fcstd_name_suffix,
    infer_part_key_from_filename,
    infer_model_series,
    infer_part_name_from_fcstd_filename,
    legacy_flat_dict_to_document,
    map_json_payload_to_abs,
    normalize_repo_rel_path_for_map,
    resolve_label_for_index_scan,
    resolve_part_name_for_scan,
    strip_accidental_fcstd_suffix_from_name_segment,
    refine_inferred_part_name,
)


class TestModelSeries(unittest.TestCase):
    def test_infer_from_filename_stem(self) -> None:
        self.assertEqual(infer_model_series(stem="100001.001-H-ABC-GEAR", rel_posix=""), "ABC")

    def test_infer_from_sample_folder(self) -> None:
        self.assertEqual(
            infer_model_series(stem="Part", rel_posix="./SampleABC001/a.FCStd"),
            "ABC",
        )

    def test_hints_from_location(self) -> None:
        h = hints_from_fcstd_location(
            "100337.001-H-ABC-PULL-GEAR-RING.FCStd",
            "./SampleABC001/z.FCStd",
        )
        self.assertEqual(h.get("ModelSeries"), "ABC")

    def test_no_series_empty(self) -> None:
        self.assertIsNone(infer_model_series(stem="Simple.FCStd", rel_posix="./a/b.FCStd"))

class TestNormalizeRepoRel(unittest.TestCase):
    def test_dot_slash_style(self) -> None:
        self.assertEqual(
            normalize_repo_rel_path_for_map("SampleABC001/z.FCStd"),
            "./SampleABC001/z.FCStd",
        )
        self.assertEqual(normalize_repo_rel_path_for_map("./a.FCStd"), "./a.FCStd")
        self.assertEqual(normalize_repo_rel_path_for_map("../x.FCStd"), "../x.FCStd")


class TestHints(unittest.TestCase):
    def test_typical_sample_like_name(self) -> None:
        h = hints_from_fcstd_filename("100082.002-R-FooBar.FCStd")
        self.assertEqual(h["PartNumber"], "100082")
        self.assertEqual(h["PartVersion"], "002")
        self.assertEqual(h["TypeCode"], "R")

    def test_pdf_filename_part_fields(self) -> None:
        h = hints_from_fcstd_filename("100015.001-H-SHIELD-A.pdf")
        self.assertEqual(h["PartNumber"], "100015")
        self.assertEqual(h["PartVersion"], "001")
        self.assertEqual(h["TypeCode"], "H")

    def test_short_part_number_and_drawing_suffix(self) -> None:
        h = hints_from_fcstd_filename("8003.001-H-PHOENIX-滑轨.FCStd")
        self.assertEqual(h["PartNumber"], "8003")
        self.assertEqual(h["PartVersion"], "001")
        pn, pv = infer_part_key_from_filename("8003.001_H_PHOENIX.FCStd")
        self.assertEqual((pn, pv), ("8003", "001"))
        h2 = hints_from_fcstd_filename("8003.001-H-PX-滑轨.Drawing.FCStd")
        self.assertEqual(h2["PartVersion"], "001")


class TestRefinePartName(unittest.TestCase):
    def test_strip_full_filename_style_label(self) -> None:
        name = refine_inferred_part_name(
            "100337.001-H-ABC-PULL-GEAR-RING",
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
        )
        self.assertEqual(name, "PULL-GEAR-RING")

    def test_strip_label_formula(self) -> None:
        name = refine_inferred_part_name(
            "9.3-灯座",
            part_number="9",
            part_version="3",
        )
        self.assertEqual(name, "灯座")

    def test_plain_name_unchanged(self) -> None:
        self.assertEqual(
            refine_inferred_part_name("永磁自动切换起吊机", part_number="100601", part_version="001"),
            "永磁自动切换起吊机",
        )

    def test_infer_from_filename(self) -> None:
        name = infer_part_name_from_fcstd_filename(
            "100337.001-H-ABC-PULL-GEAR-RING.FCStd",
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
        )
        self.assertEqual(name, "PULL-GEAR-RING")

    def test_coerce_prefers_label_then_filename(self) -> None:
        name = coerce_inferred_part_name(
            "",
            "100337.001-H-ABC-PULL-GEAR-RING",
            filename="ignored.FCStd",
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
        )
        self.assertEqual(name, "PULL-GEAR-RING")

    def test_existing_part_name_not_modified(self) -> None:
        self.assertEqual(
            coerce_inferred_part_name(
                "  自定义名  ",
                "100337.001-H-ABC-PULL-GEAR-RING",
                part_number="100337",
                part_version="001",
            ),
            "自定义名",
        )

    def test_auto_infer_fields_from_label(self) -> None:
        """无显式 BOM 字段时，从 label 自身解析编号/版本/类型/型号。"""
        name = refine_inferred_part_name("100337.001-H-ABC-PULL-GEAR-RING")
        self.assertEqual(name, "PULL-GEAR-RING")

    def test_auto_infer_from_filename_only(self) -> None:
        name = infer_part_name_from_fcstd_filename("100082.002-R-FooBar.FCStd")
        self.assertEqual(name, "FooBar")

    def test_label_formula_without_explicit_fields(self) -> None:
        name = coerce_inferred_part_name("", "9.3-灯座")
        self.assertEqual(name, "灯座")

    def test_drawing_suffix_stripped(self) -> None:
        name = infer_part_name_from_fcstd_filename(
            "100337.001-H-ABC-PULL-GEAR-RING.Drawing.FCStd",
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
        )
        self.assertEqual(name, "PULL-GEAR-RING")

    def test_coerce_picks_shorter_valid_name(self) -> None:
        name = coerce_inferred_part_name(
            "",
            "100337.001-H-ABC-PULL-GEAR-RING",
            filename="100337.001-H-ABC-PULL-GEAR-RING.FCStd",
        )
        self.assertEqual(name, "PULL-GEAR-RING")

    def test_force_update_overwrites_existing_part_name(self) -> None:
        kept = resolve_part_name_for_scan(
            "100337.001-H-ABC-PULL-GEAR-RING",
            "100337.001-H-ABC-PULL-GEAR-RING",
            filename="100337.001-H-ABC-PULL-GEAR-RING.FCStd",
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
            force_update=False,
        )
        self.assertEqual(kept, "100337.001-H-ABC-PULL-GEAR-RING")

        refined = resolve_part_name_for_scan(
            "100337.001-H-ABC-PULL-GEAR-RING",
            "100337.001-H-ABC-PULL-GEAR-RING",
            filename="100337.001-H-ABC-PULL-GEAR-RING.FCStd",
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
            force_update=True,
        )
        self.assertEqual(refined, "PULL-GEAR-RING")


class TestComposeLabelSlug(unittest.TestCase):
    def test_with_part_name(self) -> None:
        s = compose_fcstd_body_label_display(
            part_number="1",
            part_version="002",
            part_name="本体",
            label_fallback="X",
        )
        self.assertEqual(s, "1.002-本体")

    def test_fallback_to_label_when_part_name_empty(self) -> None:
        s = compose_fcstd_body_label_display(
            part_number="9",
            part_version="3",
            part_name="",
            label_fallback="灯座",
        )
        self.assertEqual(s, "9.3-灯座")

    def test_ignores_type_and_series(self) -> None:
        s = compose_fcstd_body_label_display(
            part_number="100001",
            part_version="001",
            part_name="拉力机2",
            label_fallback="",
        )
        self.assertEqual(s, "100001.001-拉力机2")

    def test_requires_pn_and_pv(self) -> None:
        self.assertIsNone(
            compose_fcstd_body_label_display(
                part_number="",
                part_version="1",
                part_name="A",
                label_fallback="",
            )
        )


class TestResolveLabelForIndexScan(unittest.TestCase):
    def test_prefers_embedded(self) -> None:
        self.assertEqual(
            resolve_label_for_index_scan("100001.001-旧Label", stored_label="索引里"),
            "100001.001-旧Label",
        )

    def test_falls_back_to_stored(self) -> None:
        self.assertEqual(
            resolve_label_for_index_scan("", stored_label="索引里"),
            "索引里",
        )

    def test_empty_when_none(self) -> None:
        self.assertIsNone(resolve_label_for_index_scan(None, stored_label=None))


class TestRecommendedFilename(unittest.TestCase):
    def test_simple_part_name(self) -> None:
        s = compose_fcstd_recommended_filename(
            part_number="100001",
            part_version="001",
            type_code="H",
            part_name="外壳",
        )
        self.assertEqual(s, "100001.001-H-外壳.FCStd")

    def test_with_model_series(self) -> None:
        s = compose_fcstd_recommended_filename(
            part_number="100337",
            part_version="001",
            type_code="H",
            model_series="ABC",
            part_name="PULL-GEAR-RING",
        )
        self.assertEqual(s, "100337.001-H-ABC-PULL-GEAR-RING.FCStd")

    def test_standard_part_omits_model_series(self) -> None:
        s = compose_fcstd_recommended_filename(
            part_number="8007",
            part_version="001",
            type_code="S",
            model_series="PX",
            part_name="M6X12螺栓",
        )
        self.assertEqual(s, "8007.001-S-M6X12螺栓.FCStd")

    def test_part_name_fallback_to_label(self) -> None:
        s = compose_fcstd_recommended_filename(
            part_number="100001",
            part_version="001",
            type_code="H",
            part_name="",
            label_fallback="外壳",
        )
        self.assertEqual(s, "100001.001-H-外壳.FCStd")

    def test_assy_suffix_preserved(self) -> None:
        s = compose_fcstd_recommended_filename(
            part_number="100601",
            part_version="001",
            type_code="H",
            model_series="5TA",
            part_name="永磁自动切换起吊机",
            suffix=".ASSY.FCStd",
        )
        self.assertEqual(s, "100601.001-H-5TA-永磁自动切换起吊机.ASSY.FCStd")

    def test_infer_assy_suffix(self) -> None:
        self.assertEqual(
            infer_fcstd_name_suffix("100601.001-H-5TA-foo.ASSY.FCStd"),
            ".ASSY.FCStd",
        )
        self.assertEqual(infer_fcstd_name_suffix("a.Drawing.FCStd"), ".Drawing.FCStd")

    def test_strip_accidental_fcstd_suffix_from_name_segment(self) -> None:
        self.assertEqual(
            strip_accidental_fcstd_suffix_from_name_segment("滑轨.Drawing.FCStd"),
            "滑轨",
        )
        self.assertEqual(
            strip_accidental_fcstd_suffix_from_name_segment("foo.ASSY.FCStd"),
            "foo",
        )


class TestRenameWorkspaceFcstd(unittest.TestCase):
    def test_validate_basename(self) -> None:
        from fcdesk.fcstd_mapping import validate_fcstd_basename

        self.assertEqual(validate_fcstd_basename("a.FCStd"), "a.FCStd")
        with self.assertRaises(ValueError):
            validate_fcstd_basename("bad.txt")

    def test_rename_and_map_update(self) -> None:
        import shutil
        import tempfile

        from fcdesk.fcstd_mapping import (
            FcstdMapDocument,
            FcstdMapEntry,
            rename_workspace_fcstd_file,
            try_update_fcstd_map_entry_rename,
        )

        td = Path(tempfile.mkdtemp(prefix="fcdesk_rename_"))
        try:
            src = td / "old.FCStd"
            src.write_bytes(b"zip")
            new_rel = rename_workspace_fcstd_file(
                repo_root=td,
                rel=Path("old.FCStd"),
                new_basename="new.FCStd",
            )
            self.assertEqual(new_rel, Path("new.FCStd"))
            self.assertFalse(src.is_file())
            self.assertTrue((td / "new.FCStd").is_file())

            doc = FcstdMapDocument(
                entries=[
                    FcstdMapEntry(
                        repo_rel_path="./old.FCStd",
                        filename="old.FCStd",
                        PartNumber="1",
                    )
                ]
            )
            (td / "fcstd_map.json").write_text(
                json.dumps(doc.to_json_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self.assertTrue(
                try_update_fcstd_map_entry_rename(
                    repo_root=td,
                    old_rel=Path("old.FCStd"),
                    new_rel=Path("new.FCStd"),
                )
            )
            from fcdesk.freecad.phoenix_store import find_fcstd_entry

            entry = find_fcstd_entry(td, Path("new.FCStd"))
            self.assertIsNotNone(entry)
            assert entry is not None
            self.assertEqual(entry.filename, "new.FCStd")
            self.assertEqual(entry.repo_rel_path, "./new.FCStd")
        finally:
            shutil.rmtree(td, ignore_errors=True)


class TestDocument(unittest.TestCase):
    def test_roundtrip_json(self) -> None:
        doc = FcstdMapDocument(
            entries=[
                FcstdMapEntry(
                    repo_rel_path="cad/a.FCStd",
                    filename="a.FCStd",
                    PartNumber="1",
                    PartVersion="002",
                    TypeCode="S",
                    ModelSeries="ABC",
                    PartName="本体",
                    label=None,
                    extra={"source": "test"},
                )
            ]
        )
        raw = doc.to_json_dict()
        blob = json.loads(json.dumps(raw))
        doc2 = FcstdMapDocument.from_json_mapping(blob)
        self.assertEqual(len(doc2.entries), 1)
        self.assertEqual(doc2.entries[0].repo_rel_path, "cad/a.FCStd")
        self.assertEqual(doc2.entries[0].PartNumber, "1")
        self.assertEqual(doc2.entries[0].PartVersion, "002")
        self.assertEqual(doc2.entries[0].ModelSeries, "ABC")
        self.assertEqual(doc2.entries[0].PartName, "本体")
        self.assertEqual(doc2.entries[0].extra.get("source"), "test")

    def test_legacy_flat_upgrade(self) -> None:
        flat = {"P.FCStd": ["x/P.FCStd"]}
        doc = legacy_flat_dict_to_document(flat)
        self.assertGreaterEqual(doc.schema_version, 2)


class TestCoerceAndAbs(unittest.TestCase):
    def test_legacy_flat_maps_to_basenames(self) -> None:
        m = coerce_payload_to_basename_rel_paths({"A.FCStd": ["sub/A.FCStd"]})
        self.assertEqual(m["A.FCStd"], ["sub/A.FCStd"])

    def test_rich_maps_to_basenames(self) -> None:
        doc = legacy_flat_dict_to_document({"Z.FCStd": ["z/Z.FCStd"]})
        m = coerce_payload_to_basename_rel_paths(doc.to_json_dict())
        self.assertEqual(m["Z.FCStd"], ["z/Z.FCStd"])

    def test_map_json_payload_to_abs(self) -> None:
        anchor = Path("/tmp/workspace")
        legacy = {"A.FCStd": ["cad/A.FCStd"]}
        abs_m = map_json_payload_to_abs(legacy, anchor)
        self.assertTrue(str(abs_m["A.FCStd"][0]).endswith("/cad/A.FCStd"))

    def test_map_json_payload_to_abs_dot_slash(self) -> None:
        anchor = Path("/tmp/workspace")
        legacy = {"A.FCStd": ["./cad/A.FCStd"]}
        abs_m = map_json_payload_to_abs(legacy, anchor)
        self.assertTrue(str(abs_m["A.FCStd"][0]).endswith("/cad/A.FCStd"))


if __name__ == "__main__":
    unittest.main()
