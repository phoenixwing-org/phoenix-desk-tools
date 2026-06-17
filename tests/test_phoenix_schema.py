"""phoenix-cad.sqlite schema v10 与旧库丢弃。"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from fcdesk.freecad.phoenix_schema import (
    CAD_DATABASE_FILENAME,
    LEGACY_DATABASE_FILENAME,
    SCHEMA_VERSION,
    T_FILE_ASSET,
    T_META,
    cad_database_path,
    discard_legacy_database_files,
    legacy_database_path,
    phoenix_dir,
    recreate_database,
)
from fcdesk.freecad.phoenix_store import connect


class TestPhoenixSchema(unittest.TestCase):
    def test_fresh_connect_creates_v10_tables(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with connect(root) as conn:
                row = conn.execute(
                    f"SELECT value FROM {T_META} WHERE key = 'schema_version'"
                ).fetchone()
                self.assertEqual(int(row["value"]), SCHEMA_VERSION)
                tables = {
                    r[0]
                    for r in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type='table'"
                    ).fetchall()
                }
                self.assertIn(T_FILE_ASSET, tables)
                self.assertNotIn("file_asset", tables)

    def test_discard_legacy_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            phoenix_dir(root).mkdir(parents=True, exist_ok=True)
            legacy_database_path(root).write_text("legacy", encoding="utf-8")
            removed = discard_legacy_database_files(root)
            self.assertIn(LEGACY_DATABASE_FILENAME, removed)
            self.assertFalse(legacy_database_path(root).is_file())

    def test_recreate_database(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            phoenix_dir(root).mkdir(parents=True, exist_ok=True)
            legacy_database_path(root).write_bytes(b"old")
            out = recreate_database(root)
            self.assertEqual(out["schema_version"], SCHEMA_VERSION)
            self.assertTrue(cad_database_path(root).is_file())
            self.assertFalse(legacy_database_path(root).is_file())
            self.assertIn(CAD_DATABASE_FILENAME, out["database_path"])


if __name__ == "__main__":
    unittest.main()
