"""fcdesk.fcstd_mapping：结构化映射与遗留 JSON 兼容性。"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from fcdesk.fcstd_mapping import (
    FcstdMapDocument,
    FcstdMapEntry,
    coerce_payload_to_basename_rel_paths,
    hints_from_fcstd_filename,
    hints_from_fcstd_location,
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
        self.assertEqual(h.get("model_series"), "ABC")

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
        self.assertEqual(h["part_no"], "100082")
        self.assertEqual(h["version"], "002")
        self.assertEqual(h["type_code"], "R")


class TestDocument(unittest.TestCase):
    def test_roundtrip_json(self) -> None:
        doc = FcstdMapDocument(
            entries=[
                FcstdMapEntry(
                    repo_rel_path="cad/a.FCStd",
                    filename="a.FCStd",
                    part_no="1",
                    version="002",
                    type_code="S",
                    model_series="ABC",
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
        self.assertEqual(doc2.entries[0].type_code, "S")
        self.assertEqual(doc2.entries[0].model_series, "ABC")
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
