#!/usr/bin/env bash
# 将本机 clone 的开源测试工程链接到 tests/fixtures/（symlink）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
python3 scripts/link_test_fixtures.py "$@"
