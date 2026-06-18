"""reorder_members 文件类型过滤。"""

from __future__ import annotations

import unittest

from phoenix.code.reorder_members import normalize_reorder_file_filters


class TestReorderFileFilters(unittest.TestCase):
    def test_both_true_means_all(self) -> None:
        self.assertEqual(normalize_reorder_file_filters(True, True), (False, False))

    def test_single_filter_unchanged(self) -> None:
        self.assertEqual(normalize_reorder_file_filters(True, False), (True, False))
        self.assertEqual(normalize_reorder_file_filters(False, True), (False, True))
        self.assertEqual(normalize_reorder_file_filters(False, False), (False, False))


if __name__ == "__main__":
    unittest.main()
