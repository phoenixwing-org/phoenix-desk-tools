"""工作空间树构建。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.services.workspace_service import build_workspace_tree, scan_workspace_files


class TestWorkspaceTree(unittest.TestCase):
    def test_build_nested_tree(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="ws_tree_"))
        try:
            (td / "fc").mkdir()
            (td / "fc" / "a.FCStd").write_bytes(b"x")
            (td / "fc" / "b.FCStd").write_bytes(b"y")
            files = scan_workspace_files(td, want_fcstd=True, want_sw_part=False)
            data = build_workspace_tree(td, files)
            self.assertEqual(data["file_count"], 2)
            root = data["tree"]
            self.assertEqual(root["type"], "dir")
            fc_dir = next(c for c in root["children"] if c["name"] == "fc")
            self.assertEqual(len(fc_dir["children"]), 2)
        finally:
            import shutil

            shutil.rmtree(td, ignore_errors=True)

    def test_scan_code_extensions(self) -> None:
        td = Path(tempfile.mkdtemp(prefix="ws_code_"))
        try:
            (td / "src").mkdir()
            (td / "src" / "a.cpp").write_text("void a(){}", encoding="utf-8")
            (td / "src" / "a.h").write_text("class A {};", encoding="utf-8")
            (td / "src" / "b.hpp").write_text("class B {};", encoding="utf-8")
            (td / "src" / "readme.md").write_text("x", encoding="utf-8")
            all_code = scan_workspace_files(td, want_cpp=True, want_header=True)
            self.assertEqual(len(all_code), 3)
            cpp_only = scan_workspace_files(td, want_cpp=True, want_header=False)
            self.assertEqual(len(cpp_only), 1)
            self.assertEqual(cpp_only[0].name, "a.cpp")
            data = build_workspace_tree(td, all_code)
            leaf = data["tree"]["children"][0]["children"][0]
            self.assertEqual(leaf["kind"], "cpp")
        finally:
            import shutil

            shutil.rmtree(td, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
