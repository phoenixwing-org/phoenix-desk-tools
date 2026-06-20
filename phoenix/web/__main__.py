"""启动 Web 版 Phoenix 桌面辅助工具：单端口托管 API + 前端（默认 http://127.0.0.1:5173）。"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import uvicorn

from phoenix.web.app import create_app, set_workspace
from phoenix.web.browser_open import find_ide_cli, open_in_ide_browser, print_terminal_link
from phoenix.web.paths import (
    build_web_ui,
    default_api_dev_port,
    default_static_dir,
    default_web_port,
    default_workspace_path,
    repo_root,
    resolve_static_dir,
    run_pnpm,
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


def _resolve_workspace_path(raw: str) -> Path:
    if raw.strip():
        return Path(raw)
    return default_workspace_path()


def _run_dev_mode(
    *,
    ws_path: Path,
    host: str,
    api_port: int,
    vite_port: int,
    no_open: bool,
    open_system: bool,
) -> None:
    root = repo_root()
    ui_dir = root / "web-ui"
    if not (ui_dir / "package.json").is_file():
        print(f"未找到前端工程: {ui_dir}", file=sys.stderr)
        sys.exit(1)
    pnpm_cwd = root if (root / "package.json").is_file() else ui_dir

    ws = set_workspace(ws_path)
    app = create_app(static_dir=None)
    api_url = f"http://{host}:{api_port}"
    vite_url = f"http://{host}:{vite_port}"

    api_error: list[BaseException] = []

    def _serve_api() -> None:
        try:
            uvicorn.run(app, host=host, port=api_port, log_level="info")
        except BaseException as exc:
            api_error.append(exc)

    api_thread = threading.Thread(target=_serve_api, daemon=True)
    api_thread.start()
    time.sleep(0.6)
    if api_error:
        print(f"API 启动失败: {api_error[0]}", file=sys.stderr)
        sys.exit(1)

    print(f"开发模式 · 工作空间: {ws}")
    print(f"API:  {api_url}/api/health")
    print(f"Vite: {vite_url} （热更新，/api 代理到 {api_port}）")
    print("改 Vue/TS 即时刷新，无需 pnpm build。Ctrl+C 退出。")

    if not no_open:
        _schedule_open_browser(vite_url, use_system=open_system)

    env = os.environ.copy()
    env["PHOENIX_API_PORT"] = str(api_port)
    env["PHOENIX_API_PORT"] = str(api_port)  # 兼容 Vite 旧环境变量名
    try:
        run_pnpm(["dev"], cwd=pnpm_cwd, env=env)
    except KeyboardInterrupt:
        print("\n开发模式已停止。")
    except FileNotFoundError:
        print(
            "未找到 pnpm（未在 PATH 中）。请先安装 Node.js / pnpm，并在仓库根目录执行: pnpm install",
            file=sys.stderr,
        )
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Phoenix 桌面辅助工具（Web：单服务 API + 静态前端，默认端口 5173）",
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
        "--dev",
        action="store_true",
        help="开发模式：API 8765 + Vite 5173 热更新（无需 build，双进程）",
    )
    parser.add_argument(
        "--api-port",
        type=int,
        default=default_api_dev_port(),
        help=f"--dev 时 API 端口（默认 {default_api_dev_port()}；Vite 固定 5173）",
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

    ws_path = _resolve_workspace_path(args.workspace)

    if args.dev:
        if args.build or args.api_only:
            print("--dev 与 --build / --api-only 不能同时使用", file=sys.stderr)
            sys.exit(2)
        _run_dev_mode(
            ws_path=ws_path,
            host=args.host,
            api_port=args.api_port,
            vite_port=default_web_port(),
            no_open=args.no_open,
            open_system=args.open_system,
        )
        return

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
