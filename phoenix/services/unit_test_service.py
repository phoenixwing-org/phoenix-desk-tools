#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Web API helpers for in-process unit tests."""

from __future__ import annotations

from phoenix.testing.runner import (
    UnitTestRunOptions,
    iter_unit_test_run_events,
    plan_unit_test_run,
    run_payload,
    suites_payload,
)


def list_unit_test_suites() -> dict:
    return suites_payload()


def plan_unit_tests(
    suites: list[str] | None = None,
    *,
    exclude_case_ids: list[str] | None = None,
    include_case_ids: list[str] | None = None,
    include_module_names: list[str] | None = None,
    include_cases: bool = False,
) -> dict:
    from phoenix.testing.suite_registry import list_suites

    valid = {s.id for s in list_suites()}
    ids = list(suites or [])
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
    return plan_unit_test_run(ids, options=options, include_cases=include_cases)


def run_unit_tests(
    suite: str | None = None,
    suites: list[str] | None = None,
    *,
    exclude_case_ids: list[str] | None = None,
    include_case_ids: list[str] | None = None,
    include_module_names: list[str] | None = None,
) -> dict:
    if suites is not None:
        return run_payload(
            suite_ids=suites,
            exclude_case_ids=exclude_case_ids,
            include_case_ids=include_case_ids,
            include_module_names=include_module_names,
        )
    return run_payload(
        suite_id=suite or "all",
        exclude_case_ids=exclude_case_ids,
        include_case_ids=include_case_ids,
        include_module_names=include_module_names,
    )


def iter_run_unit_tests_events(
    suite: str | None = None,
    suites: list[str] | None = None,
    *,
    exclude_case_ids: list[str] | None = None,
    include_case_ids: list[str] | None = None,
    include_module_names: list[str] | None = None,
    cancel_check=None,
):
    from phoenix.testing.suite_registry import list_suites

    valid = {s.id for s in list_suites()}
    ids = list(suites or [])
    if suite and suite not in ids:
        ids = [suite, *ids]
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
    yield from iter_unit_test_run_events(ids, options=options, cancel_check=cancel_check)


def cancel_unit_test_run(run_id: str) -> bool:
    from phoenix.testing.run_cancel import request_cancel

    return request_cancel(run_id.strip())
