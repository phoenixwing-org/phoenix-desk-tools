"""Code 批量改名 / UUID 引擎。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.code.rename.apply import apply_text_rename
from phoenix.code.rename.scan import RenameScanOptions, preview_text_rename
from phoenix.code.rename.uuid_apply import apply_uuid_hits
from phoenix.code.rename.uuid_scan import UuidScanOptions, make_hit_id, scan_uuid_hits


class TestCodeRenameEngine(unittest.TestCase):
    def test_text_preview_and_apply(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            mod = ws / "ModA"
            mod.mkdir()
            f = mod / "Widget.cpp"
            f.write_text('class OldName {\n  OldName() {}\n};\n', encoding="utf-8")

            opts = RenameScanOptions(old="OldName", new="NewName", levels=["text"])
            prev = preview_text_rename(ws, opts)
            self.assertTrue(prev["implemented"])
            self.assertEqual(prev["summary"]["total_hits"], 2)
            self.assertEqual(len(prev["hits"]), 1)

            dry = apply_text_rename(ws, opts, dry_run=True)
            self.assertEqual(dry["summary"]["total_hits"], 2)
            self.assertIn("OldName", f.read_text(encoding="utf-8"))

            write = apply_text_rename(ws, opts, dry_run=False)
            self.assertEqual(write["summary"]["text_files"], 1)
            text = f.read_text(encoding="utf-8")
            self.assertNotIn("OldName", text)
            self.assertIn("NewName", text)

    def test_respects_ignore_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            ph = ws / ".phoenix"
            ph.mkdir()
            (ph / "code.ignore").write_text("build\n", encoding="utf-8")
            build = ws / "build"
            build.mkdir()
            (build / "x.cpp").write_text("OldName\n", encoding="utf-8")
            (ws / "keep.cpp").write_text("OldName\n", encoding="utf-8")

            opts = RenameScanOptions(old="OldName", new="New", levels=["text"])
            prev = preview_text_rename(ws, opts)
            paths = [h["repo_rel_path"] for h in prev["hits"]]
            self.assertIn("keep.cpp", paths)
            self.assertNotIn("build/x.cpp", paths)


class TestCodeUuidEngine(unittest.TestCase):
    def test_scan_and_apply_map_per_value(self) -> None:
        uid = "550e8400-e29b-41d4-a716-446655440000"
        with tempfile.TemporaryDirectory() as tmp:
            ws = Path(tmp)
            a = ws / "a.json"
            b = ws / "b.json"
            a.write_text(f'{{ "id": "{uid}" }}\n', encoding="utf-8")
            b.write_text(f'{{ "ref": "{uid}" }}\n', encoding="utf-8")

            scanned = scan_uuid_hits(ws, UuidScanOptions())
            self.assertTrue(scanned["implemented"])
            self.assertEqual(scanned["summary"]["total_hits"], 2)
            self.assertEqual(scanned["summary"]["unique_uuids"], 1)
            ids = [h["hit_id"] for h in scanned["hits"]]

            dry = apply_uuid_hits(ws, ids, strategy="map_per_value", dry_run=False)
            self.assertEqual(dry["summary"]["total_hits"], 2)
            new_a = a.read_text(encoding="utf-8")
            new_b = b.read_text(encoding="utf-8")
            self.assertNotIn(uid, new_a)
            self.assertNotIn(uid, new_b)
            # 同一旧 UUID 映射为同一新值
            import re

            m_a = re.search(r'"id": "([^"]+)"', new_a)
            m_b = re.search(r'"ref": "([^"]+)"', new_b)
            assert m_a and m_b
            self.assertEqual(m_a.group(1), m_b.group(1))

    def test_hit_id_roundtrip(self) -> None:
        hid = make_hit_id("src/x.cpp", 3, 10, "{ABC}")
        from phoenix.code.rename.uuid_scan import parse_hit_id

        parsed = parse_hit_id(hid)
        self.assertEqual(parsed["repo_rel_path"], "src/x.cpp")
        self.assertEqual(parsed["line"], 3)


if __name__ == "__main__":
    unittest.main()
