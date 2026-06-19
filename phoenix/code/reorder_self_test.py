"""成员排序锁定段回归自检（内置 fixture，不扫用户工作空间）。"""

from __future__ import annotations

import io
import re
import unittest
from typing import Any

from tests import test_reorder_avoidance_rules as avoidance_tests

_CASE_ID_RE = re.compile(r"case_id=([\w-]+)")


def _flatten_suite(suite: unittest.TestSuite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _flatten_suite(item)
        else:
            yield item


def _case_id(test: unittest.TestCase) -> str:
    doc = test._testMethodDoc or ""
    match = _CASE_ID_RE.search(doc)
    if match:
        return match.group(1)
    return test._testMethodName


def run_reorder_avoidance_self_test() -> dict[str, Any]:
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()
    for cls in (avoidance_tests.TestAvoidanceRuleParsing, avoidance_tests.TestReorderAvoidanceRules):
        suite.addTests(loader.loadTestsFromTestCase(cls))

    tests = [t for t in _flatten_suite(suite) if isinstance(t, unittest.TestCase)]
    result = unittest.TextTestRunner(stream=io.StringIO(), verbosity=0).run(suite)

    failed: dict[str, str] = {}
    for test, err in result.failures + result.errors:
        failed[test.id()] = (err or "").strip().splitlines()[-1] if err else "failed"
    skipped = {test.id() for test, _reason in result.skipped}

    cases: list[dict[str, Any]] = []
    for test in tests:
        tid = test.id()
        cid = _case_id(test)
        if tid in failed:
            cases.append({"id": cid, "pass": False, "message": failed[tid]})
        elif tid in skipped:
            cases.append({"id": cid, "pass": True, "skipped": True, "message": "fixture 未链接，已跳过"})
        else:
            cases.append({"id": cid, "pass": True, "message": "ok"})

    cases.sort(key=lambda c: c["id"])
    ran = result.testsRun - len(result.skipped)
    passed = sum(1 for c in cases if c["pass"] and not c.get("skipped"))
    failed_n = len(result.failures) + len(result.errors)
    ok = failed_n == 0
    return {
        "ok": ok,
        "ran": ran,
        "passed": passed,
        "failed": failed_n,
        "skipped": len(result.skipped),
        "cases": cases,
        "summary": f"锁定段自检：{passed}/{ran} 通过"
        + (f"，跳过 {len(result.skipped)}" if result.skipped else "")
        + ("" if ok else f"，失败 {failed_n}"),
    }
