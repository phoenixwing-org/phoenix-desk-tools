#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Run unittest modules and return structured JSON for Web UI."""

from __future__ import annotations

import time
import traceback
import unittest
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, FrozenSet, Iterable, List, Optional, Set

from phoenix.testing.suite_registry import (
    classify_module,
    list_suites,
    modules_for_suite,
    suite_label,
)


@dataclass(frozen=True)
class UnitTestRunOptions:
    exclude_case_ids: FrozenSet[str] = frozenset()
    include_case_ids: FrozenSet[str] | None = None


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
        raise ValueError("所选套件无测试模块")
    ordered_ids = sorted(set(suite_ids))
    label = " + ".join(suite_label(s) for s in ordered_ids)
    return modules, "+".join(ordered_ids), label


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
        try:
            loaded.append((mod, loader.loadTestsFromName(mod)))
        except Exception as exc:
            load_errors.append(f"{mod}: {exc}")
    return loaded, load_errors, module_names


def _load_test_plan(suite_ids: List[str]) -> tuple[List[tuple[str, unittest.TestSuite]], List[str], List[str], str, str]:
    modules, suite_id, label = _resolve_run_modules(suite_ids)
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
        loaded, load_errors, _ = _load_modules_plan(modules)
        suite_id = "+".join(sorted(set(suite_ids))) if suite_ids else "watchlist"
        label = f"失败关注（{len(options.include_case_ids)}）"
        planned, ignored = _plan_case_runs(loaded, options)
        return loaded, load_errors, modules, suite_id, label, planned, ignored

    loaded, load_errors, modules, suite_id, label = _load_test_plan(suite_ids)
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
    return {
        "suites": [
            {
                "id": s.id,
                "label": s.label,
                "description": s.description,
                "module_count": s.module_count,
                "modules": list(s.modules),
            }
            for s in list_suites()
        ]
    }


def run_payload(
    suite_id: str | None = None,
    suite_ids: List[str] | None = None,
    *,
    exclude_case_ids: List[str] | None = None,
    include_case_ids: List[str] | None = None,
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
    )
    return asdict(run_unit_test_suites(ids, options=options))
