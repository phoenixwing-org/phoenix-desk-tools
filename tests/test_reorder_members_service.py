"""reorder_members Web 服务层。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.services.reorder_members_service import (
    list_reorder_top_level_dirs,
    run_reorder_members_batch,
)


class TestReorderMembersService(unittest.TestCase):
    def test_list_top_level_dirs_uses_workspace_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            (ws / "ModA").mkdir()
            (ws / "ModB").mkdir()
            (ws / "ModA" / "a.cpp").write_text("void f(){}\n", encoding="utf-8")
            (ws / ".phoenix").mkdir()
            out = list_reorder_top_level_dirs(ws)
            names = [d["name"] for d in out["dirs"]]
            self.assertEqual(names, ["ModA", "ModB"])
            self.assertGreaterEqual(out["dirs"][0]["source_file_count"], 1)
            self.assertEqual(out["workspace_path"], str(ws.resolve()))

    def test_run_batch_dry_run_empty_cpp(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            mod = ws / "EmptyMod"
            mod.mkdir()
            (mod / "noop.cpp").write_text("void noop() {}\n", encoding="utf-8")
            out = run_reorder_members_batch(ws, top_dirs=["EmptyMod"], patch={"dry_run": True, "verbose": False})
            self.assertTrue(out["ok"])
            self.assertIn("EmptyMod", out["log"])
            self.assertTrue(out["dry_run"])


if __name__ == "__main__":
    unittest.main()
