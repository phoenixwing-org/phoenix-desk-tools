"""STEP 目录扫描与固定层级路径（不依赖 FreeCAD）。"""

from __future__ import annotations

from pathlib import Path


def _is_step_filename(name: str) -> bool:
    lower = name.lower()
    return lower.endswith(".stp") or lower.endswith(".step")


def iter_step_paths(step_dir: Path | str):
    """排序列出目录下 .stp / .step（不含子目录）。"""
    step_dir = Path(step_dir).expanduser().resolve()
    if not step_dir.is_dir():
        raise NotADirectoryError(str(step_dir))
    names: list[str] = []
    for name in step_dir.iterdir():
        if not name.is_file():
            continue
        if _is_step_filename(name.name):
            names.append(name.name)
    for name in sorted(names):
        yield step_dir / name


def iter_step_paths_recursive(step_dir: Path | str):
    """递归列出子树内全部 .stp / .step（按相对路径排序）。"""
    step_dir = Path(step_dir).expanduser().resolve()
    if not step_dir.is_dir():
        raise NotADirectoryError(str(step_dir))
    hits: list[Path] = []
    for p in step_dir.rglob("*"):
        if not p.is_file():
            continue
        if _is_step_filename(p.name):
            hits.append(p)
    hits.sort(key=lambda q: q.resolve().as_posix().lower())
    yield from hits


def step_tree_stats(step_dir: Path | str) -> tuple[int, int]:
    """返回 (仅顶层 STEP 数, 全树 STEP 总数)。"""
    step_dir = Path(step_dir).expanduser().resolve()
    if not step_dir.is_dir():
        raise NotADirectoryError(str(step_dir))
    top = 0
    total = 0
    for p in step_dir.rglob("*"):
        if not p.is_file():
            continue
        if not _is_step_filename(p.name):
            continue
        total += 1
        rel = p.relative_to(step_dir)
        if len(rel.parts) == 1:
            top += 1
    return top, total


def list_step_paths_for_batch(step_dir: Path | str, *, recursive: bool = False) -> list[Path]:
    """默认仅顶层；``recursive=True`` 时含子目录。"""
    if recursive:
        return list(iter_step_paths_recursive(step_dir))
    return list(iter_step_paths(step_dir))


def sample_step_fcstd_dirs(repo_root: Path | str, project_folder: str) -> tuple[Path, Path]:
    """约定：``{repo}/{project}/step`` 与 ``{repo}/{project}/FreeCAD``。"""
    root = Path(repo_root).expanduser().resolve()
    rel = (project_folder or "").strip().strip("/")
    if not rel:
        raise ValueError("project_folder 不能为空")
    step_dir = root / rel / "step"
    freecad_dir = root / rel / "FreeCAD"
    return step_dir, freecad_dir
