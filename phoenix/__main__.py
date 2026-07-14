"""Compatibility entry point for the retired Python desktop launcher."""

from __future__ import annotations

import sys


def main() -> int:
    print("Phoenix desktop has migrated to the Node/Rust/Tauri stack.", file=sys.stderr)
    print("", file=sys.stderr)
    print("  pnpm dev          # browser development", file=sys.stderr)
    print("  pnpm tauri:dev    # desktop development", file=sys.stderr)
    print("  pnpm tauri:build  # desktop package", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
