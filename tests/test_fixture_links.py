"""tests/fixtures 外链 manifest 与 symlink 逻辑。"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from phoenix.testing import fixture_links


class TestFixtureLinks(unittest.TestCase):
    def test_resolve_link_target_env_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ext = root / "External"
            ext.mkdir()
            link = {"name": "Demo", "candidates": ["../Missing"]}
            with mock.patch.dict(os.environ, {"PHOENIX_FIXTURE_Demo": str(ext)}):
                self.assertEqual(fixture_links.resolve_link_target(link, root), ext.resolve())

    def test_ensure_link_creates_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "Upstream"
            target.mkdir()
            fixtures = root / "fixtures"
            fixtures.mkdir()
            with mock.patch.object(fixture_links, "fixtures_dir", return_value=fixtures):
                result = fixture_links.ensure_link("UpstreamLink", target)
            self.assertEqual(result.status, "linked")
            link_path = fixtures / "UpstreamLink"
            self.assertTrue(link_path.is_symlink())
            self.assertEqual(link_path.resolve(), target.resolve())

    def test_ensure_link_skips_real_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "Upstream"
            target.mkdir()
            fixtures = root / "fixtures"
            fixtures.mkdir()
            existing = fixtures / "UpstreamLink"
            existing.mkdir()
            with mock.patch.object(fixture_links, "fixtures_dir", return_value=fixtures):
                result = fixture_links.ensure_link("UpstreamLink", target)
            self.assertEqual(result.status, "skipped")
            self.assertTrue(existing.is_dir())
            self.assertFalse(existing.is_symlink())


if __name__ == "__main__":
    unittest.main()
