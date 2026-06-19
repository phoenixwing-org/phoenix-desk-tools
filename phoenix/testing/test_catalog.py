#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Optional overrides for unittest module titles/descriptions (``tests/test_catalog.json``)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from phoenix.testing.suite_registry import tests_dir

CATALOG_JSON_NAME = "test_catalog.json"


def catalog_json_path() -> Path:
    return tests_dir() / CATALOG_JSON_NAME


def load_test_catalog_overrides() -> dict[str, dict[str, str]]:
    """Return ``file_stem`` → {title?, description_zh?} from JSON; missing file → {}."""
    path = catalog_json_path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    modules = raw.get("modules") if isinstance(raw, dict) else None
    if not isinstance(modules, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for stem, entry in modules.items():
        if not isinstance(stem, str) or not isinstance(entry, dict):
            continue
        row: dict[str, str] = {}
        for key in ("title", "description_zh", "doc_path"):
            val = entry.get(key)
            if isinstance(val, str) and val.strip():
                row[key] = val.strip()
        if row:
            out[stem] = row
    return out


def merge_module_meta(
    *,
    file_stem: str,
    module_doc: str,
    override: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Build title + description_zh from catalog override and/or module docstring."""
    doc = (module_doc or "").strip()
    doc_lines = [ln.strip() for ln in doc.splitlines() if ln.strip()]
    title = doc_lines[0] if doc_lines else file_stem
    description_zh = doc if len(doc_lines) <= 1 else "\n".join(doc_lines)

    ov = override or {}
    title = ov.get("title") or title
    description_zh = ov.get("description_zh") or description_zh
    doc_path = ov.get("doc_path")
    return {
        "title": title,
        "description_zh": description_zh,
        "doc_path": doc_path,
    }
