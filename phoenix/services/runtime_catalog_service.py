#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Web API for runtime catalog SQLite."""

from __future__ import annotations

from phoenix.runtime.catalog_store import catalog_status_payload, get_test_case_map, get_test_module_map, search_catalog
from phoenix.runtime.catalog_sync import sync_runtime_catalog


def get_runtime_catalog_status() -> dict:
    return catalog_status_payload()


def sync_runtime_catalog_now(*, force: bool = False) -> dict:
    return sync_runtime_catalog(force=force)


def search_runtime_catalog(
    *,
    q: str = "",
    suite_id: str | None = None,
    entity_type: str | None = None,
    limit: int = 40,
    offset: int = 0,
) -> dict:
    return search_catalog(
        q=q,
        suite_id=suite_id,
        entity_type=entity_type,
        limit=limit,
        offset=offset,
    )


def get_test_module_catalog(module_names: list[str] | None = None) -> dict:
    modules = get_test_module_map(module_names)
    return {"modules": modules}


def get_test_case_catalog(full_ids: list[str] | None = None) -> dict:
    cases = get_test_case_map(full_ids)
    return {"cases": cases}
