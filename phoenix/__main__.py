"""Phoenix 桌面启动器 — 已迁移到 Node.js + Rust。

使用 `pnpm dev` 启动。
"""

import sys

if __name__ == "__main__":
    print("Phoenix 桌面启动器已迁移到 Node.js + Rust。", file=sys.stderr)
    print("", file=sys.stderr)
    print("  启动方式：", file=sys.stderr)
    print("    pnpm dev           # Node.js :5180 + Vue :5173", file=sys.stderr)
    print("", file=sys.stderr)
    print("  Python 后端已关闭。详见 doc/cad/ 迁移计划。", file=sys.stderr)
    sys.exit(1)
