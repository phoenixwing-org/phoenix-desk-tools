"""fcdesk.bom_apply_prefs"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from fcdesk.bom_apply_prefs import (
    DEFAULT_PART_VERSION,
    DEFAULT_TYPE_CODE,
    load_bom_apply_field_defaults,
    next_part_number_after,
    recommend_field_fill_values,
    save_bom_apply_field_defaults,
)
from fcdesk.config.user_prefs import WORKSPACE_DOTFILE_NAME


class TestBomApplyPrefs(unittest.TestCase):
    def test_defaults_without_dotfile(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="bom_prefs_"))
        try:
            prefs = load_bom_apply_field_defaults(td)
            self.assertEqual(prefs["last_part_version"], DEFAULT_PART_VERSION)
            self.assertEqual(prefs["last_type_code"], DEFAULT_TYPE_CODE)
            fills = recommend_field_fill_values(prefs)
            self.assertEqual(fills["PartVersion"], "001")
            self.assertEqual(fills["TypeCode"], "H")
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_save_and_load_roundtrip(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="bom_prefs_"))
        try:
            save_bom_apply_field_defaults(
                td,
                part_number="100346",
                part_version="002",
                type_code="s",
                model_series="5TA",
            )
            prefs = load_bom_apply_field_defaults(td)
            self.assertEqual(prefs["last_part_number"], "100346")
            self.assertEqual(prefs["last_part_version"], "002")
            self.assertEqual(prefs["last_type_code"], "S")
            self.assertEqual(prefs["last_model_series"], "5TA")
            raw = json.loads((td / WORKSPACE_DOTFILE_NAME).read_text(encoding="utf-8"))
            self.assertIn("bom_apply", raw)
        finally:
            shutil.rmtree(td, ignore_errors=True)

    def test_recommend_fills_empty_only_semantics(self) -> None:
        prefs = {
            "last_part_number": "9",
            "last_part_version": "001",
            "last_type_code": "H",
            "last_model_series": "ABC",
        }
        fills = recommend_field_fill_values(prefs)
        self.assertEqual(fills["PartNumber"], "10")
        self.assertEqual(fills["ModelSeries"], "ABC")

    def test_next_part_number_increment(self) -> None:
        self.assertEqual(next_part_number_after("100001"), "100002")
        self.assertEqual(next_part_number_after("100346"), "100347")
        self.assertEqual(next_part_number_after("009"), "010")
        self.assertEqual(next_part_number_after(""), "")
        self.assertEqual(next_part_number_after("ABC"), "ABC")


if __name__ == "__main__":
    unittest.main()
