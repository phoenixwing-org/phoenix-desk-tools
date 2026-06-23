from __future__ import annotations

from pathlib import Path


def workspace_root(path: Path) -> Path:
    return path.expanduser().resolve(strict=False)


def git_root_for_workspace(workspace: Path) -> Path | None:
    """仅当工作空间根存在 .git 时返回该根（不向上找父仓）。"""
    ws = workspace_root(workspace)
    if not ws.is_dir():
        return None
    if (ws / ".git").exists():
        return ws
    return None


def normalize_repo_rel(rel: str) -> str:
    rel_norm = rel.replace("\\", "/").strip()
    if rel_norm.startswith("./"):
        rel_norm = rel_norm[2:]
    if not rel_norm or ".." in rel_norm.split("/"):
        raise ValueError(f"非法路径: {rel}")
    return rel_norm


def resolve_repo_rel(workspace: Path, rel: str) -> tuple[Path, str]:
    ws = workspace_root(workspace)
    rel_norm = normalize_repo_rel(rel)
    full = (ws / rel_norm).resolve(strict=False)
    try:
        full.relative_to(ws)
    except ValueError as e:
        raise ValueError(f"路径超出工作空间: {rel}") from e
    return full, rel_norm
