"""phoenix-workspace.sqlite schema v10 与重建。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from phoenix.freecad.phoenix_schema import (
    SCHEMA_VERSION,
    T_FILE_ASSET,
    T_META,
    WORKSPACE_DATABASE_FILENAME,
    database_status_payload,
    phoenix_dir,
    recreate_database,
    workspace_database_path,
)
from phoenix.freecad.phoenix_store import connect


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

    def test_nested_connect_same_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with connect(root) as outer:
                outer.execute(
                    "INSERT INTO phoenix_cad_file_asset(repo_rel_path, filename, updated_at) "
                    "VALUES (?, ?, ?)",
                    ("nested.fcstd", "nested.fcstd", "2026-01-01T00:00:00+00:00"),
                )
                with connect(root) as inner:
                    row = inner.execute(
                        "SELECT repo_rel_path FROM phoenix_cad_file_asset WHERE repo_rel_path = ?",
                        ("nested.fcstd",),
                    ).fetchone()
                    self.assertIsNotNone(row)
            with connect(root) as conn:
                n = conn.execute(
                    "SELECT COUNT(*) FROM phoenix_cad_file_asset WHERE repo_rel_path = ?",
                    ("nested.fcstd",),
                ).fetchone()[0]
                self.assertEqual(n, 1)

    def test_database_status_empty_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            status = database_status_payload(root)
            self.assertFalse(status["database_exists"])
            self.assertFalse(status["needs_recreate"])

    def test_recreate_database(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            phoenix_dir(root).mkdir(parents=True, exist_ok=True)
            workspace_database_path(root).write_bytes(b"old")
            out = recreate_database(root)
            self.assertEqual(out["schema_version"], SCHEMA_VERSION)
            self.assertTrue(workspace_database_path(root).is_file())
            self.assertIn(WORKSPACE_DATABASE_FILENAME, out["database_path"])


if __name__ == "__main__":
    unittest.main()
