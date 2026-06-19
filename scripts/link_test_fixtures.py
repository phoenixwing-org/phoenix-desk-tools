#!/usr/bin/env python3
"""按 tests/fixtures/external-links.manifest.json 创建 tests/fixtures/ 下的 symlink。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from phoenix.testing.fixture_links import ensure_fixture_links, manifest_path  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="将本机 clone 的开源测试工程链接到 tests/fixtures/（symlink）",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="只打印将要创建的链接，不写盘",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=manifest_path(),
        help="manifest JSON 路径",
    )
    args = parser.parse_args()

    if not args.manifest.is_file():
        print(f"manifest 不存在: {args.manifest}", file=sys.stderr)
        return 1

    results = ensure_fixture_links(dry_run=args.dry_run)
    if not results:
        print("无链接项，或已设置 PHOENIX_SKIP_FIXTURE_LINKS=1")
        return 0

    exit_code = 0
    for item in results:
        print(f"[{item.status}] {item.name}: {item.detail}")
        if item.status in ("error",):
            exit_code = 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
