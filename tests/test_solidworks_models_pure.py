"""不依赖 SolidWorks COM：仅测试 ``solidworks_models`` 扫描规则。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.integration.solidworks_models import iter_sw_model_paths, sw_doc_type_suffix


class TestSwDocTypeSuffix(unittest.TestCase):
    def test_part_and_asm(self) -> None:
        self.assertEqual(sw_doc_type_suffix("a.sldprt"), 1)
        self.assertEqual(sw_doc_type_suffix("b.SLDASM"), 2)

    def test_drawing_unknown(self) -> None:
        self.assertIsNone(sw_doc_type_suffix("x.slddrw"))
        self.assertIsNone(sw_doc_type_suffix("readme.txt"))


class TestIterSwModelPaths(unittest.TestCase):
    def test_top_only(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            td = Path(d)
            (td / "a.sldprt").touch()
            (td / "b.SLDASM").touch()
            (td / "c.slddrw").touch()
            sub = td / "sub"
            sub.mkdir()
            (sub / "nested.sldprt").touch()
            names = sorted(p.name for p in iter_sw_model_paths(td, recursive=False))
            self.assertEqual(names, ["a.sldprt", "b.SLDASM"])

    def test_recursive(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            td = Path(d)
            (td / "root.sldasm").touch()
            sub = td / "deep" / "d"
            sub.mkdir(parents=True)
            (sub / "in.sldprt").touch()
            names = sorted(p.name for p in iter_sw_model_paths(td, recursive=True))
            self.assertEqual(names, ["in.sldprt", "root.sldasm"])

    def test_not_a_dir_raises(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "nope.txt"
            p.touch()
            with self.assertRaises(NotADirectoryError):
                list(iter_sw_model_paths(p))


if __name__ == "__main__":
    unittest.main()
