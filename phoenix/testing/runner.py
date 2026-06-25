#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run unittest modules and return structured JSON for Web UI."""

from __future__ import annotations

import os
import subprocess
import time
import traceback
import unittest
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, FrozenSet, Iterable, List, Optional, Set

from phoenix.testing.suite_registry import (
    classify_module,
    list_suites,
    modules_for_suite,
    repo_root,
    suite_label,
)


@dataclass(frozen=True)
class UnitTestRunOptions:
    exclude_case_ids: FrozenSet[str] = frozenset()
    include_case_ids: FrozenSet[str] | None = None
    include_module_names: FrozenSet[str] | None = None


@dataclass
class TestCaseRecord:
    id: str
    module: str
    suite_id: str
    class_name: str
    method: str
    status: str  # passed | failed | error | skipped
    duration_ms: int = 0
    message: str = ""
    traceback: str = ""


@dataclass
class ModuleSummary:
    module: str
    tests_run: int = 0
    passed: int = 0
    failed: int = 0
    errors: int = 0
    skipped: int = 0


@dataclass
class UnitTestRunResult:
    ok: bool
    suite_id: str
    suite_label: str
    duration_ms: int
    summary: Dict[str, int]
    modules: List[Dict[str, Any]] = field(default_factory=list)
    cases: List[Dict[str, Any]] = field(default_factory=list)
    failures: List[Dict[str, Any]] = field(default_factory=list)


class _StructuredTestResult(unittest.TestResult):
    def __init__(self) -> None:
        super().__init__()
        self.cases: List[TestCaseRecord] = []
        self._starts: Dict[str, float] = {}
        self._module_stats: Dict[str, ModuleSummary] = {}

    def _test_id(self, test: unittest.TestCase) -> str:
        return test.id()

    def _module_name(self, test: unittest.TestCase) -> str:
        return test.__class__.__module__

    def _ensure_module(self, module: str) -> ModuleSummary:
        if module not in self._module_stats:
            self._module_stats[module] = ModuleSummary(module=module)
        return self._module_stats[module]

    def startTest(self, test: unittest.TestCase) -> None:
        self._starts[self._test_id(test)] = time.perf_counter()
        super().startTest(test)

    def _duration_ms(self, test: unittest.TestCase) -> int:
        start = self._starts.pop(self._test_id(test), time.perf_counter())
        return max(0, int((time.perf_counter() - start) * 1000))

    def _append_case(
        self,
        test: unittest.TestCase,
        status: str,
        *,
        err: tuple | None = None,
        reason: str = "",
    ) -> None:
        module = self._module_name(test)
        ms = self._ensure_module(module)
        ms.tests_run += 1
        if status == "passed":
            ms.passed += 1
        elif status == "failed":
            ms.failed += 1
        elif status == "error":
            ms.errors += 1
        elif status == "skipped":
            ms.skipped += 1

        message = reason
        tb = ""
        if err is not None:
            message = str(err[1]) if err[1] else message
            tb = "".join(traceback.format_exception(*err))

        method = getattr(test, "_testMethodName", test.id().rsplit(".", 1)[-1])
        self.cases.append(
            TestCaseRecord(
                id=self._test_id(test),
                module=module,
                suite_id=classify_module(module),
                class_name=test.__class__.__name__,
                method=method,
                status=status,
                duration_ms=self._duration_ms(test),
                message=message or "",
                traceback=tb,
            )
        )

    def addSuccess(self, test: unittest.TestCase) -> None:
        super().addSuccess(test)
        self._append_case(test, "passed")

    def addFailure(self, test: unittest.TestCase, err) -> None:
        super().addFailure(test, err)
        self._append_case(test, "failed", err=err)

    def addError(self, test: unittest.TestCase, err) -> None:
        super().addError(test, err)
        self._append_case(test, "error", err=err)

    def addSkip(self, test: unittest.TestCase, reason: str) -> None:
        super().addSkip(test, reason)
        self._append_case(test, "skipped", reason=reason)


def _resolve_run_modules(suite_ids: List[str]) -> tuple[List[str], str, str]:
    if not suite_ids:
        raise ValueError("至少选择一个测试套件")
    if "all" in suite_ids:
        return modules_for_suite("all"), "all", suite_label("all")
    seen: set[str] = set()
    modules: List[str] = []
    for sid in suite_ids:
        for mod in modules_for_suite(sid):
            if mod not in seen:
                seen.add(mod)
                modules.append(mod)
    if not modules:
        # vitest 模块不计入 Python modules 但仍是有效选择
        vitest_all = [
            m for sid in suite_ids if sid in _get_vitest_suite_ids()
            for m in modules_for_suite(sid)
        ]
        if vitest_all:
            modules = vitest_all
        else:
            raise ValueError("所选套件无测试模块")
    ordered_ids = sorted(set(suite_ids))
    label = " + ".join(suite_label(s) for s in ordered_ids)
    return modules, "+".join(ordered_ids), label


def _apply_module_filter(
    modules: List[str],
    include_module_names: FrozenSet[str] | None,
) -> List[str]:
    if include_module_names is None:
        return modules
    filtered = [m for m in modules if m in include_module_names]
    if not filtered:
        raise ValueError("所选测试模块为空")
    return filtered


def _iter_test_cases(suite: unittest.TestSuite):
    for test in suite:
        if isinstance(test, unittest.TestSuite):
            yield from _iter_test_cases(test)
        else:
            yield test


def _module_from_case_id(case_id: str) -> str:
    parts = case_id.rsplit(".", 2)
    if len(parts) != 3:
        raise ValueError(f"invalid test case id: {case_id}")
    return parts[0]


def _load_modules_plan(module_names: List[str]) -> tuple[List[tuple[str, unittest.TestSuite]], List[str], List[str]]:
    loader = unittest.TestLoader()
    loaded: List[tuple[str, unittest.TestSuite]] = []
    load_errors: List[str] = []
    for mod in module_names:
        # vitest 模块跳过（非 Python 无法加载）
        if _is_vitest_module(mod):
            continue
        try:
            loaded.append((mod, loader.loadTestsFromName(mod)))
        except Exception as exc:
            load_errors.append(f"{mod}: {exc}")
    return loaded, load_errors, module_names


def _is_vitest_module(module_name: str) -> bool:
    """判断是否为 vitest 前端测试模块（非 Python unittest）"""
    from phoenix.testing.suite_registry import VITEST_MODULES
    all_vitest: set[str] = set()
    for mods in VITEST_MODULES.values():
        all_vitest.update(mods)
    return module_name in all_vitest


def _get_vitest_suite_ids() -> frozenset[str]:
    from phoenix.testing.suite_registry import VITEST_MODULES
    return frozenset(VITEST_MODULES.keys())


def _fetch_vitest_details(module_names: list[str]) -> dict[str, dict]:
    """通过 Node.js CAA 后端获取 vitest 模块用例详情（count + cases list）"""
    import json as _json
    import urllib.request

    try:
        req = urllib.request.Request(
            "http://127.0.0.1:5180/api/caa/unit-tests/suites",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = _json.loads(resp.read().decode())
    except Exception:
        return {}

    result: dict[str, dict] = {}
    for m in data.get("modules", []):
        name = m.get("file", "")
        count = m.get("count", 0)
        tests = m.get("tests", [])
        cases = [
            {
                "id": f"{name}::{t}",
                "class_name": name.rsplit("/", 1)[-1].replace(".test.ts", ""),
                "method": t,
            }
            for t in tests
        ]
        result[name] = {"count": count, "cases": cases}
    return result


def _load_test_plan(
    suite_ids: List[str],
    include_module_names: FrozenSet[str] | None = None,
) -> tuple[List[tuple[str, unittest.TestSuite]], List[str], List[str], str, str]:
    modules, suite_id, label = _resolve_run_modules(suite_ids)
    modules = _apply_module_filter(modules, include_module_names)
    loaded, load_errors, _ = _load_modules_plan(modules)
    return loaded, load_errors, modules, suite_id, label


def _plan_case_runs(
    loaded: List[tuple[str, unittest.TestSuite]],
    options: UnitTestRunOptions,
) -> tuple[List[tuple[str, unittest.TestCase]], List[Dict[str, Any]]]:
    planned: List[tuple[str, unittest.TestCase]] = []
    ignored: List[Dict[str, Any]] = []
    include = options.include_case_ids

    for mod, suite in loaded:
        for test in _iter_test_cases(suite):
            case_id = test.id()
            if include is not None:
                if case_id not in include:
                    continue
                planned.append((mod, test))
                continue
            if case_id in options.exclude_case_ids:
                method = getattr(test, "_testMethodName", case_id.rsplit(".", 1)[-1])
                ignored.append(
                    {
                        "id": case_id,
                        "module": mod,
                        "suite_id": classify_module(mod),
                        "class_name": test.__class__.__name__,
                        "method": method,
                        "reason": "watchlist",
                    }
                )
                continue
            planned.append((mod, test))
    return planned, ignored


def _resolve_run_context(
    suite_ids: List[str],
    options: UnitTestRunOptions,
) -> tuple[List[tuple[str, unittest.TestSuite]], List[str], List[str], str, str, List[tuple[str, unittest.TestCase]], List[Dict[str, Any]]]:
    if options.include_case_ids:
        modules = sorted({_module_from_case_id(cid) for cid in options.include_case_ids})
        modules = _apply_module_filter(modules, options.include_module_names)
        loaded, load_errors, _ = _load_modules_plan(modules)
        suite_id = "+".join(sorted(set(suite_ids))) if suite_ids else "watchlist"
        label = f"失败关注（{len(options.include_case_ids)}）"
        planned, ignored = _plan_case_runs(loaded, options)
        return loaded, load_errors, modules, suite_id, label, planned, ignored

    loaded, load_errors, modules, suite_id, label = _load_test_plan(
        suite_ids,
        options.include_module_names,
    )
    planned, ignored = _plan_case_runs(loaded, options)
    return loaded, load_errors, modules, suite_id, label, planned, ignored


def _finalize_run_result(
    result: _StructuredTestResult,
    *,
    load_errors: List[str],
    modules: List[str],
    suite_id: str,
    label: str,
    duration_ms: int,
    ignored_cases: List[Dict[str, Any]] | None = None,
    cancelled: bool = False,
) -> UnitTestRunResult:
    summary: Dict[str, int] = {
        "tests_run": result.testsRun,
        "passed": result.testsRun - len(result.failures) - len(result.errors) - len(result.skipped),
        "failed": len(result.failures),
        "errors": len(result.errors),
        "skipped": len(result.skipped),
        "modules": len(modules),
    }
    if cancelled:
        summary["cancelled"] = 1
    if load_errors:
        summary["load_errors"] = len(load_errors)
    ignored = ignored_cases or []
    if ignored:
        summary["ignored"] = len(ignored)

    failures = [asdict(c) for c in result.cases if c.status in ("failed", "error")]
    for err_line in load_errors:
        mod, _, msg = err_line.partition(": ")
        failures.append(
            {
                "id": f"load:{mod}",
                "module": mod,
                "suite_id": classify_module(mod),
                "class_name": "",
                "method": "loadTestsFromName",
                "status": "error",
                "duration_ms": 0,
                "message": msg or err_line,
                "traceback": "",
            }
        )

    ok = not cancelled and not load_errors and not result.failures and not result.errors

    return UnitTestRunResult(
        ok=ok,
        suite_id=suite_id,
        suite_label=label,
        duration_ms=duration_ms,
        summary=summary,
        modules=[asdict(v) for v in result._module_stats.values()],
        cases=[asdict(c) for c in result.cases],
        failures=failures,
    )


def _case_start_event(test: unittest.TestCase) -> Dict[str, Any]:
    method = getattr(test, "_testMethodName", test.id().rsplit(".", 1)[-1])
    module = test.__class__.__module__
    return {
        "type": "case_start",
        "id": test.id(),
        "module": module,
        "suite_id": classify_module(module),
        "class_name": test.__class__.__name__,
        "method": method,
    }


def _run_planned_cases(planned: List[tuple[str, unittest.TestCase]]) -> _StructuredTestResult:
    result = _StructuredTestResult()
    for _, test in planned:
        test.run(result)
    return result


def iter_unit_test_run_events(
    suite_ids: List[str],
    *,
    options: UnitTestRunOptions | None = None,
    cancel_check: Callable[[], bool] | None = None,
):
    """Yield NDJSON-friendly progress dicts while running tests."""
    opts = options or UnitTestRunOptions()
    _, load_errors, modules, suite_id, label, planned, ignored = _resolve_run_context(suite_ids, opts)
    total_cases = len(planned)
    started = time.perf_counter()
    completed = 0
    current_mod = ""
    mod_index = 0
    mod_total = len({mod for mod, _ in planned})

    yield {
        "type": "start",
        "suite_id": suite_id,
        "suite_label": label,
        "total_modules": mod_total,
        "total_cases": total_cases,
        "ignored_cases": len(ignored),
        "modules": modules,
        "load_errors": list(load_errors),
        "ignored": ignored,
    }

    result = _StructuredTestResult()
    seen_modules: Set[str] = set()

    def _emit_cancelled() -> Dict[str, Any]:
        duration_ms = max(0, int((time.perf_counter() - started) * 1000))
        final = _finalize_run_result(
            result,
            load_errors=load_errors,
            modules=modules,
            suite_id=suite_id,
            label=label,
            duration_ms=duration_ms,
            ignored_cases=ignored,
            cancelled=True,
        )
        return {
            "type": "cancelled",
            "result": asdict(final),
            "completed": completed,
            "total": total_cases,
        }

    for mod, test in planned:
        if mod != current_mod:
            current_mod = mod
            if mod not in seen_modules:
                seen_modules.add(mod)
                mod_index += 1
            yield {
                "type": "module_start",
                "module": mod,
                "module_index": mod_index,
                "module_total": mod_total,
                "suite_id": classify_module(mod),
            }
        yield _case_start_event(test)
        test.run(result)
        completed += 1
        yield {
            "type": "case_done",
            "case": asdict(result.cases[-1]),
            "completed": completed,
            "total": total_cases,
        }
        if cancel_check and cancel_check():
            yield _emit_cancelled()
            return

    for mod in sorted(seen_modules):
        if mod in result._module_stats:
            yield {
                "type": "module_done",
                "module": mod,
                "summary": asdict(result._module_stats[mod]),
            }

    duration_ms = max(0, int((time.perf_counter() - started) * 1000))
    final = _finalize_run_result(
        result,
        load_errors=load_errors,
        modules=modules,
        suite_id=suite_id,
        label=label,
        duration_ms=duration_ms,
        ignored_cases=ignored,
    )
    yield {"type": "done", "result": asdict(final)}


def run_unit_test_suites(
    suite_ids: List[str],
    *,
    options: UnitTestRunOptions | None = None,
) -> UnitTestRunResult:
    opts = options or UnitTestRunOptions()
    vitest_ids = _get_vitest_suite_ids()
    is_vitest_only = all(sid in vitest_ids for sid in suite_ids if sid != "all")

    if is_vitest_only and suite_ids:
        # vitest 套件走子进程运行
        from phoenix.testing.vitest_runner import run_vitest_suite
        from dataclasses import asdict
        result_dict = run_vitest_suite("+".join(suite_ids))
        return UnitTestRunResult(**result_dict)

    _, load_errors, modules, suite_id, label, planned, ignored = _resolve_run_context(suite_ids, opts)
    started = time.perf_counter()
    result = _run_planned_cases(planned)
    duration_ms = max(0, int((time.perf_counter() - started) * 1000))
    return _finalize_run_result(
        result,
        load_errors=load_errors,
        modules=modules,
        suite_id=suite_id,
        label=label,
        duration_ms=duration_ms,
        ignored_cases=ignored,
    )


def plan_unit_test_run(
    suite_ids: List[str],
    *,
    options: UnitTestRunOptions | None = None,
    include_cases: bool = False,
) -> dict[str, Any]:
    """Preview which modules / cases would run (no execution)."""
    opts = options or UnitTestRunOptions()
    _, load_errors, modules, suite_id, label, planned, ignored = _resolve_run_context(suite_ids, opts)
    by_mod: Dict[str, List[Dict[str, Any]]] = {}
    for mod, test in planned:
        method = getattr(test, "_testMethodName", test.id().rsplit(".", 1)[-1])
        by_mod.setdefault(mod, []).append(
            {
                "id": test.id(),
                "class_name": test.__class__.__name__,
                "method": method,
            }
        )
    module_rows = []
    for mod in sorted(by_mod.keys()):
        cases = by_mod[mod]
        row: Dict[str, Any] = {
            "module": mod,
            "suite_id": classify_module(mod),
            "case_count": len(cases),
        }
        if include_cases:
            row["cases"] = cases
        module_rows.append(row)

    # 补充 vitest 模块（通过 Node 后端获取实际用例数）
    vitest_mods = [m for m in modules if _is_vitest_module(m)]
    vitest_details = _fetch_vitest_details(vitest_mods) if vitest_mods else {}
    for mod in vitest_mods:
        detail = vitest_details.get(mod, {})
        cases_list = detail.get("cases", [])
        count = len(cases_list) if cases_list else detail.get("count", 0)
        row: Dict[str, Any] = {
            "module": mod,
            "suite_id": classify_module(mod),
            "case_count": count,
            "backend": "vitest",
        }
        if include_cases and cases_list:
            row["cases"] = cases_list
        module_rows.append(row)

    return {
        "suite_id": suite_id,
        "suite_label": label,
        "total_modules": len(module_rows),
        "total_cases": len(planned),
        "ignored_cases": len(ignored),
        "load_errors": list(load_errors),
        "modules": module_rows,
    }


def run_unit_test_suite(suite_id: str) -> UnitTestRunResult:
    """Run a single suite id (``all`` / ``code`` / …)."""
    return run_unit_test_suites([suite_id])


def suites_payload() -> dict:
    import sqlite3
    import json as _json

    # 先同步 Python 模块到共享 DB
    from phoenix.testing.suite_registry import sync_python_modules_to_db
    try:
        sync_python_modules_to_db()
    except Exception:
        pass

    # 从共享 DB 读取（含 Python + vitest）
    db_path = str(repo_root() / "tests" / "fixtures" / "caa" / "test-catalog.db")
    modules_by_backend: dict[str, list[str]] = {}
    try:
        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT backend, module FROM test_modules ORDER BY backend, module").fetchall()
        for backend, module in rows:
            modules_by_backend.setdefault(backend, []).append(module)
        conn.close()
    except Exception:
        pass

    # 合并：python 套件从 registry + DB，vitest 套件从 DB
    py_suites = list_suites()
    result_suites = []
    for s in py_suites:
        if s.backend == "vitest":
            # vitest 模块从共享 DB 读取（Node 启动时扫描）
            mods = modules_by_backend.get("vitest", [])
        else:
            # python 套件用 registry 分类好的模块列表
            mods = list(s.modules)
        result_suites.append({
            "id": s.id,
            "label": s.label,
            "description": s.description,
            "module_count": len(mods),
            "modules": mods,
            "backend": s.backend,
        })
    return {"suites": result_suites}


def run_payload(
    suite_id: str | None = None,
    suite_ids: List[str] | None = None,
    *,
    exclude_case_ids: List[str] | None = None,
    include_case_ids: List[str] | None = None,
    include_module_names: List[str] | None = None,
) -> dict:
    valid = {s.id for s in list_suites()}
    ids = list(suite_ids or [])
    if suite_id and suite_id not in ids:
        ids = [suite_id, *ids]
    if not ids:
        ids = ["all"]
    for sid in ids:
        if sid not in valid:
            raise ValueError(f"unknown suite: {sid}")
    options = UnitTestRunOptions(
        exclude_case_ids=frozenset(exclude_case_ids or []),
        include_case_ids=frozenset(include_case_ids) if include_case_ids else None,
        include_module_names=frozenset(include_module_names) if include_module_names else None,
    )
    return asdict(run_unit_test_suites(ids, options=options))
