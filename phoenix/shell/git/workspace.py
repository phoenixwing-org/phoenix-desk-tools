from __future__ import annotations

from pathlib import Path
from typing import Any

from phoenix.config.user_prefs import format_resolved_under_workspace
from phoenix.shell.git.paths import git_root_for_workspace, normalize_repo_rel, resolve_repo_rel, workspace_root
from phoenix.shell.git.runner import git_executable, run_git

_MAX_DIFF_CHARS = 512 * 1024


def _is_binary_diff(text: str) -> bool:
    if "GIT binary patch" in text:
        return True
    if "Binary files" in text and " differ" in text:
        return True
    return False


def _empty_changes() -> dict[str, Any]:
    return {
        "entries": [],
        "changes": [],
        "untracked": [],
        "staged": [],
        "staged_count": 0,
        "unstaged_count": 0,
        "untracked_count": 0,
    }


def _decode_git_porcelain_path(raw: str) -> str:
    """解析 ``git status --porcelain`` 中带 C 风格引号的路径（含空格等特殊字符）。"""
    text = raw.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        inner = text[1:-1]
        out: list[str] = []
        i = 0
        while i < len(inner):
            ch = inner[i]
            if ch == "\\" and i + 1 < len(inner):
                nxt = inner[i + 1]
                if nxt == "n":
                    out.append("\n")
                elif nxt == "t":
                    out.append("\t")
                elif nxt == "b":
                    out.append("\b")
                elif nxt == "r":
                    out.append("\r")
                elif nxt in ('"', "\\"):
                    out.append(nxt)
                else:
                    out.append(nxt)
                i += 2
            else:
                out.append(ch)
                i += 1
        return "".join(out).replace("\\", "/")
    return text.replace("\\", "/")


def _parse_porcelain_line(line: str) -> dict[str, Any] | None:
    if len(line) < 3:
        return None
    if line.startswith("?? "):
        path = _decode_git_porcelain_path(line[3:])
        if not path:
            return None
        return {
            "path": path,
            "index_status": "?",
            "worktree_status": "?",
            "staged": False,
            "modified": False,
            "untracked": True,
        }
    if len(line) < 4:
        return None
    index_st = line[0]
    worktree_st = line[1]
    path_part = line[3:].strip()
    if not path_part:
        return None
    if " -> " in path_part:
        path_part = path_part.split(" -> ", 1)[1]
    path = _decode_git_porcelain_path(path_part)
    staged = index_st not in (" ", "?", "!")
    has_worktree = worktree_st not in (" ", "?", "!")
    return {
        "path": path,
        "index_status": index_st,
        "worktree_status": worktree_st,
        "staged": staged,
        "modified": has_worktree and not (index_st == "?" and worktree_st == "?"),
        "untracked": False,
        "has_worktree_change": has_worktree,
        "has_staged_change": staged,
    }


def git_info(workspace: Path) -> dict[str, Any]:
    ws = workspace_root(workspace)
    exe = git_executable()
    if not exe:
        return {
            "git_installed": False,
            "repo_initialized": False,
            "git_root": None,
            "git_root_display": None,
            "scope_note": "仅当前工作空间根；不含子模块",
        }
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        return {
            "git_installed": True,
            "repo_initialized": False,
            "git_root": None,
            "git_root_display": None,
            "scope_note": "仅当前工作空间根；不含子模块",
        }
    return {
        "git_installed": True,
        "repo_initialized": True,
        "git_root": str(git_root),
        "git_root_display": format_resolved_under_workspace(git_root, ws),
        "scope_note": "仅当前工作空间根；不含子模块",
    }


def git_changes(workspace: Path) -> dict[str, Any]:
    ws = workspace_root(workspace)
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        return _empty_changes()

    proc = run_git(git_root, "status", "--porcelain", "-u")
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git status 失败（退出码 {proc.returncode}）")

    entries: list[dict[str, Any]] = []
    changes: list[dict[str, Any]] = []
    untracked: list[dict[str, Any]] = []
    staged: list[dict[str, Any]] = []

    for line in (proc.stdout or "").splitlines():
        entry = _parse_porcelain_line(line)
        if not entry:
            continue
        entries.append(entry)
        if entry.get("untracked"):
            untracked.append({**entry, "section": "untracked"})
        elif entry.get("has_worktree_change"):
            changes.append({**entry, "section": "changes"})
        if entry.get("has_staged_change"):
            staged.append({**entry, "section": "staged"})

    return {
        "entries": entries,
        "changes": changes,
        "untracked": untracked,
        "staged": staged,
        "staged_count": len(staged),
        "unstaged_count": len(changes) + len(untracked),
        "untracked_count": len(untracked),
    }


def git_init(workspace: Path) -> dict[str, Any]:
    ws = workspace_root(workspace)
    if git_root_for_workspace(ws) is not None:
        raise ValueError("工作空间根目录已存在 .git")
    proc = run_git(ws, "init")
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git init 失败（退出码 {proc.returncode}）")
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        raise RuntimeError("git init 后仍未检测到 .git")
    return {
        "ok": True,
        "git_root": str(git_root),
        "git_root_display": format_resolved_under_workspace(git_root, ws),
    }


def git_stage(workspace: Path, rel_paths: list[str]) -> dict[str, Any]:
    ws = workspace_root(workspace)
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        raise ValueError("当前工作空间根未初始化 Git")
    paths = [normalize_repo_rel(p) for p in rel_paths if p.strip()]
    if not paths:
        raise ValueError("请指定至少一个文件路径")
    proc = run_git(git_root, "add", "--", *paths)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git add 失败（退出码 {proc.returncode}）")
    return {"staged": paths}


COMMIT_MESSAGE_MAX_LEN = 4096


class GitCommitConfigError(RuntimeError):
    """Git user.name / user.email 未配置。"""


def _commit_config_hint(stderr: str) -> bool:
    lower = stderr.lower()
    return (
        "user.name" in lower
        or "user.email" in lower
        or "author identity unknown" in lower
        or "please tell me who you are" in lower
    )


def git_commit(workspace: Path, message: str) -> dict[str, Any]:
    ws = workspace_root(workspace)
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        raise ValueError("当前工作空间根未初始化 Git")

    msg = message.strip()
    if not msg:
        raise ValueError("提交说明不能为空")
    if len(msg) > COMMIT_MESSAGE_MAX_LEN:
        raise ValueError(f"提交说明不能超过 {COMMIT_MESSAGE_MAX_LEN} 字符")

    payload = git_changes(ws)
    staged_paths = [str(entry["path"]) for entry in payload["staged"]]
    if not staged_paths:
        raise ValueError("没有已暂存的改动，请先点 + 暂存")

    proc = run_git(git_root, "commit", "-m", msg)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        if _commit_config_hint(err):
            raise GitCommitConfigError(
                "Git 未配置 user.name / user.email，请在本机执行 "
                "git config user.name 与 git config user.email"
            )
        raise RuntimeError(err or f"git commit 失败（退出码 {proc.returncode}）")

    sha_proc = run_git(git_root, "rev-parse", "HEAD")
    commit_sha = (sha_proc.stdout or "").strip()
    if sha_proc.returncode != 0 or not commit_sha:
        commit_sha = ""
    else:
        commit_sha = commit_sha[:7]

    return {
        "commit_sha": commit_sha,
        "committed_paths": staged_paths,
        "message": msg,
    }


def git_restore(workspace: Path, rel_paths: list[str], *, scope: str = "worktree") -> dict[str, Any]:
    ws = workspace_root(workspace)
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        raise ValueError("当前工作空间根未初始化 Git")
    if scope not in ("worktree", "staged", "untracked"):
        raise ValueError("scope 须为 worktree、staged 或 untracked")
    paths = [normalize_repo_rel(p) for p in rel_paths if p.strip()]
    if not paths:
        raise ValueError("请指定至少一个文件路径")

    if scope == "staged":
        proc = run_git(git_root, "restore", "--staged", "--", *paths)
    elif scope == "untracked":
        proc = run_git(git_root, "clean", "-fd", "--", *paths)
    else:
        proc = run_git(git_root, "restore", "--", *paths)
        if proc.returncode != 0:
            proc = run_git(git_root, "checkout", "HEAD", "--", *paths)
    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git restore 失败（退出码 {proc.returncode}）")
    return {"restored": paths, "scope": scope}


def git_diff(
    workspace: Path,
    rel: str,
    *,
    scope: str = "worktree",
    context_lines: int = 3,
) -> dict[str, Any]:
    ws = workspace_root(workspace)
    git_root = git_root_for_workspace(ws)
    if git_root is None:
        raise ValueError("当前工作空间根未初始化 Git")
    if scope not in ("worktree", "staged"):
        raise ValueError("scope 须为 worktree 或 staged")

    full, rel_norm = resolve_repo_rel(ws, rel)
    if not full.is_file():
        raise ValueError(f"文件不存在: {rel}")

    if scope == "staged":
        proc = run_git(git_root, "diff", "--cached", f"-U{context_lines}", "--", rel_norm)
    else:
        proc = run_git(git_root, "diff", f"-U{context_lines}", "--", rel_norm)
    if proc.returncode not in (0, 1):
        err = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(err or f"git diff 失败（退出码 {proc.returncode}）")

    text = proc.stdout or ""
    if _is_binary_diff(text):
        return {
            "path": rel_norm,
            "scope": scope,
            "has_diff": True,
            "is_binary": True,
            "unified_diff": "",
            "truncated": False,
            "message": "二进制文件有变更，无法在 Web 中预览 diff",
        }
    if not text.strip():
        return {
            "path": rel_norm,
            "scope": scope,
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
        "path": rel_norm,
        "scope": scope,
        "has_diff": True,
        "is_binary": False,
        "unified_diff": text,
        "truncated": truncated,
        "message": None,
    }
