"""将内置 catalog 中的外部测试工程 symlink 到 tests/fixtures/。"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger("phoenix.testing.fixture_links")

CATALOG_NAME = "test_fixture_catalog.json"
SKIP_ENV = "PHOENIX_SKIP_FIXTURE_LINKS"


@dataclass(frozen=True)
class LinkResult:
    name: str
    status: str
    detail: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _windows_link_ps1() -> Path:
    return repo_root() / "scripts" / "link_test_fixture_win.ps1"


def _run_windows_link_ps1(action: str, link_path: Path, target: Path | None = None) -> str:
    script = _windows_link_ps1()
    if not script.is_file():
        raise OSError(f"缺少 Windows 链接脚本: {script}")
    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(script),
        "-Action",
        action,
        "-LinkPath",
        str(link_path),
    ]
    if target is not None:
        cmd.extend(["-TargetPath", str(target)])
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False, cwd=str(repo_root()))
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise OSError(err or f"PowerShell 链接脚本失败（{action}）")
    lines = [ln.strip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
    return lines[-1] if lines else action


def default_checkout_root() -> Path:
    """默认检出目录：与 phoenix-desk-tools 同级的源码目录。"""
    return repo_root().parent


def fixtures_dir() -> Path:
    return repo_root() / "tests" / "fixtures"


def catalog_path() -> Path:
    return Path(__file__).resolve().parents[1] / "config" / CATALOG_NAME


def manifest_path() -> Path:
    """兼容旧名；指向 ``phoenix/config/test_fixture_catalog.json``。"""
    return catalog_path()


def load_catalog() -> dict[str, Any]:
    path = catalog_path()
    if not path.is_file():
        return {"version": 0, "projects": []}
    return json.loads(path.read_text(encoding="utf-8"))


def load_manifest() -> dict[str, Any]:
    """@deprecated 请用 load_catalog。"""
    return load_catalog()


def catalog_projects() -> list[dict[str, Any]]:
    data = load_catalog()
    raw = data.get("projects") or data.get("links") or []
    return [x for x in raw if isinstance(x, dict) and str(x.get("name") or "").strip()]


def manifest_links() -> list[dict[str, Any]]:
    """兼容旧名；返回内置 catalog 中的工程列表。"""
    return catalog_projects()


def clone_url_for_link(link: dict[str, Any]) -> str:
    return str(link.get("clone_url") or link.get("gitee") or "").strip()


def _skip_enabled() -> bool:
    return os.environ.get(SKIP_ENV, "").strip().lower() in ("1", "true", "yes")


def resolve_checkout_root(explicit: str | None = None) -> Path:
    if explicit and str(explicit).strip():
        p = Path(str(explicit)).expanduser().resolve(strict=False)
        if not p.is_dir():
            raise ValueError(f"不是有效目录: {p}")
        return p
    try:
        from phoenix.testing.fixture_prefs import load_test_fixture_prefs

        prefs = load_test_fixture_prefs()
        cr = str(prefs.get("checkout_root") or "").strip()
        if cr:
            p = Path(cr).expanduser().resolve(strict=False)
            if p.is_dir():
                return p
    except Exception:
        pass
    return default_checkout_root()


def checkout_path_for_link(link: dict[str, Any], checkout_root: Path | None = None) -> Path:
    name = str(link.get("name") or "").strip()
    root = checkout_root or resolve_checkout_root()
    return (root / name).resolve(strict=False)


def resolve_link_target(
    link: dict[str, Any],
    root: Path | None = None,
    *,
    checkout_root: Path | None = None,
) -> Path | None:
    root = root or repo_root()
    name = str(link.get("name") or "").strip()
    env_key = f"PHOENIX_FIXTURE_{name}" if name else ""
    env_val = os.environ.get(env_key, "").strip() if env_key else ""
    if env_val:
        candidate = Path(env_val).expanduser()
        if candidate.is_dir():
            return candidate.resolve()

    cr = checkout_root or resolve_checkout_root()
    checkout = checkout_path_for_link(link, cr)
    if checkout.is_dir():
        return checkout.resolve()

    for raw in link.get("candidates") or []:
        candidate = (root / str(raw)).expanduser()
        if candidate.is_dir():
            return candidate.resolve()

    target = link.get("target")
    if target:
        candidate = (root / str(target)).expanduser()
        if candidate.is_dir():
            return candidate.resolve()
    return None


def _is_directory_link(link_path: Path) -> bool:
    """symlink 或 Windows 目录 junction（均视为 fixture 链接）。"""
    if link_path.is_symlink():
        return True
    if sys.platform == "win32" and link_path.exists():
        is_junction = getattr(link_path, "is_junction", None)
        if callable(is_junction):
            try:
                return bool(is_junction())
            except OSError:
                return False
    return False


def _resolve_directory_link(link_path: Path) -> Path | None:
    if not _is_directory_link(link_path):
        return None
    try:
        return link_path.resolve()
    except OSError:
        return None


def _remove_directory_link(link_path: Path) -> None:
    if sys.platform == "win32" and _windows_link_ps1().is_file():
        _run_windows_link_ps1("Remove", link_path)
        return
    if link_path.is_symlink() or (
        sys.platform == "win32"
        and link_path.exists()
        and getattr(link_path, "is_junction", lambda: False)()
    ):
        link_path.unlink()
        return
    if link_path.is_dir():
        link_path.rmdir()


def _create_windows_junction(link_path: Path, target: Path) -> None:
    if link_path.exists():
        raise OSError(f"链接路径已存在: {link_path}")
    proc = subprocess.run(
        ["cmd", "/c", "mklink", "/J", str(link_path), str(target)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise OSError(err or "mklink /J 失败（Windows 目录 junction）")


def _create_directory_link(link_path: Path, dest: str, target: Path) -> str:
    """创建目录链接；Windows 优先 PowerShell（先删后建），再 os.symlink / junction。"""
    link_path.parent.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32" and _windows_link_ps1().is_file():
        kind = _run_windows_link_ps1("New", link_path, target)
        return kind if kind in ("symlink", "junction") else "symlink"
    try:
        if link_path.exists() or link_path.is_symlink():
            _remove_directory_link(link_path)
        os.symlink(dest, link_path, target_is_directory=True)
        return "symlink"
    except OSError as exc:
        winerr = getattr(exc, "winerror", None)
        if sys.platform != "win32" or winerr not in (1314, 5):
            raise
        if link_path.exists() or link_path.is_symlink():
            _remove_directory_link(link_path)
        _create_windows_junction(link_path, target)
        return "junction"


def _cleanup_blocking_entry(link_path: Path, *, dry_run: bool = False) -> str | None:
    """删除阻塞链接的残留（文本文件、损坏链接、空目录）。"""
    if _is_directory_link(link_path):
        try:
            link_path.resolve()
            return None
        except OSError:
            detail = f"删除损坏的链接 {link_path.name}"
            if not dry_run:
                _remove_directory_link(link_path)
            return detail

    if not link_path.exists():
        return None

    if link_path.is_file():
        detail = f"删除残留文件 {link_path.name}"
        if not dry_run:
            link_path.unlink()
        return detail

    if link_path.is_dir():
        try:
            next(link_path.iterdir())
            return None
        except StopIteration:
            detail = f"删除空目录 {link_path.name}"
            if not dry_run:
                link_path.rmdir()
            return detail

    return None


def symlink_status(name: str) -> dict[str, str]:
    link_path = fixtures_dir() / name
    if _is_directory_link(link_path):
        try:
            target = link_path.resolve()
            kind = "junction" if sys.platform == "win32" and getattr(link_path, "is_junction", lambda: False)() else "symlink"
            label = "junction" if kind == "junction" else "symlink"
            return {
                "status": "ok",
                "detail": f"已链接（{label}）→ {target}",
                "symlink_path": str(link_path),
                "target_path": str(target),
                "link_kind": kind,
            }
        except OSError as exc:
            return {
                "status": "error",
                "detail": str(exc),
                "symlink_path": str(link_path),
                "target_path": "",
                "link_kind": "",
            }
    if link_path.is_file():
        preview = ""
        try:
            text = link_path.read_text(encoding="utf-8", errors="replace").strip()
            if text:
                preview = f"（{text[:80]}{'…' if len(text) > 80 else ''}）"
        except OSError:
            pass
        return {
            "status": "stale",
            "detail": f"残留文件，非 symlink{preview}",
            "symlink_path": str(link_path),
            "target_path": "",
        }
    if link_path.is_dir():
        return {
            "status": "skipped",
            "detail": f"已存在非 symlink 目录 {link_path.name}，未覆盖",
            "symlink_path": str(link_path),
            "target_path": "",
        }
    return {
        "status": "missing",
        "detail": "未链接",
        "symlink_path": str(link_path),
        "target_path": "",
    }


def git_clone_repository(url: str, dest: Path, *, dry_run: bool = False) -> str:
    if not url:
        raise ValueError("缺少 clone URL")
    dest = dest.expanduser().resolve(strict=False)
    if (dest / ".git").is_dir():
        return "exists"
    if dest.exists():
        raise ValueError(f"目标已存在且非 git 仓库: {dest}")
    if dry_run:
        return "would_clone"
    dest.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        ["git", "clone", "--depth", "1", url, str(dest)],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git clone 失败（退出码 {proc.returncode}）")
    return "cloned"


def _relative_symlink_target(link_path: Path, target: Path) -> str:
    try:
        rel = os.path.relpath(target, link_path.parent)
        if not rel.startswith(".."):
            return rel
    except ValueError:
        pass
    return str(target)


def _existing_link_target(link_path: Path) -> Path | None:
    return _resolve_directory_link(link_path)


def ensure_link(name: str, target: Path, *, dry_run: bool = False) -> LinkResult:
    link_path = fixtures_dir() / name
    target = target.resolve()

    cleaned = _cleanup_blocking_entry(link_path, dry_run=dry_run)

    if _is_directory_link(link_path):
        current = _existing_link_target(link_path)
        if current == target:
            if cleaned:
                return LinkResult(name, "ok", f"{cleaned}；已链接 → {target}")
            return LinkResult(name, "ok", f"已链接 → {target}")
        if dry_run:
            prefix = f"{cleaned}；" if cleaned else ""
            return LinkResult(name, "would_relink", f"{prefix}{current} → {target}")
        _remove_directory_link(link_path)
    elif link_path.exists():
        return LinkResult(
            name,
            "skipped",
            f"已存在非空目录 {link_path.name}，未覆盖"
            + (f"（{cleaned}）" if cleaned else ""),
        )

    dest = _relative_symlink_target(link_path, target)
    if dry_run:
        prefix = f"{cleaned}；" if cleaned else ""
        return LinkResult(name, "would_link", f"{prefix}{link_path.name} → {dest}")

    kind = _create_directory_link(link_path, dest, target)
    prefix = f"{cleaned}；" if cleaned else ""
    kind_note = "（junction）" if kind == "junction" else ""
    return LinkResult(name, "linked", f"{prefix}{link_path.name}{kind_note} → {target}")


def sync_fixture_links(
    *,
    enabled: set[str] | None = None,
    clone: bool = False,
    dry_run: bool = False,
    checkout_root: Path | None = None,
) -> list[LinkResult]:
    if _skip_enabled():
        log.debug("fixture link skipped (%s set)", SKIP_ENV)
        return []

    if enabled is None:
        from phoenix.testing.fixture_prefs import enabled_test_fixture_names

        enabled = enabled_test_fixture_names()
    if not enabled:
        return []

    cr = checkout_root or resolve_checkout_root()
    root = repo_root()
    results: list[LinkResult] = []

    for link in manifest_links():
        name = str(link.get("name") or "").strip()
        if name not in enabled:
            continue
        if clone:
            url = clone_url_for_link(link)
            dest = checkout_path_for_link(link, cr)
            try:
                action = git_clone_repository(url, dest, dry_run=dry_run)
                if action == "cloned":
                    results.append(LinkResult(name, "cloned", f"git clone → {dest}"))
                elif action == "would_clone":
                    results.append(LinkResult(name, "would_clone", f"将 clone 到 {dest}"))
            except (ValueError, RuntimeError, OSError) as exc:
                results.append(LinkResult(name, "clone_error", str(exc)))
                continue

        target = resolve_link_target(link, root, checkout_root=cr)
        if target is None:
            results.append(
                LinkResult(
                    name,
                    "missing",
                    f"未找到检出目录 {checkout_path_for_link(link, cr)}；请勾选后执行「检出并链接」",
                )
            )
            continue
        try:
            results.append(ensure_link(name, target, dry_run=dry_run))
        except OSError as exc:
            results.append(LinkResult(name, "error", str(exc)))

    return results


def ensure_fixture_links(*, dry_run: bool = False) -> list[LinkResult]:
    """启动时：仅对已启用的引用尝试链接（不 git clone）。"""
    return sync_fixture_links(clone=False, dry_run=dry_run)


def ensure_fixture_links_logged(*, dry_run: bool = False) -> list[LinkResult]:
    results = ensure_fixture_links(dry_run=dry_run)
    for item in results:
        if item.status in ("linked", "would_link", "would_relink", "cloned", "would_clone"):
            log.info("fixture %s: %s — %s", item.name, item.status, item.detail)
        elif item.status == "ok":
            log.debug("fixture %s: %s", item.name, item.detail)
        elif item.status in ("missing", "clone_error"):
            log.debug("fixture %s: %s — %s", item.name, item.status, item.detail)
        else:
            log.warning("fixture %s: %s — %s", item.name, item.status, item.detail)
    return results
