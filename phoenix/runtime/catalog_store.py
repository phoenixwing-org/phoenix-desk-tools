#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Runtime catalog SQLite path, connect, search."""

from __future__ import annotations

import re
import sqlite3
from pathlib import Path
from typing import Any, List, Optional

from phoenix.runtime.catalog_schema import CATALOG_DDL, SCHEMA_VERSION
from phoenix.testing.suite_registry import repo_root

CATALOG_FILENAME = "runtime-catalog.sqlite"


def catalog_db_path() -> Path:
    root = repo_root() / ".phoenix"
    root.mkdir(parents=True, exist_ok=True)
    return root / CATALOG_FILENAME


def connect_catalog(*, readonly: bool = False) -> sqlite3.Connection:
    path = catalog_db_path()
    if readonly:
        uri = f"file:{path}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
    else:
        conn = sqlite3.connect(str(path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    try:
        row = conn.execute(
            "SELECT value FROM catalog_meta WHERE key = 'schema_version'"
        ).fetchone()
        stored = int(row["value"]) if row else 0
    except sqlite3.OperationalError:
        row = None
        stored = 0
    if stored < SCHEMA_VERSION:
        conn.execute("DROP TABLE IF EXISTS catalog_fts")
    conn.executescript(CATALOG_DDL)
    if row is None:
        conn.execute(
            "INSERT INTO catalog_meta(key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
    conn.commit()


def _fts_escape(q: str) -> str:
    """Turn user input into a safe FTS prefix query."""
    tokens = re.findall(r"[\w\u4e00-\u9fff.-]+", q.strip(), flags=re.UNICODE)
    if not tokens:
        return ""
    return " OR ".join(f'"{t}"*' for t in tokens)


def search_catalog(
    *,
    q: str = "",
    suite_id: str | None = None,
    entity_type: str | None = None,
    limit: int = 40,
    offset: int = 0,
) -> dict[str, Any]:
    """Search pages / test modules / test cases in catalog DB."""
    path = catalog_db_path()
    if not path.is_file():
        return {"items": [], "total": 0, "q": q}

    conn = connect_catalog(readonly=True)
    try:
        items: List[dict[str, Any]] = []
        total = 0
        fts_q = _fts_escape(q)

        if fts_q:
            where = ["catalog_fts MATCH ?"]
            params: List[Any] = [fts_q]
            if suite_id:
                where.append("suite_id = ?")
                params.append(suite_id)
            if entity_type:
                where.append("entity_type = ?")
                params.append(entity_type)
            sql_where = " AND ".join(where)
            total = conn.execute(
                f"SELECT COUNT(*) FROM catalog_fts WHERE {sql_where}",
                params,
            ).fetchone()[0]
            rows = conn.execute(
                f"""
                SELECT entity_type, entity_id, suite_id, module_name, title, body
                FROM catalog_fts
                WHERE {sql_where}
                ORDER BY bm25(catalog_fts)
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
            for r in rows:
                items.append(_row_to_item({**dict(r), "module": r["module_name"]}))
        else:
            items, total = _list_without_query(
                conn, suite_id=suite_id, entity_type=entity_type, limit=limit, offset=offset
            )

        return {"items": items, "total": total, "q": q, "limit": limit, "offset": offset}
    finally:
        conn.close()


def _list_without_query(
    conn: sqlite3.Connection,
    *,
    suite_id: str | None,
    entity_type: str | None,
    limit: int,
    offset: int,
) -> tuple[List[dict[str, Any]], int]:
    buckets: List[dict[str, Any]] = []
    types = [entity_type] if entity_type else ["page", "test_module", "test_case"]

    if "page" in types:
        sql = "SELECT nav_id, page_id, label, description, module FROM app_page"
        params: List[Any] = []
        if suite_id:
            sql += " WHERE module = ? OR module IS NULL"
            params.append(suite_id)
        sql += " ORDER BY sort_order, label"
        for r in conn.execute(sql, params):
            buckets.append(
                {
                    "entity_type": "page",
                    "entity_id": r["nav_id"],
                    "suite_id": r["module"] or "",
                    "module": r["module"] or "",
                    "title": r["label"],
                    "body": r["description"] or r["page_id"],
                    "page_id": r["page_id"],
                }
            )

    if "test_module" in types:
        sql = "SELECT module_name, suite_id, title, description_zh, file_stem, case_count FROM test_module"
        params = []
        if suite_id:
            sql += " WHERE suite_id = ?"
            params.append(suite_id)
        sql += " ORDER BY module_name"
        for r in conn.execute(sql, params):
            buckets.append(
                {
                    "entity_type": "test_module",
                    "entity_id": r["module_name"],
                    "suite_id": r["suite_id"],
                    "module": r["module_name"],
                    "title": r["title"] or r["file_stem"],
                    "body": r["description_zh"] or r["module_name"],
                    "case_count": r["case_count"],
                }
            )

    if "test_case" in types:
        sql = """
            SELECT full_id, case_key, module_name, class_name, method_name,
                   suite_id, title, description_zh
            FROM test_case
        """
        params = []
        if suite_id:
            sql += " WHERE suite_id = ?"
            params.append(suite_id)
        sql += " ORDER BY module_name, class_name, method_name"
        for r in conn.execute(sql, params):
            buckets.append(
                {
                    "entity_type": "test_case",
                    "entity_id": r["full_id"],
                    "suite_id": r["suite_id"],
                    "module": r["module_name"],
                    "title": r["title"] or f"{r['class_name']}.{r['method_name']}",
                    "body": r["description_zh"] or r["full_id"],
                    "case_key": r["case_key"],
                    "class_name": r["class_name"],
                    "method_name": r["method_name"],
                }
            )

    total = len(buckets)
    page = buckets[offset : offset + limit]
    return [_row_to_item(b) for b in page], total


def _row_to_item(row: dict[str, Any]) -> dict[str, Any]:
    et = row["entity_type"]
    item = {
        "entity_type": et,
        "entity_id": row["entity_id"],
        "suite_id": row.get("suite_id") or "",
        "title": row.get("title") or "",
        "subtitle": row.get("body") or "",
        "module": row.get("module") or "",
    }
    if et == "page":
        item["page_id"] = row.get("page_id")
    if et == "test_module":
        item["case_count"] = row.get("case_count", 0)
    if et == "test_case":
        item["case_key"] = row.get("case_key")
        item["class_name"] = row.get("class_name")
        item["method_name"] = row.get("method_name")
    return item


def get_test_module_map(module_names: list[str] | None = None) -> dict[str, dict[str, Any]]:
    """Return ``module_name`` → catalog row for unit test modules."""
    path = catalog_db_path()
    if not path.is_file():
        return {}

    conn = connect_catalog(readonly=True)
    try:
        if module_names:
            names = sorted({n for n in module_names if n})
            if not names:
                return {}
            placeholders = ",".join("?" for _ in names)
            rows = conn.execute(
                f"""
                SELECT module_name, file_stem, suite_id, title, description_zh, doc_path, case_count
                FROM test_module
                WHERE module_name IN ({placeholders})
                ORDER BY module_name
                """,
                names,
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT module_name, file_stem, suite_id, title, description_zh, doc_path, case_count
                FROM test_module
                ORDER BY module_name
                """
            ).fetchall()
        return {r["module_name"]: dict(r) for r in rows}
    finally:
        conn.close()


def get_test_case_map(full_ids: list[str] | None = None) -> dict[str, dict[str, Any]]:
    """Return ``full_id`` → catalog row for unittest cases."""
    path = catalog_db_path()
    if not path.is_file():
        return {}

    conn = connect_catalog(readonly=True)
    try:
        if full_ids:
            ids = sorted({i for i in full_ids if i})
            if not ids:
                return {}
            placeholders = ",".join("?" for _ in ids)
            rows = conn.execute(
                f"""
                SELECT full_id, case_key, module_name, class_name, method_name,
                       suite_id, title, description_zh, docstring
                FROM test_case
                WHERE full_id IN ({placeholders})
                ORDER BY full_id
                """,
                ids,
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT full_id, case_key, module_name, class_name, method_name,
                       suite_id, title, description_zh, docstring
                FROM test_case
                ORDER BY full_id
                """
            ).fetchall()
        return {r["full_id"]: dict(r) for r in rows}
    finally:
        conn.close()


def catalog_status_payload() -> dict[str, Any]:
    path = catalog_db_path()
    if not path.is_file():
        return {
            "ok": False,
            "database_path": str(path),
            "exists": False,
            "last_sync_at": None,
            "counts": {},
        }
    conn = connect_catalog(readonly=True)
    try:
        meta = {
            r["key"]: r["value"]
            for r in conn.execute("SELECT key, value FROM catalog_meta")
        }
        counts = {
            "pages": conn.execute("SELECT COUNT(*) FROM app_page").fetchone()[0],
            "test_modules": conn.execute("SELECT COUNT(*) FROM test_module").fetchone()[0],
            "test_cases": conn.execute("SELECT COUNT(*) FROM test_case").fetchone()[0],
            "suites": conn.execute("SELECT COUNT(*) FROM test_suite").fetchone()[0],
        }
        return {
            "ok": True,
            "database_path": str(path),
            "exists": True,
            "last_sync_at": meta.get("last_sync_at"),
            "schema_version": int(meta.get("schema_version", "0")),
            "counts": counts,
        }
    finally:
        conn.close()
