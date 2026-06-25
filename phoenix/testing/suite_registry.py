#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Map ``tests/test_*.py`` modules to suite tags (code / cad / platform)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

TESTS_DIR_NAME = "tests"
TEST_MODULE_PREFIX = "tests."

# Longest-prefix wins when a module matches multiple prefixes.
SUITE_PREFIXES: Dict[str, Tuple[str, ...]] = {
    "code": (
        "test_code_",
        "test_reorder_",
        "test_text_encoding",
    ),
    "cad": (
        "test_fcstd_",
        "test_bom_",
        "test_part_",
        "test_batch_step_",
        "test_xlink_",
        "test_cad_",
        "test_rename_ref_fix",
        "test_solidworks_",
    ),
}

SUITE_META: Dict[str, Tuple[str, str, str]] = {
    "all": ("全部", "仓库内所有 unittest 模块", "python"),
    "code": ("Code 模块", "索引、成员排序、批量改名、UUID、忽略规则等", "python"),
    "cad": ("CAD 模块", "FCStd/BOM/零件库/STEP/SolidWorks/XLink 等", "python"),
    "platform": ("平台", "Web 壳层、偏好、导航、 onboarding 等", "python"),
    "caa": ("CAA 模块", "对话框编辑器：解析/emit/拖放/NLS/保存（vitest）", "vitest"),
}

# vitest 套件模块列表
VITEST_MODULES: Dict[str, Tuple[str, ...]] = {
    "caa": (
        "packages/catdlg-core",
        "web-ui/src/utils/caaDialogTree.test.ts",
        "web-ui/src/utils/caaDropZone.test.ts",
        "web-ui/src/utils/caaDialogRelatedFiles.test.ts",
        "web-ui/src/utils/createBlankCaaDialogIr.test.ts",
        "web-ui/src/components/caa/controls/useCaaContainerResize.test.ts",
    ),
}


@dataclass(frozen=True)
class TestSuiteInfo:
    id: str
    label: str
    description: str
    module_count: int
    modules: Tuple[str, ...]
    backend: str = "python"  # "python" | "vitest"


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def tests_dir() -> Path:
    return repo_root() / TESTS_DIR_NAME


def _stem_to_module(stem: str) -> str:
    return f"{TEST_MODULE_PREFIX}{stem}"


def discover_test_module_names() -> List[str]:
    td = tests_dir()
    if not td.is_dir():
        return []
    names = sorted(
        _stem_to_module(p.stem)
        for p in td.glob("test_*.py")
        if p.is_file() and not p.name.startswith("__")
    )
    return names


def classify_module(module_name: str) -> str:
    # vitest 模块：从 VITEST_MODULES 反查
    for suite_id, mods in VITEST_MODULES.items():
        if module_name in mods:
            return suite_id
    stem = module_name.rsplit(".", 1)[-1]
    for suite_id, prefixes in SUITE_PREFIXES.items():
        if any(stem.startswith(prefix) for prefix in prefixes):
            return suite_id
    return "platform"


def modules_for_suite(suite_id: str) -> List[str]:
    if suite_id in VITEST_MODULES:
        return list(VITEST_MODULES[suite_id])
    all_modules = discover_test_module_names()
    if suite_id == "all":
        return all_modules + [m for vmods in VITEST_MODULES.values() for m in vmods]
    return [m for m in all_modules if classify_module(m) == suite_id]


def sync_python_modules_to_db() -> None:
    """把 Python unittest 模块写入共享 SQLite（供 Node 和前端读取）。"""
    import sqlite3
    import json as _json
    from importlib import import_module

    db_path = repo_root() / "tests" / "fixtures" / "caa" / "test-catalog.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS test_modules (
        backend   TEXT NOT NULL,
        module    TEXT NOT NULL,
        case_count INTEGER NOT NULL DEFAULT 0,
        cases_json TEXT DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (backend, module)
    )""")

    # 清旧 python 条目
    conn.execute("DELETE FROM test_modules WHERE backend = 'python'")

    modules = discover_test_module_names()
    for mod_name in modules:
        try:
            mod = import_module(mod_name)
            loader = __import__("unittest").TestLoader()
            suite = loader.loadTestsFromModule(mod)
            count = suite.countTestCases()
            cases = []
            for test in suite:
                if isinstance(test, __import__("unittest").TestSuite):
                    for t in test:
                        cases.append(str(t.id()))
                else:
                    cases.append(str(test.id()))
        except Exception:
            count = 0
            cases = []

        conn.execute(
            "INSERT INTO test_modules (backend, module, case_count, cases_json, updated_at) VALUES ('python', ?, ?, ?, datetime('now'))",
            (mod_name, count, _json.dumps(cases)),
        )
    conn.commit()
    conn.close()


def list_suites() -> List[TestSuiteInfo]:
    all_modules = discover_test_module_names()
    by_suite: Dict[str, List[str]] = {k: [] for k in SUITE_META if k != "all"}
    for mod in all_modules:
        suite = classify_module(mod)
        if suite in by_suite:
            by_suite[suite].append(mod)

    out: List[TestSuiteInfo] = []
    for suite_id, (label, desc, backend) in SUITE_META.items():
        if backend == "vitest":
            mods = list(VITEST_MODULES.get(suite_id, ()))
        elif suite_id == "all":
            mods = all_modules + [
                m for vmods in VITEST_MODULES.values() for m in vmods
            ]
        else:
            mods = by_suite.get(suite_id, [])
        out.append(
            TestSuiteInfo(
                id=suite_id,
                label=label,
                description=desc,
                module_count=len(mods),
                modules=tuple(mods),
                backend=backend,
            )
        )
    return out


def suite_label(suite_id: str) -> str:
    return SUITE_META.get(suite_id, (suite_id, "", "python"))[0]


def suite_backend(suite_id: str) -> str:
    return SUITE_META.get(suite_id, (suite_id, "", "python"))[2]
