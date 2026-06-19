"""Code schema 迁移。"""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from phoenix.code.schema import T_CODE_FILE, migrate_code_schema


class TestCodeSchemaMigrate(unittest.TestCase):
    def test_add_text_encoding_column(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "t.sqlite"
            conn = sqlite3.connect(str(db))
            try:
                conn.execute(
                    f"""
                    CREATE TABLE {T_CODE_FILE} (
                        id INTEGER PRIMARY KEY,
                        repo_rel_path TEXT UNIQUE,
                        filename TEXT,
                        asset_kind TEXT,
                        file_ext TEXT,
                        file_status TEXT,
                        size_bytes INTEGER,
                        last_seen_at TEXT,
                        updated_at TEXT
                    )
                    """
                )
                migrate_code_schema(conn)
                cols = {r[1] for r in conn.execute(f"PRAGMA table_info({T_CODE_FILE})")}
                self.assertIn("text_encoding", cols)
                migrate_code_schema(conn)  # idempotent
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main()
