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


if __name__ == "__main__":
    unittest.main()
