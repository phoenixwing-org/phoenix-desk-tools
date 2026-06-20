"""侧栏模块偏好（CAD / Code）。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from phoenix.config import user_prefs as prefs
from phoenix.config.nav_modules import (
    DEFAULT_NAV_MODULES_ENABLED,
    enabled_from_module_scope,
    module_scope_from_enabled,
    normalize_module_scope,
    normalize_nav_modules_enabled,
    normalized_nav_modules,
    normalized_workspace_nav_modules,
)


def _patch_launcher_storage(platform: Path):
    platform.parent.mkdir(parents=True, exist_ok=True)
    return mock.patch.multiple(
        prefs,
        platform_launcher_prefs_file=mock.Mock(return_value=platform),
        launcher_prefs_file=mock.Mock(return_value=platform),
    )


class TestNavModules(unittest.TestCase):
    def test_default_enabled_both_modules(self) -> None:
        self.assertEqual(list(DEFAULT_NAV_MODULES_ENABLED), ["cad", "code"])
        self.assertEqual(normalize_nav_modules_enabled(None), ["cad", "code"])
        self.assertEqual(normalize_nav_modules_enabled([]), ["cad", "code"])

    def test_normalize_dedupes_and_filters(self) -> None:
        raw = ["code", "CAD", "cad", "unknown", ""]
        self.assertEqual(normalize_nav_modules_enabled(raw), ["code", "cad"])

    def test_save_launcher_nav_modules_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            launcher = Path(td) / "launcher.json"
            with _patch_launcher_storage(launcher):
                saved = prefs.save_launcher_nav_modules(["code"])
                loaded = prefs.load_launcher_prefs()
            self.assertEqual(saved, {"enabled": ["code"]})
            self.assertEqual(loaded["nav_modules"], {"enabled": ["code"]})
            self.assertTrue(launcher.is_file())

    def test_module_scope_roundtrip(self) -> None:
        self.assertEqual(normalize_module_scope("CAD"), "cad")
        self.assertEqual(enabled_from_module_scope("cad"), ["cad"])
        self.assertEqual(enabled_from_module_scope("all"), ["cad", "code"])
        self.assertEqual(module_scope_from_enabled(["code"]), "code")
        self.assertEqual(
            normalized_workspace_nav_modules({"scope": "code"}),
            {"scope": "code", "enabled": ["code"]},
        )

    def test_save_workspace_nav_modules_sqlite(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td)
            saved = prefs.save_workspace_nav_modules(repo, scope="cad")
            self.assertEqual(saved["scope"], "cad")
            loaded = prefs.load_workspace_nav_modules(repo)
            self.assertEqual(loaded, {"scope": "cad", "enabled": ["cad"]})


if __name__ == "__main__":
    unittest.main()
