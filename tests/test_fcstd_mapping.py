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
    coerce_payload_to_basename_rel_paths,
    hints_from_fcstd_filename,
    hints_from_fcstd_location,
    infer_fcstd_name_suffix,
    infer_model_series,
    legacy_flat_dict_to_document,
    map_json_payload_to_abs,
    normalize_repo_rel_path_for_map,
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

    def test_requires_pn_and_pv(self) -> None:
        self.assertIsNone(
            compose_fcstd_body_label_display(
                part_number="",
                part_version="1",
                part_name="A",
                label_fallback="",
            )
        )


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
            raw = json.loads((td / "fcstd_map.json").read_text(encoding="utf-8"))
            self.assertEqual(raw["entries"][0]["filename"], "new.FCStd")
            self.assertEqual(raw["entries"][0]["repo_rel_path"], "./new.FCStd")
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
