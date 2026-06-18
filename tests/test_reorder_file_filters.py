"""reorder_members 文件类型过滤。"""

from __future__ import annotations

import unittest

from phoenix.code.reorder_members import (
    include_flags_to_legacy_filters,
    legacy_filters_to_include_flags,
    normalize_reorder_file_filters,
    normalize_reorder_include_flags,
    read_reorder_include_flags,
    resolve_reorder_include_for_run,
)


class TestLegacyFilters(unittest.TestCase):
    def test_both_true_means_all(self) -> None:
        self.assertEqual(normalize_reorder_file_filters(True, True), (False, False))

    def test_single_filter_unchanged(self) -> None:
        self.assertEqual(normalize_reorder_file_filters(True, False), (True, False))
        self.assertEqual(normalize_reorder_file_filters(False, True), (False, True))
        self.assertEqual(normalize_reorder_file_filters(False, False), (False, False))


class TestIncludeFlags(unittest.TestCase):
    def test_default_both_included(self) -> None:
        self.assertEqual(normalize_reorder_include_flags(True, True), (True, True))
        self.assertEqual(include_flags_to_legacy_filters(True, True), (False, False))

    def test_cpp_only_include(self) -> None:
        self.assertEqual(include_flags_to_legacy_filters(True, False), (True, False))

    def test_header_only_include(self) -> None:
        self.assertEqual(include_flags_to_legacy_filters(False, True), (False, True))

    def test_neither_normalizes_to_both(self) -> None:
        self.assertEqual(normalize_reorder_include_flags(False, False), (True, True))

    def test_legacy_migration(self) -> None:
        self.assertEqual(legacy_filters_to_include_flags(False, False), (True, True))
        self.assertEqual(legacy_filters_to_include_flags(True, False), (True, False))
        self.assertEqual(legacy_filters_to_include_flags(False, True), (False, True))

    def test_read_new_prefs(self) -> None:
        self.assertEqual(
            read_reorder_include_flags({"include_cpp": True, "include_header": False}),
            (True, False),
        )

    def test_resolve_run_without_filters(self) -> None:
        self.assertEqual(resolve_reorder_include_for_run(None), (True, True))
        self.assertEqual(resolve_reorder_include_for_run({}), (True, True))
        self.assertEqual(
            resolve_reorder_include_for_run({"targets": ["Mod"], "dry_run": True}),
            (True, True),
        )

    def test_resolve_run_with_include(self) -> None:
        self.assertEqual(
            resolve_reorder_include_for_run({"include_cpp": True, "include_header": False}),
            (True, False),
        )


if __name__ == "__main__":
    unittest.main()
