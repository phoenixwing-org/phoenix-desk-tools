"""PartKey 从路径 / 文件名解析（统一入口）。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fcdesk.freecad.part_naming import PartNamingParser
from fcdesk.services.part_key_service import resolve_part_key_from_workspace_rel


class TestPartKeyHints(unittest.TestCase):
    def test_short_part_number(self) -> None:
        h = PartNamingParser.part_key_hints_from_basename("8001.001-H-PX-滑轨变形.FCStd")
        self.assertEqual(h["part_number"], "8001")
        self.assertEqual(h["part_version"], "001")
        self.assertEqual(h["part_key"], "8001.001")
        self.assertEqual(h["TypeCode"], "H")

    def test_single_digit_version_padded(self) -> None:
        h = PartNamingParser.part_key_hints_from_basename("8001.1-H-PX-test.FCStd")
        self.assertEqual(h["part_number"], "8001")
        self.assertEqual(h["part_version"], "001")


class TestPartKeyResolve(unittest.TestCase):
    def test_resolve_filename_only(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            rr = Path(td)
            out = resolve_part_key_from_workspace_rel(rr, "freecad/8001.001-H-PX-滑轨变形.FCStd")
            self.assertEqual(out["part_key"], "8001.001")
            self.assertEqual(out["source"], "filename")
            self.assertFalse(out["in_catalog"])

    def test_rejects_non_fcstd(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                resolve_part_key_from_workspace_rel(Path(td), "docs/readme.md")


if __name__ == "__main__":
    unittest.main()
