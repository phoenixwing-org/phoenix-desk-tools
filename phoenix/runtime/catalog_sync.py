#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Discover repo pages + unittest entries and sync into runtime-catalog.sqlite."""

from __future__ import annotations

import ast
import re
import unittest
from datetime import datetime, timezone
from typing import Any, Iterable, List, Tuple

from phoenix.config.loader import load_app_config
from phoenix.runtime.catalog_schema import SCHEMA_VERSION
from phoenix.runtime.catalog_store import catalog_db_path, connect_catalog, ensure_schema
from phoenix.testing.suite_registry import (
    SUITE_META,
    classify_module,
    discover_test_module_names,
    tests_dir,
)
from phoenix.testing.test_catalog import load_test_catalog_overrides, merge_module_meta

CASE_ID_RE = re.compile(r"case_id\s*=\s*([\w-]+)")


def _iter_tests(suite: unittest.TestSuite) -> Iterable[unittest.TestCase]:
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from _iter_tests(item)
        else:
            yield item


def _parse_test_doc(doc: str | None) -> tuple[str, str, str | None]:
    """Return (title, description_zh, case_key)."""
    if not doc:
        return "", "", None
    lines = [ln.strip() for ln in doc.strip().splitlines() if ln.strip()]
    title = lines[0] if lines else ""
    case_key = None
    rest: List[str] = []
    for ln in lines[1:]:
        m = CASE_ID_RE.search(ln)
        if m:
            case_key = m.group(1)
        else:
            rest.append(ln)
    return title, " ".join(rest), case_key


def _read_module_docstring(file_stem: str) -> str:
    path = tests_dir() / f"{file_stem}.py"
    if not path.is_file():
        return ""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, SyntaxError):
        return ""
    return ast.get_docstring(tree) or ""


def _discover_test_cases() -> tuple[List[dict[str, Any]], List[dict[str, Any]]]:
    loader = unittest.TestLoader()
    modules_out: List[dict[str, Any]] = []
    cases_out: List[dict[str, Any]] = []
    overrides = load_test_catalog_overrides()

    for module_name in discover_test_module_names():
        file_stem = module_name.rsplit(".", 1)[-1]
        suite_id = classify_module(module_name)
        meta = merge_module_meta(
            file_stem=file_stem,
            module_doc=_read_module_docstring(file_stem),
            override=overrides.get(file_stem),
        )
        case_count = 0
        try:
            suite = loader.loadTestsFromName(module_name)
        except Exception:
            modules_out.append(
                {
                    "module_name": module_name,
                    "file_stem": file_stem,
                    "suite_id": suite_id,
                    "title": meta["title"],
                    "description_zh": meta["description_zh"],
                    "doc_path": meta.get("doc_path"),
                    "case_count": 0,
                }
            )
            continue

        for test in _iter_tests(suite):
            case_count += 1
            method = getattr(test, "_testMethodName", "")
            class_name = test.__class__.__name__
            full_id = test.id()
            title, desc, case_key = _parse_test_doc(test.__doc__)
            if not title:
                title = f"{class_name}.{method}"
            cases_out.append(
                {
                    "full_id": full_id,
                    "case_key": case_key,
                    "module_name": module_name,
                    "class_name": class_name,
                    "method_name": method,
                    "suite_id": suite_id,
                    "title": title,
                    "description_zh": desc,
                    "docstring": (test.__doc__ or "").strip(),
                }
            )

        modules_out.append(
            {
                "module_name": module_name,
                "file_stem": file_stem,
                "suite_id": suite_id,
                "title": meta["title"],
                "description_zh": meta["description_zh"],
                "doc_path": meta.get("doc_path"),
                "case_count": case_count,
            }
        )

    return modules_out, cases_out


def _discover_app_pages() -> List[dict[str, Any]]:
    cfg = load_app_config()
    pages: List[dict[str, Any]] = []
    for idx, item in enumerate(cfg.get("navigation") or []):
        if not isinstance(item, dict):
            continue
        nav_id = str(item.get("id") or item.get("page") or "")
        page_id = str(item.get("page") or nav_id)
        if not nav_id:
            continue
        pages.append(
            {
                "nav_id": nav_id,
                "page_id": page_id,
                "label": str(item.get("label") or page_id),
                "description": str(item.get("description") or ""),
                "module": item.get("module"),
                "sort_order": idx,
            }
        )
    return pages


def sync_runtime_catalog(*, force: bool = False) -> dict[str, Any]:
    """Full sync: suites, app pages, test modules/cases, FTS index."""
    conn = connect_catalog()
    try:
        ensure_schema(conn)
        now = datetime.now(timezone.utc).isoformat()

        suites = [
            (sid, label, desc, idx)
            for idx, (sid, (label, desc, _)) in enumerate(SUITE_META.items())
        ]
        conn.executemany(
            """
            INSERT INTO test_suite(id, label, description, sort_order)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              label = excluded.label,
              description = excluded.description,
              sort_order = excluded.sort_order
            """,
            suites,
        )

        pages = _discover_app_pages()
        page_ids = {p["nav_id"] for p in pages}
        conn.executemany(
            """
            INSERT INTO app_page(nav_id, page_id, label, description, module, sort_order)
            VALUES (:nav_id, :page_id, :label, :description, :module, :sort_order)
            ON CONFLICT(nav_id) DO UPDATE SET
              page_id = excluded.page_id,
              label = excluded.label,
              description = excluded.description,
              module = excluded.module,
              sort_order = excluded.sort_order
            """,
            pages,
        )
        if page_ids:
            placeholders = ",".join("?" for _ in page_ids)
            conn.execute(
                f"DELETE FROM app_page WHERE nav_id NOT IN ({placeholders})",
                list(page_ids),
            )
        else:
            conn.execute("DELETE FROM app_page")

        modules, cases = _discover_test_cases()
        module_names = {m["module_name"] for m in modules}
        case_ids = {c["full_id"] for c in cases}

        conn.executemany(
            """
            INSERT INTO test_module(
              module_name, file_stem, suite_id, title, description_zh, doc_path, case_count
            ) VALUES (
              :module_name, :file_stem, :suite_id, :title, :description_zh, :doc_path, :case_count
            )
            ON CONFLICT(module_name) DO UPDATE SET
              file_stem = excluded.file_stem,
              suite_id = excluded.suite_id,
              title = excluded.title,
              description_zh = excluded.description_zh,
              doc_path = excluded.doc_path,
              case_count = excluded.case_count
            """,
            modules,
        )
        if module_names:
            placeholders = ",".join("?" for _ in module_names)
            conn.execute(
                f"DELETE FROM test_module WHERE module_name NOT IN ({placeholders})",
                list(module_names),
            )
        else:
            conn.execute("DELETE FROM test_module")

        conn.executemany(
            """
            INSERT INTO test_case(
              full_id, case_key, module_name, class_name, method_name,
              suite_id, title, description_zh, docstring
            ) VALUES (
              :full_id, :case_key, :module_name, :class_name, :method_name,
              :suite_id, :title, :description_zh, :docstring
            )
            ON CONFLICT(full_id) DO UPDATE SET
              case_key = excluded.case_key,
              module_name = excluded.module_name,
              class_name = excluded.class_name,
              method_name = excluded.method_name,
              suite_id = excluded.suite_id,
              title = excluded.title,
              description_zh = excluded.description_zh,
              docstring = excluded.docstring
            """,
            cases,
        )
        if case_ids:
            placeholders = ",".join("?" for _ in case_ids)
            conn.execute(
                f"DELETE FROM test_case WHERE full_id NOT IN ({placeholders})",
                list(case_ids),
            )
        else:
            conn.execute("DELETE FROM test_case")

        conn.execute("DELETE FROM catalog_fts")
        fts_rows: List[Tuple[str, str, str, str, str, str]] = []
        for p in pages:
            fts_rows.append(
                (
                    "page",
                    p["nav_id"],
                    p["module"] or "",
                    p["module"] or "",
                    p["label"],
                    f"{p['description']} {p['page_id']} {p['nav_id']}",
                )
            )
        for m in modules:
            fts_rows.append(
                (
                    "test_module",
                    m["module_name"],
                    m["suite_id"],
                    m["module_name"],
                    m["title"],
                    f"{m['description_zh']} {m['file_stem']} {m['module_name']}",
                )
            )
        for c in cases:
            fts_rows.append(
                (
                    "test_case",
                    c["full_id"],
                    c["suite_id"],
                    c["module_name"],
                    c["title"],
                    f"{c['description_zh']} {c['case_key'] or ''} {c['class_name']} {c['method_name']} {c['full_id']}",
                )
            )
        conn.executemany(
            """
            INSERT INTO catalog_fts(entity_type, entity_id, suite_id, module_name, title, body)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            fts_rows,
        )

        conn.execute(
            """
            INSERT INTO catalog_meta(key, value) VALUES ('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (str(SCHEMA_VERSION),),
        )
        conn.execute(
            """
            INSERT INTO catalog_meta(key, value) VALUES ('last_sync_at', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (now,),
        )
        conn.commit()

        return {
            "ok": True,
            "forced": force,
            "last_sync_at": now,
            "database_path": str(catalog_db_path()),
            "added_or_updated": {
                "pages": len(pages),
                "test_modules": len(modules),
                "test_cases": len(cases),
            },
        }
    finally:
        conn.close()
