"""单元测试套件注册与 Web runner。"""

from __future__ import annotations

import unittest

from phoenix.testing.runner import iter_unit_test_run_events, run_unit_test_suite
from phoenix.testing.suite_registry import (
    classify_module,
    discover_test_module_names,
    list_suites,
    modules_for_suite,
)


class TestSuiteRegistry(unittest.TestCase):
    def test_discover_includes_code_and_cad(self) -> None:
        names = discover_test_module_names()
        self.assertIn("tests.test_code_index", names)
        self.assertIn("tests.test_fcstd_mapping", names)

    def test_classify_prefixes(self) -> None:
        self.assertEqual(classify_module("tests.test_reorder_members_cpp"), "code")
        self.assertEqual(classify_module("tests.test_bom_xref"), "cad")
        self.assertEqual(classify_module("tests.test_user_prefs"), "platform")

    def test_list_suites_has_all_and_modules(self) -> None:
        suites = {s.id: s for s in list_suites()}
        self.assertIn("all", suites)
        self.assertIn("code", suites)
        self.assertGreater(suites["all"].module_count, suites["code"].module_count)


class TestUnitTestRunner(unittest.TestCase):
    def test_run_code_suite_returns_structure(self) -> None:
        result = run_unit_test_suite("code")
        self.assertEqual(result.suite_id, "code")
        self.assertIn("tests_run", result.summary)
        self.assertIsInstance(result.cases, list)
        self.assertGreater(result.summary["tests_run"], 0)

    def test_modules_for_unknown_suite_raises_via_payload(self) -> None:
        mods = modules_for_suite("platform")
        self.assertTrue(all(classify_module(m) == "platform" for m in mods))

    def test_stream_emits_start_case_and_done(self) -> None:
        events = list(iter_unit_test_run_events(["code"]))
        types = [e["type"] for e in events]
        self.assertEqual(types[0], "start")
        self.assertEqual(types[-1], "done")
        self.assertIn("case_start", types)
        self.assertIn("case_done", types)
        done = events[-1]
        self.assertEqual(done["type"], "done")
        self.assertGreater(done["result"]["summary"]["tests_run"], 0)

    def test_stream_cancel_check_stops_early(self) -> None:
        checks = [0]

        def cancel_check() -> bool:
            checks[0] += 1
            return checks[0] > 3

        full = list(iter_unit_test_run_events(["code"]))
        full_cases = sum(1 for e in full if e["type"] == "case_done")

        events = list(iter_unit_test_run_events(["code"], cancel_check=cancel_check))
        self.assertEqual(events[-1]["type"], "cancelled")
        self.assertEqual(events[-1]["result"]["summary"].get("cancelled"), 1)
        partial_cases = sum(1 for e in events if e["type"] == "case_done")
        self.assertGreater(partial_cases, 0)
        self.assertLess(partial_cases, full_cases)

    def test_stream_does_not_cancel_before_first_case(self) -> None:
        events = list(iter_unit_test_run_events(["code"], cancel_check=lambda: True))
        self.assertEqual(events[0]["type"], "start")
        self.assertIn(events[1]["type"], ("module_start", "case_start"))
        self.assertGreater(events[-1]["result"]["summary"]["tests_run"], 0)

    def test_plan_multi_suite(self) -> None:
        from phoenix.testing.runner import plan_unit_test_run

        plan = plan_unit_test_run(["code", "platform"])
        self.assertIn("Code 模块", plan["suite_label"])
        self.assertGreater(plan["total_cases"], 0)
        self.assertGreater(plan["total_modules"], 0)
        self.assertTrue(any(m["suite_id"] == "code" for m in plan["modules"]))
        self.assertTrue(any(m["suite_id"] == "platform" for m in plan["modules"]))

    def test_include_module_names_filters_run(self) -> None:
        from phoenix.testing.runner import UnitTestRunOptions, plan_unit_test_run, run_unit_test_suites

        full_plan = plan_unit_test_run(["code"])
        self.assertGreater(full_plan["total_modules"], 1)
        only_mod = full_plan["modules"][0]["module"]
        plan = plan_unit_test_run(
            ["code"],
            options=UnitTestRunOptions(include_module_names=frozenset([only_mod])),
        )
        self.assertEqual(plan["total_modules"], 1)
        self.assertEqual(plan["modules"][0]["module"], only_mod)

        result = run_unit_test_suites(
            ["code"],
            options=UnitTestRunOptions(include_module_names=frozenset([only_mod])),
        )
        self.assertTrue(all(c["module"] == only_mod for c in result.cases))

    def test_exclude_case_ids_skips_and_counts_ignored(self) -> None:
        from phoenix.testing.runner import UnitTestRunOptions, run_unit_test_suites

        probe = run_unit_test_suites(["code"])
        self.assertGreater(len(probe.cases), 0)
        exclude_id = probe.cases[0]["id"]
        result = run_unit_test_suites(
            ["code"],
            options=UnitTestRunOptions(exclude_case_ids=frozenset([exclude_id])),
        )
        self.assertEqual(result.summary.get("ignored"), 1)
        ran_ids = {c["id"] for c in result.cases}
        self.assertNotIn(exclude_id, ran_ids)


if __name__ == "__main__":
    unittest.main()
