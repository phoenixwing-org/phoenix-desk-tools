"""Runtime catalog sync and module descriptions."""

from __future__ import annotations

import unittest

from phoenix.runtime.catalog_sync import sync_runtime_catalog
from phoenix.runtime.catalog_store import get_test_module_map
from phoenix.testing.test_catalog import merge_module_meta


class TestRuntimeCatalog(unittest.TestCase):
    def test_merge_module_meta_prefers_override(self) -> None:
        meta = merge_module_meta(
            file_stem="test_code_ignore",
            module_doc="文件 docstring 首行。",
            override={"description_zh": "JSON 覆盖简介。"},
        )
        self.assertEqual(meta["description_zh"], "JSON 覆盖简介。")

    def test_sync_populates_module_descriptions(self) -> None:
        sync_runtime_catalog(force=True)
        rows = get_test_module_map(["tests.test_code_ignore"])
        row = rows.get("tests.test_code_ignore")
        self.assertIsNotNone(row)
        assert row is not None
        self.assertIn("忽略", row["description_zh"])


if __name__ == "__main__":
    unittest.main()
