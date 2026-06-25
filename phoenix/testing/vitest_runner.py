#!/usr/bin/env python3
"""vitest 子进程运行器 —— Python 后端 subprocess vitest，解析 JSON 输出。"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

from phoenix.testing.suite_registry import classify_module, repo_root


def _project_root() -> Path:
    return repo_root()


def run_vitest_suite(
    suite_id: str,
    module_names: list[str] | None = None,
) -> dict[str, Any]:
    """运行 vitest 套件并返回结构化结果。"""
    root = _project_root()
    args = ["npx", "vitest", "run", "--reporter", "json"]
    if module_names:
        args.extend(module_names)

    started = time.perf_counter()

    try:
        proc = subprocess.run(
            args,
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=120,
            env={**__import__("os").environ, "CI": "true"},
        )
    except subprocess.TimeoutExpired:
        duration_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "suite_id": suite_id,
            "suite_label": suite_id,
            "duration_ms": duration_ms,
            "summary": {"tests_run": 0, "passed": 0, "failed": 0, "errors": 1, "skipped": 0, "modules": 0},
            "modules": [],
            "cases": [],
            "failures": [{"id": "timeout", "module": "", "status": "error", "message": "vitest timed out after 120s"}],
        }

    duration_ms = int((time.perf_counter() - started) * 1000)
    stdout = proc.stdout.strip()
    stderr = proc.stderr.strip()

    # vitest JSON reporter 输出到 stdout
    try:
        vitest_result = json.loads(stdout) if stdout else {}
    except json.JSONDecodeError:
        return {
            "ok": False,
            "suite_id": suite_id,
            "suite_label": suite_id,
            "duration_ms": duration_ms,
            "summary": {"tests_run": 0, "passed": 0, "failed": 0, "errors": 1, "skipped": 0, "modules": 0},
            "modules": [],
            "cases": [],
            "failures": [{"id": "parse", "module": "", "status": "error", "message": f"vitest JSON parse error: {stderr[:500]}"}],
        }

    # 转换为 UnitTestRunResult 格式
    test_results = vitest_result.get("testResults", [])
    cases: list[dict] = []
    passed = 0
    failed = 0
    skipped = 0
    modules_set: set[str] = set()

    for file_result in test_results:
        module_name = file_result.get("name", "")
        modules_set.add(module_name)
        for tc in file_result.get("assertionResults", []):
            status = tc.get("status", "skipped")
            if status == "passed":
                passed += 1
            elif status == "failed":
                failed += 1
            else:
                skipped += 1

            case = {
                "id": tc.get("fullName", f"{module_name}.{tc.get('title', '?')}"),
                "module": module_name,
                "suite_id": suite_id,
                "class_name": tc.get("ancestorTitles", [""])[0] if tc.get("ancestorTitles") else "",
                "method": tc.get("title", ""),
                "status": status,
                "duration_ms": int(tc.get("duration", 0)),
                "message": "\n".join(tc.get("failureMessages", [])) if tc.get("failureMessages") else "",
                "traceback": "",
            }
            cases.append(case)

    failures = [c for c in cases if c["status"] in ("failed", "error")]

    return {
        "ok": proc.returncode == 0,
        "suite_id": suite_id,
        "suite_label": suite_id,
        "duration_ms": duration_ms,
        "summary": {
            "tests_run": passed + failed,
            "passed": passed,
            "failed": failed,
            "errors": 0,
            "skipped": skipped,
            "modules": len(modules_set),
        },
        "modules": [{"module": m, "tests_run": 0, "passed": 0, "failed": 0, "errors": 0, "skipped": 0} for m in sorted(modules_set)],
        "cases": cases,
        "failures": failures,
    }
