"""Phoenix Web API — 已迁移到 Node.js + Rust。

使用 `pnpm dev` 启动全栈，或 `pnpm dev:server` 仅 Node 后端。
"""

import sys

if __name__ == "__main__":
    print("Phoenix Web API 已迁移到 Node.js (server/src/routes/)。", file=sys.stderr)
    print("", file=sys.stderr)
    print("  启动方式：", file=sys.stderr)
    print("    pnpm dev            # Node.js :5180 + Vue :5173", file=sys.stderr)
    print("    pnpm dev:server     # 仅 Node.js :5180", file=sys.stderr)
    print("", file=sys.stderr)
    print("  如果必须用 Python API（旧功能未迁移完）：", file=sys.stderr)
    print("    cd server && PHOENIX_API_PORT=8765 pnpm dev", file=sys.stderr)
    print("    # 然后在另一个终端启动 Python：", file=sys.stderr)
    print("    # （需要先 revert phoenix/__main__.py 和本文件）", file=sys.stderr)
    sys.exit(1)
