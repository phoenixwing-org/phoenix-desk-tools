"""PartNamingParser 单元测试。"""

from __future__ import annotations

import unittest

from phoenix.freecad.part_naming import PartNamingParser


class TestPartNamingParser(unittest.TestCase):
    def test_part_key_from_filename(self) -> None:
        h = PartNamingParser.part_key_hints_from_basename("8001.001-H-PX-滑轨变形.FCStd")
        self.assertEqual(h["part_key"], "8001.001")

    def test_parse_part_key_text(self) -> None:
        p = PartNamingParser.parse_part_key_text("8001.1")
        self.assertIsNotNone(p)
        assert p is not None
        self.assertEqual(p["part_key"], "8001.001")

    def test_refine_part_name(self) -> None:
        name = PartNamingParser.refine_inferred_part_name(
            "8001.001-H-PX-滑轨变形",
            part_number="8001",
            part_version="001",
            type_code="H",
            model_series="PX",
        )
        self.assertEqual(name, "滑轨变形")


if __name__ == "__main__":
    unittest.main()
