#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Web API helpers for in-process unit tests."""

from __future__ import annotations

from phoenix.testing.runner import UnitTestRunOptions, iter_unit_test_run_events, run_payload, suites_payload


def list_unit_test_suites() -> dict:
    return suites_payload()


def run_unit_tests(
    suite: str | None = None,
    suites: list[str] | None = None,
    *,
    exclude_case_ids: list[str] | None = None,
    include_case_ids: list[str] | None = None,
) -> dict:
    if suites is not None:
        return run_payload(
            suite_ids=suites,
            exclude_case_ids=exclude_case_ids,
            include_case_ids=include_case_ids,
        )
    return run_payload(
        suite_id=suite or "all",
        exclude_case_ids=exclude_case_ids,
        include_case_ids=include_case_ids,
    )


def iter_run_unit_tests_events(
    suite: str | None = None,
    suites: list[str] | None = None,
    *,
    exclude_case_ids: list[str] | None = None,
    include_case_ids: list[str] | None = None,
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
    )
    yield from iter_unit_test_run_events(ids, options=options, cancel_check=cancel_check)
