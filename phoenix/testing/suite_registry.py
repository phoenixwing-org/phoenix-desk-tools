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

SUITE_META: Dict[str, Tuple[str, str]] = {
    "all": ("全部", "仓库内所有 unittest 模块"),
    "code": ("Code 模块", "索引、成员排序、批量改名、UUID、忽略规则等"),
    "cad": ("CAD 模块", "FCStd/BOM/零件库/STEP/SolidWorks/XLink 等"),
    "platform": ("平台", "Web 壳层、偏好、导航、 onboarding 等"),
}


@dataclass(frozen=True)
class TestSuiteInfo:
    id: str
    label: str
    description: str
    module_count: int
    modules: Tuple[str, ...]


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
    stem = module_name.rsplit(".", 1)[-1]
    for suite_id, prefixes in SUITE_PREFIXES.items():
        if any(stem.startswith(prefix) for prefix in prefixes):
            return suite_id
    return "platform"


def modules_for_suite(suite_id: str) -> List[str]:
    all_modules = discover_test_module_names()
    if suite_id == "all":
        return all_modules
    return [m for m in all_modules if classify_module(m) == suite_id]


def list_suites() -> List[TestSuiteInfo]:
    all_modules = discover_test_module_names()
    by_suite: Dict[str, List[str]] = {k: [] for k in SUITE_META if k != "all"}
    for mod in all_modules:
        by_suite[classify_module(mod)].append(mod)

    out: List[TestSuiteInfo] = []
    for suite_id, (label, desc) in SUITE_META.items():
        mods = all_modules if suite_id == "all" else by_suite.get(suite_id, [])
        out.append(
            TestSuiteInfo(
                id=suite_id,
                label=label,
                description=desc,
                module_count=len(mods),
                modules=tuple(mods),
            )
        )
    return out


def suite_label(suite_id: str) -> str:
    return SUITE_META.get(suite_id, (suite_id, ""))[0]
