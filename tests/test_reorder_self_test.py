"""成员排序 Web 回归自检 API。"""

from __future__ import annotations

import unittest

from phoenix.code.reorder_self_test import run_reorder_avoidance_self_test


class TestReorderSelfTest(unittest.TestCase):
    def test_self_test_runs_fixture_suite(self) -> None:
        out = run_reorder_avoidance_self_test()
        self.assertIn("ok", out)
        self.assertIn("cases", out)
        self.assertGreater(out["ran"], 0)
        self.assertEqual(out["failed"], 0)
        self.assertTrue(out["ok"])
        ids = {c["id"] for c in out["cases"]}
        self.assertIn("clang-off-on", ids)


if __name__ == "__main__":
    unittest.main()
