"""启动 Web 样例：单端口托管 API + 前端（默认 http://127.0.0.1:5173）。"""

from __future__ import annotations

import argparse
import subprocess
import sys
import threading
from pathlib import Path

import uvicorn

from fcdesk.config.user_prefs import migrate_launcher_prefs_to_web
from fcdesk.web.app import create_app, set_workspace
from fcdesk.web.browser_open import find_ide_cli, open_in_ide_browser, print_terminal_link
from fcdesk.web.paths import (
    build_web_ui,
    default_static_dir,
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


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Phoenix FCDesk Web（单服务：API + 静态前端，默认端口 5173）",
    )
    parser.add_argument(
        "--workspace",
        "-w",
        default="",
        help="工作空间根（默认：launcher 最近工作空间，否则当前目录）",
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
                    print("提示: cd web-ui && pnpm install && pnpm build", file=sys.stderr)
                    sys.exit(1)
        if not static_dir.is_dir():
            print(f"缺少前端构建目录: {static_dir}", file=sys.stderr)
            print("请运行: python -m fcdesk.web --build", file=sys.stderr)
            sys.exit(1)

    if args.workspace.strip():
        ws_path = Path(args.workspace)
    else:
        migrate_launcher_prefs_to_web()
        ws_path = default_workspace_path()

    ws = set_workspace(ws_path)
    app = create_app(static_dir=static_dir)

    url = f"http://{args.host}:{args.port}"
    print(f"工作空间: {ws}")
    auto_open = not args.no_open and not args.api_only
    if auto_open:
        _schedule_open_browser(url, use_system=args.open_system)
        target = "系统浏览器" if args.open_system else "Cursor/VS Code 内置浏览器"
        print(f"将自动打开（{target}）: {url}")
    else:
        print(f"打开浏览器: {url}")
    if static_dir:
        print(f"前端: {static_dir}")
    print(f"API: {url}/api/health")

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
