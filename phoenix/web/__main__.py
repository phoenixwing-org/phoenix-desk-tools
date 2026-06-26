"""启动 Web 版 Phoenix 桌面辅助工具：单端口托管 API + 前端（默认 http://127.0.0.1:5173）。"""

from __future__ import annotations

import argparse
import subprocess
import sys
import threading
from pathlib import Path

import uvicorn

from phoenix.web.app import create_app, set_workspace
from phoenix.web.browser_open import find_ide_cli, open_in_ide_browser, print_terminal_link
from phoenix.web.paths import (
    build_web_ui,
    default_api_dev_port,
    default_web_port,
    default_workspace_path,
    resolve_static_dir,
)


def _schedule_open_browser(url: str, *, use_system: bool = False, delay_s: float = 0.9) -> None:
    """等服务绑定端口后再打开浏览器。"""

    def _open() -> None:
        if use_system:
            import webbrowser

            try:
                webbrowser.open(url)
            except OSError as exc:
                print(f"无法打开系统浏览器: {exc}", file=sys.stderr)
            return
        if open_in_ide_browser(url):
            return
        print_terminal_link(url)
        cli = find_ide_cli()
        if cli is None:
            print(
                "未找到 cursor/code CLI，无法在 IDE 内置浏览器中自动打开。\n"
                "  · 在 Cursor 中：Cmd+Shift+P → “Shell Command: Install 'cursor' command in PATH”\n"
                "  · 或 Cmd+单击上方终端链接（需 workbench.browser.openLocalhostLinks）\n"
                "  · 或手动打开 Simple Browser / 集成浏览器 并输入地址",
                file=sys.stderr,
            )
        else:
            print(
                "已请求 IDE 打开页面；若未弹出，请 Cmd+单击上方终端链接。",
                file=sys.stderr,
            )

    threading.Timer(delay_s, _open).start()


def _resolve_workspace_path(raw: str) -> Path | None:
    if raw.strip():
        return Path(raw)
    return default_workspace_path()


def _print_workspace_banner(ws_path: Path | None) -> None:
    if ws_path is None:
        print("工作空间: （未配置，请在 Web 配置页选择 CAD 项目根目录）")
        return
    print(f"工作空间: {ws_path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Phoenix 桌面辅助工具（Web：单服务 API + 静态前端，默认端口 5173）",
    )
    parser.add_argument(
        "--workspace",
        "-w",
        default="",
        help="工作空间根（默认：launcher 最近记录；无记录时不使用当前目录）",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=default_web_port())
    parser.add_argument(
        "--static",
        default="",
        help="前端构建目录（默认 web-ui/dist）",
    )
    parser.add_argument(
        "--build",
        action="store_true",
        help="启动前执行 pnpm build（web-ui）",
    )
    parser.add_argument(
        "--api-only",
        action="store_true",
        help="仅 API，不托管前端静态文件",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="开发模式：同 --api-only，但默认端口改为 8765。前端使用 pnpm dev / pnpm dev:ui",
    )
    parser.add_argument(
        "--api-port",
        type=int,
        default=default_api_dev_port(),
        help=f"--dev 时 API 端口（默认 {default_api_dev_port()}）",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="不自动打开浏览器（默认托管前端时在 Cursor/VS Code 内置浏览器打开）",
    )
    parser.add_argument(
        "--open-system",
        action="store_true",
        help="改用系统默认浏览器（Safari/Chrome 等），而非 IDE 内置浏览器",
    )
    args = parser.parse_args()

    # --dev 等价于 --api-only + 端口切到 api_port（除非用户显式指定了 --port）
    if args.dev:
        args.api_only = True
        if args.port == default_web_port():
            args.port = args.api_port

    ws_path = _resolve_workspace_path(args.workspace)

    static_dir: Path | None = None
    if not args.api_only:
        static_dir = resolve_static_dir(args.static.strip() or None)
        if args.build or not static_dir.is_dir():
            print("构建前端 web-ui …")
            try:
                build_web_ui()
            except (FileNotFoundError, subprocess.CalledProcessError) as e:
                print(f"构建失败: {e}", file=sys.stderr)
                if not static_dir.is_dir():
                    print("提示: pnpm install && pnpm build（仓库根目录即可）", file=sys.stderr)
                    sys.exit(1)
        if not static_dir.is_dir():
            print(f"缺少前端构建目录: {static_dir}", file=sys.stderr)
            print("请运行: python -m phoenix.web --build", file=sys.stderr)
            sys.exit(1)

    if ws_path is not None:
        try:
            ws = set_workspace(ws_path)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            sys.exit(2)
    else:
        ws = None
    app = create_app(static_dir=static_dir)

    url = f"http://{args.host}:{args.port}"
    _print_workspace_banner(ws)
    auto_open = not args.no_open and not args.api_only
    if auto_open:
        _schedule_open_browser(url, use_system=args.open_system)
        target = "系统浏览器" if args.open_system else "Cursor/VS Code 内置浏览器"
        print(f"将自动打开（{target}）: {url}")
    elif args.dev:
        print(f"API:  {url}/api/health")
        print("开发模式：仅 API 热重载。前端请另外运行 pnpm dev 或 pnpm dev:ui。Ctrl+C 退出。")
    else:
        print(f"API:  {url}/api/health")

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning", access_log=False)


if __name__ == "__main__":
    main()
