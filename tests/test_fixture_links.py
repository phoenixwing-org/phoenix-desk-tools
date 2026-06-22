"""tests/fixtures 外链 manifest 与 symlink 逻辑。"""

from __future__ import annotations

import json
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
            self.assertIn(result.status, ("linked", "ok"))
            link = fixtures / "UpstreamLink"
            self.assertTrue(link.exists())
            self.assertEqual(link.resolve(), target.resolve())

    def test_sync_fixture_links_respects_enabled(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            fixtures = repo / "tests" / "fixtures"
            upstream = root / "Upstream"
            upstream.mkdir(parents=True)
            fixtures.mkdir(parents=True)
            catalog = root / "phoenix" / "config" / "test_fixture_catalog.json"
            catalog.parent.mkdir(parents=True)
            catalog.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "projects": [
                            {
                                "name": "UpstreamLink",
                                "candidates": ["../Upstream"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with (
                mock.patch.object(fixture_links, "repo_root", return_value=repo),
                mock.patch.object(fixture_links, "fixtures_dir", return_value=fixtures),
                mock.patch.object(fixture_links, "catalog_path", return_value=catalog),
                mock.patch.object(fixture_links, "resolve_checkout_root", return_value=upstream.parent),
                mock.patch("os.symlink"),
            ):
                empty = fixture_links.sync_fixture_links(enabled=set())
                self.assertEqual(empty, [])
                results = fixture_links.sync_fixture_links(enabled={"UpstreamLink"})
            self.assertTrue(any(r.status in ("linked", "ok") for r in results))

    def test_ensure_link_skips_real_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "Upstream"
            target.mkdir()
            fixtures = root / "fixtures"
            fixtures.mkdir()
            existing = fixtures / "UpstreamLink"
            existing.mkdir()
            (existing / "keep.txt").write_text("x", encoding="utf-8")
            with mock.patch.object(fixture_links, "fixtures_dir", return_value=fixtures):
                result = fixture_links.ensure_link("UpstreamLink", target)
            self.assertEqual(result.status, "skipped")
            self.assertTrue(existing.is_dir())
            self.assertFalse(existing.is_symlink())

    def test_git_clone_skips_existing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "Repo"
            dest.mkdir()
            (dest / ".git").mkdir()
            self.assertEqual(
                fixture_links.git_clone_repository("https://example.com/r.git", dest),
                "exists",
            )


if __name__ == "__main__":
    unittest.main()
