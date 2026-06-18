# 单元测试 reorder_ignore

from __future__ import annotations

import unittest

from phoenix.code.reorder_ignore import is_ignored_name


class TestReorderIgnore(unittest.TestCase):
    def test_glob_pattern(self) -> None:
        patterns = ["cmake-build-*", "build"]
        self.assertTrue(is_ignored_name("cmake-build-debug", patterns))
        self.assertFalse(is_ignored_name("cmake", patterns))

    def test_dot_prefix_always_ignored(self) -> None:
        self.assertTrue(is_ignored_name(".hidden", []))


if __name__ == "__main__":
    unittest.main()
