"""工作空间 Git：diff / restore / init（成员排序写盘后预览与 Revert）。"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import format_resolved_under_workspace

_MAX_DIFF_CHARS = 512 * 1024


def git_executable() -> str | None:
    return shutil.which("git")


def find_git_root(start: Path) -> Path | None:
    current = start.expanduser().resolve(strict=False)
    if not current.is_dir():
        return None
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def resolve_path_in_workspace(repo_root: Path, rel: str) -> Path:
    rr = repo_root.expanduser().resolve(strict=False)
    rel_norm = rel.replace("\\", "/").strip().lstrip("./")
    if not rel_norm or ".." in rel_norm.split("/"):
        raise ValueError(f"非法路径: {rel}")
    full = (rr / rel_norm).resolve(strict=False)
    try:
        full.relative_to(rr)
    except ValueError as e:
        raise ValueError(f"路径超出工作空间: {rel}") from e
    if not full.is_file():
        raise ValueError(f"文件不存在: {rel}")
    return full


def _git_path(git_root: Path, abs_path: Path) -> str:
    try:
        return abs_path.relative_to(git_root).as_posix()
    except ValueError as e:
        raise ValueError("文件不在 Git 仓库根目录下") from e


def _run_git(git_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    exe = git_executable()
    if not exe:
        raise RuntimeError("未找到 git 可执行文件，请先安装 Git")
    return subprocess.run(
        [exe, "-C", str(git_root), *args],
        capture_output=True,
        text=True,
        check=False,
    )


def _is_binary_diff(text: str) -> bool:
    if "GIT binary patch" in text:
        return True
    if "Binary files" in text and " differ" in text:
        return True
    return False


def git_workspace_info(repo_root: Path) -> dict[str, Any]:
    exe = git_executable()
    rr = repo_root.expanduser().resolve(strict=False)
    if not exe:
        return {
            "git_installed": False,
            "repo_initialized": False,
            "git_root": None,
            "git_root_display": None,
        }
    git_root = find_git_root(rr)
    if git_root is None:
        return {
            "git_installed": True,
            "repo_initialized": False,
            "git_root": None,
            "git_root_display": None,
        }
    return {
        "git_installed": True,
        "repo_initialized": True,
        "git_root": str(git_root),
        "git_root_display": format_resolved_under_workspace(git_root, rr),
    }


def git_init_repo(repo_root: Path) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    if find_git_root(rr) is not None:
        raise ValueError("工作空间已在 Git 仓库内")
    proc = _run_git(rr, "init")
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git init 失败（退出码 {proc.returncode}）")
    git_root = find_git_root(rr)
    if git_root is None:
        raise RuntimeError("git init 后仍未检测到 .git")
    return {
        "ok": True,
        "git_root": str(git_root),
        "git_root_display": format_resolved_under_workspace(git_root, rr),
    }


def git_diff_file(repo_root: Path, rel: str, *, context_lines: int = 3) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    git_root = find_git_root(rr)
    if git_root is None:
        raise ValueError("当前工作空间不在 Git 仓库内，请先初始化 Git")
    full = resolve_path_in_workspace(rr, rel)
    git_rel = _git_path(git_root, full)
    proc = _run_git(git_root, "diff", f"-U{context_lines}", "--", git_rel)
    if proc.returncode not in (0, 1):
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git diff 失败（退出码 {proc.returncode}）")
    text = proc.stdout or ""
    path_out = rel.replace("\\", "/")
    if _is_binary_diff(text):
        return {
            "path": path_out,
            "has_diff": True,
            "is_binary": True,
            "unified_diff": "",
            "truncated": False,
            "message": "二进制文件有变更，无法在 Web 中预览 diff",
        }
    if not text.strip():
        return {
            "path": path_out,
            "has_diff": False,
            "is_binary": False,
            "unified_diff": "",
            "truncated": False,
            "message": "与 Git 无差异（可能未跟踪或已 Revert）",
        }
    truncated = len(text) > _MAX_DIFF_CHARS
    if truncated:
        text = text[:_MAX_DIFF_CHARS] + "\n\n…（diff 已截断）\n"
    return {
        "path": path_out,
        "has_diff": True,
        "is_binary": False,
        "unified_diff": text,
        "truncated": truncated,
        "message": "diff 已截断，仅显示前 512KB" if truncated else None,
    }


def git_restore_files(repo_root: Path, rel_paths: list[str]) -> dict[str, Any]:
    rr = repo_root.expanduser().resolve(strict=False)
    git_root = find_git_root(rr)
    if git_root is None:
        raise ValueError("当前工作空间不在 Git 仓库内")
    paths = [p.strip() for p in rel_paths if p.strip()]
    if not paths:
        raise ValueError("请指定至少一个文件路径")

    git_rels: list[str] = []
    resolved: list[str] = []
    for rel in paths:
        full = resolve_path_in_workspace(rr, rel)
        git_rels.append(_git_path(git_root, full))
        resolved.append(rel.replace("\\", "/"))

    proc = _run_git(git_root, "restore", "--", *git_rels)
    if proc.returncode != 0:
        proc = _run_git(git_root, "checkout", "HEAD", "--", *git_rels)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git restore 失败（退出码 {proc.returncode}）")

    restored: list[str] = []
    skipped: list[str] = []
    for rel, git_rel in zip(resolved, git_rels, strict=True):
        diff = _run_git(git_root, "diff", "--", git_rel)
        if (diff.stdout or "").strip():
            skipped.append(rel)
        else:
            restored.append(rel)

    return {
        "restored": restored,
        "skipped": skipped,
        "git_root_display": format_resolved_under_workspace(git_root, rr),
    }
