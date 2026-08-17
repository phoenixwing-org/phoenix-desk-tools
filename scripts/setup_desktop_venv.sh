#!/usr/bin/env bash
# 使用官网安装的 Python（macOS Frameworks）创建 .venv-desktop 并安装依赖。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$REPO_ROOT/.venv-desktop"

_find_python_with_tk() {
  local candidates=()
  for v in 3.13 3.12 3.11; do
    candidates+=("/Library/Frameworks/Python.framework/Versions/$v/bin/python3")
  done
  candidates+=(python3)

  local c
  for c in "${candidates[@]}"; do
    if command -v "$c" >/dev/null 2>&1 && "$c" -c "import tkinter" 2>/dev/null; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

PY="$(_find_python_with_tk)" || {
  echo "未找到带 tkinter 的 Python。请先安装官网 pkg：" >&2
  echo "  https://www.python.org/downloads/macos/" >&2
  exit 1
}

echo "使用: $("$PY" --version)"
echo "路径: $(command -v "$PY" || echo "$PY")"
"$PY" -m venv "$VENV"
# shellcheck source=/dev/null
source "$VENV/bin/activate"
pip install -U pip
pip install -e "$REPO_ROOT"
python -c "import tkinter, customtkinter; print('tkinter + customtkinter OK')"
echo ""
echo "完成。启动:"
echo "  source $VENV/bin/activate && cd $REPO_ROOT && python -m phoenix"
echo "文档: $REPO_ROOT/docs/文档索引.md"
