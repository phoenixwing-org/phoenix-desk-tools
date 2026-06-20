"""FileWorkset 服务单测。"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from phoenix.freecad.phoenix_schema import WORKSPACE_DATABASE_FILENAME
from phoenix.services.file_workset_service import (
    FILE_WORKSETS_BASENAME,
    get_file_worksets_api,
    load_file_worksets,
    normalize_workset_paths,
    put_file_worksets_api,
    save_file_worksets,
)


class TestFileWorksetService(unittest.TestCase):
    def test_normalize_workset_paths_dedup_and_sort(self) -> None:
        out = normalize_workset_paths(["b/a.cpp", "./b/a.cpp", "z.h", "../evil.cpp"])
        self.assertEqual(out, ["b/a.cpp", "z.h"])

    def test_save_and_load_roundtrip_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            body = {
                "worksets": [
                    {
                        "id": "ws-1",
                        "name": "测试集",
                        "paths": ["src/foo.cpp", "src/bar.h"],
                        "source": "test",
                    }
                ]
            }
            save_file_worksets(root, body)
            db = root / ".phoenix" / WORKSPACE_DATABASE_FILENAME
            self.assertTrue(db.is_file())
            loaded = load_file_worksets(root)
            self.assertEqual(len(loaded["worksets"]), 1)
            self.assertEqual(loaded["worksets"][0]["name"], "测试集")
            self.assertEqual(loaded["worksets"][0]["paths"], ["src/bar.h", "src/foo.cpp"])

    def test_import_legacy_json_once(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            phoenix = root / ".phoenix"
            phoenix.mkdir()
            legacy = phoenix / FILE_WORKSETS_BASENAME
            legacy.write_text(
                json.dumps(
                    {"version": 1, "worksets": [{"id": "j1", "name": "JSON", "paths": ["a.cpp"]}]},
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            loaded = load_file_worksets(root)
            self.assertEqual(loaded["worksets"][0]["id"], "j1")
            self.assertTrue((phoenix / WORKSPACE_DATABASE_FILENAME).is_file())

    def test_api_put_get(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = put_file_worksets_api(
                root,
                {"worksets": [{"id": "a", "name": "A", "paths": ["x.cpp"]}]},
            )
            self.assertEqual(out.get("storage"), "sqlite")
            self.assertIn("workspace_path", out)
            self.assertEqual(out["worksets"][0]["paths"], ["x.cpp"])
            again = get_file_worksets_api(root)
            self.assertEqual(json.loads(json.dumps(again))["worksets"][0]["id"], "a")

    def test_save_rejects_invalid_and_dedupes_paths(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            out = save_file_worksets(
                root,
                {
                    "worksets": [
                        {
                            "id": "ws-bad",
                            "name": "bad",
                            "paths": ["ok.cpp", "../evil.cpp", "ok.cpp"],
                        }
                    ]
                },
            )
            self.assertEqual(out["worksets"][0]["paths"], ["ok.cpp"])


if __name__ == "__main__":
    unittest.main()
