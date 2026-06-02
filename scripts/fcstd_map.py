#!/usr/bin/env python3
"""从仓库根遍历 .FCStd，建立文件名 → 路径映射（或结构化映射文档）。

遗留扁平映射::

  ``{ "Part.A.FCStd": [ "cad/Part.A.FCStd" ], ... }``

默认结构化（schema_version>=2），含每条零件号 / 版本 / 类型(H,S,R) / label — 详见 ``fcdesk.fcstd_mapping``.

用法::

  python scripts/fcstd_map.py
  python scripts/fcstd_map.py --json fcstd_map.json
  python scripts/fcstd_map.py --legacy-json fcstd_flat.json
  python scripts/fcstd_map.py --query Part.A.FCStd

运行本脚本时请从软件仓库根执行，或通过 pip 安装了本包以使 ``fcdesk`` 可导入。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Iterable

_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from fcdesk.fcstd_mapping import (  # noqa: E402
    legacy_flat_dict_to_document,
    map_json_payload_to_abs as rel_fcstd_map_to_abs,
    normalize_repo_rel_path_for_map,
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]

# 遍历时默认跳过的目录名
DEFAULT_SKIP_DIRS = frozenset(
    {
        ".git",
        "__pycache__",
        ".obsidian",
        "node_modules",
        ".cursor",
        "temp",
        ".venv",
        ".venv-desktop",
    }
)


def build_fcstd_map(
    search_root: Path | str | None = None,
    *,
    skip_dirs: Iterable[str] | None = None,
    relative_to: Path | str | None = None,
) -> dict[str, list[str]]:
    """遍历 search_root，返回「FCStd 文件名 → 相对路径列表」。

    Args:
        search_root: 扫描根目录，默认本仓库根。
        skip_dirs: 额外要跳过的目录名。
        relative_to: 映射值中的相对路径基准，默认与 search_root 相同。
    """
    root = Path(search_root or repo_root()).resolve()
    base = Path(relative_to or root).resolve()
    skip = DEFAULT_SKIP_DIRS | frozenset(skip_dirs or ())

    fcstd_map: dict[str, list[str]] = {}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip]
        for name in filenames:
            if not name.endswith(".FCStd"):
                continue
            abs_path = Path(dirpath, name).resolve()
            try:
                rel = os.path.relpath(abs_path, base).replace(os.sep, "/")
            except ValueError:
                rel = str(abs_path)
            rel = normalize_repo_rel_path_for_map(rel)
            fcstd_map.setdefault(name, []).append(rel)

    for paths in fcstd_map.values():
        paths.sort()
    return fcstd_map


def build_fcstd_map_abs(
    search_root: Path | str | None = None,
    *,
    skip_dirs: Iterable[str] | None = None,
) -> dict[str, list[Path]]:
    """文件名 -> 绝对路径列表（供 fix_fcstd_xlink_paths 等脚本使用）。"""
    root = Path(search_root or repo_root()).resolve()
    rel_map = build_fcstd_map(root, skip_dirs=skip_dirs, relative_to=root)
    return {name: [root / p for p in paths] for name, paths in rel_map.items()}


def lookup(
    fcstd_map: dict[str, list[str]],
    filename: str,
) -> list[str]:
    """按文件名查询；支持传入裸文件名或带路径的字符串。"""
    key = os.path.basename(filename)
    return list(fcstd_map.get(key, []))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="遍历项目根目录，生成 .FCStd 文件名 → 路径映射表",
    )
    parser.add_argument(
        "--root",
        default=None,
        help="扫描根目录（默认：本仓库根；fcdesk 桌面/Web 应用内固定为当前工作空间根）",
    )
    parser.add_argument(
        "--relative-to",
        default=None,
        metavar="DIR",
        help="写入映射时路径相对于此目录（默认与 --root 相同；链接修正可与仓库根合用）",
    )
    parser.add_argument(
        "--json",
        metavar="FILE",
        help="将映射表写入 JSON 文件（默认可读结构化 schema；可加 --legacy-json）",
    )
    parser.add_argument(
        "--legacy-json",
        action="store_true",
        help="与 --json 合用：写入旧版 { 文件名: [相对路径] }，不含条目字段",
    )
    parser.add_argument(
        "--query",
        metavar="NAME",
        help="查询单个文件名并打印路径",
    )
    parser.add_argument(
        "--duplicates-only",
        action="store_true",
        help="只列出出现多于一次的文件名",
    )
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else Path(repo_root()).resolve()
    rel_base = Path(args.relative_to).resolve() if args.relative_to else root
    fcstd_map = build_fcstd_map(root, relative_to=rel_base)

    total_files = sum(len(v) for v in fcstd_map.values())
    dup_count = sum(1 for v in fcstd_map.values() if len(v) > 1)

    if args.query:
        paths = lookup(fcstd_map, args.query)
        if not paths:
            print(f"未找到: {args.query}")
            raise SystemExit(1)
        for p in paths:
            print(p)
        return

    if args.duplicates_only:
        for name in sorted(fcstd_map):
            if len(fcstd_map[name]) > 1:
                print(f"{name} ({len(fcstd_map[name])})")
                for p in fcstd_map[name]:
                    print(f"  {p}")
        print(f"\n重名文件种类: {dup_count}")
        return

    print(f"扫描根: {root}")
    if rel_base.resolve() != root.resolve():
        print(f"写入路径相对基准 (--relative-to): {rel_base}")
    print(f"唯一文件名: {len(fcstd_map)}，FCStd 总数: {total_files}，重名: {dup_count}")

    if args.json:
        out = Path(args.json)
        if not out.is_absolute():
            out = root / out
        if args.legacy_json:
            out.write_text(
                json.dumps(fcstd_map, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        else:
            note = (
                "repo_rel_path 相对锚点为本 JSON 所在目录（与 CAD 扫描根 / --relative-to 相同）；"
                f"锚点路径: {rel_base}; 扫描范围: {root}。"
                " 详见 fcdesk.fcstd_mapping。"
            )
            doc = legacy_flat_dict_to_document(fcstd_map, anchor_note=note)
            out.write_text(
                json.dumps(doc.to_json_dict(), ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        print(f"已写入: {out}")
    else:
        for name in sorted(fcstd_map)[:5]:
            print(f"  {name} -> {fcstd_map[name][0]}")
        if len(fcstd_map) > 5:
            print(f"  ... 共 {len(fcstd_map)} 条，使用 --json 导出完整表")


if __name__ == "__main__":
    main()
