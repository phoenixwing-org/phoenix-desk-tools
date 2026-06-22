"""用户偏好：启动器（本机 ``launcher.json``）+ 工作空间偏好（``phoenix-workspace.sqlite``）。"""

from __future__ import annotations

import json
import os
import posixpath
import tempfile
from copy import deepcopy
from pathlib import Path
from typing import Any

from phoenix.config.launcher_paths import platform_launcher_prefs_file
from phoenix.config.nav_modules import (
    DEFAULT_NAV_MODULES_ENABLED,
    enabled_from_module_scope,
    module_scope_from_enabled,
    normalize_module_scope,
    normalize_nav_modules_enabled,
    normalized_nav_modules,
    normalized_workspace_nav_modules,
)

WORKSPACE_PHOENIX_DIR = ".phoenix"
WORKSPACE_PREFS_BASENAME = "phoenix-workspace-prefs.json"
# 读取兼容；新写入仅用 ``resolve_workspace_prefs_basename()`` 的返回值
_LEGACY_WORKSPACE_PREFS_BASENAMES = ("phoenix-freecad-desktop.json",)
_LEGACY_ROOT_DOTFILE_NAME = ".phoenix-freecad-desktop.json"
WORKSPACE_DOTFILE_NAME = f"{WORKSPACE_PHOENIX_DIR}/{WORKSPACE_PREFS_BASENAME}"
_ENV_WORKSPACE_PREFS_BASENAME = "PHOENIX_WORKSPACE_PREFS"


def resolve_workspace_prefs_basename() -> str:
    """工作空间偏好 JSON 文件名；可用 ``PHOENIX_WORKSPACE_PREFS`` 覆盖。"""
    env = os.environ.get(_ENV_WORKSPACE_PREFS_BASENAME, "").strip()
    return env or WORKSPACE_PREFS_BASENAME

MAX_RECENT_WORKSPACES = 10

# phoenix-desk-tools 源码/安装根（≠ 用户 CAD 工作空间）
_TOOL_REPO_ROOT = Path(__file__).resolve().parents[2]


def tool_repo_root() -> Path:
    """本工具仓库根目录（``phoenix-desk-tools``，非 CAD 工作空间）。"""
    return _TOOL_REPO_ROOT


def default_browse_directory() -> Path:
    """选目录对话框默认位置：用户「文档」目录。"""
    docs = Path.home() / "Documents"
    if docs.is_dir():
        return docs.expanduser().resolve(strict=False)
    return Path.home().expanduser().resolve(strict=False)


def is_tool_install_path(path: Path) -> bool:
    """工具源码/安装目录，不能作为 CAD 工作空间根。"""
    try:
        p = path.expanduser().resolve(strict=False)
        root = tool_repo_root().resolve(strict=False)
    except (OSError, RuntimeError):
        return False
    return p == root


def resolve_startup_workspace_path() -> Path | None:
    """启动时工作空间：launcher 最近项；无记录时不退回 cwd/工具目录。"""
    prune_recent_workspaces(persist=True)
    for p in get_recent_workspaces():
        if p.is_dir():
            return p.resolve()
    return None

# 临时 / 测试目录名片段：不应进入「最近工作空间」
_EPHEMERAL_DIR_NAME_MARKERS = (
    "fcstd_map_svc_",
    "fcstd_map_emb_",
    "fcstd_map_lbl_",
    "fcstd_map_mig_",
    "cad_map_types_",
    "cad_pdf_pn_",
    "ws_tree_",
    "bom_prefs_",
    "phoenix_rename_",
    "phoenix_kind_",
    "phoenix_embedded_",
    "phoenix_xlink_",
)

_WORKSPACE_SECTIONS = (
    "fc_linkfix",
    "fcstd_map",
    "step_batch",
    "sw_step_export",
    "part_dedup",
    "bom_apply",
    "code_reorder",
    "code_rename",
    "code_ignore",
    "nav_modules",
)

_WORKSPACE_DEFAULT: dict[str, Any] = {
    "PartVersion": 1,
    "fc_linkfix": {
        "freecad_batch_dir": None,
        "dry_run": True,
        "all_in_dir": True,
    },
    "fcstd_map": {"scan_root": None, "force_update_part_name": False},  # scan_root 已废弃，恒为 None
    "step_batch": {
        "step_dir": None,
        "out_dir": None,
        "skip_existing": True,
        "view_fit": "none",
        "use_inbox_bridge": False,
        "step_recursive": False,
    },
    "sw_step_export": {
        "source_dir": None,
        "out_step_dir": None,
        "recursive_scan": False,
    },
    "part_dedup": {
        "extension": ".SLDPRT",
        "code_len": 6,
        "ver_len": 3,
        "check_code": True,
        "check_version": True,
        "code_must_be_digit": True,
        "scan_dir": None,
    },
    "bom_apply": {
        "last_part_number": "",
        "last_part_version": "001",
        "last_type_code": "H",
        "last_model_series": "",
    },
    "code_reorder": {
        "include_cpp": True,
        "include_header": True,
        "sort_members": False,
        "verbose": False,
        "last_selected": [],
    },
    "code_rename": {
        "old": "",
        "new": "",
        "levels": ["text"],
        "scope": "",
        "target_encoding": "utf-8",
        "include_ignored": False,
        "rescan_index": False,
    },
    "code_ignore": {
        "custom_ignore": [],
        "ignore_preset": "",
    },
    "nav_modules": {
        "scope": "all",
    },
}

_LAUNCHER_SHELL_LAYOUT_DEFAULT: dict[str, Any] = {
    "nav_rail_mode": 0,  # 0 窄仅图标 · 1 宽图标+文字
    "ribbon_mode": 1,  # 已固定 Ribbon 壳层；字段保留兼容旧 launcher.json
    "right_panel_open": True,
    "mid_right_sash_px": None,  # Panedwindow 首根 sash 距左侧像素；None 表示由窗口宽度推导默认
    "left_panel_width_px": 300,  # Web 左侧停靠栏宽度
    "right_panel_width_px": 300,  # Web 右侧停靠栏宽度
    "log_panel_open": True,
    "log_panel_height_px": 180,
    "log_auto_open_on_append": True,
    "workspace_tree_dock": "right",  # left | right
    "shell_log_dock": "right",  # left | right
    "properties_panel_open": True,
    "properties_panel_height_px": 220,
    "properties_panel_dock": "left",  # left | right
    "properties_name_col_width_px": 132,
}


def _normalized_shell_layout(raw: Any) -> dict[str, Any]:
    merged = dict(_LAUNCHER_SHELL_LAYOUT_DEFAULT)
    if not isinstance(raw, dict):
        return merged
    nm = raw.get("nav_rail_mode")
    if nm in (0, 1):
        merged["nav_rail_mode"] = int(nm)
    ro = raw.get("right_panel_open")
    if isinstance(ro, bool):
        merged["right_panel_open"] = ro
    spx = raw.get("mid_right_sash_px")
    if isinstance(spx, int) and spx > 0:
        merged["mid_right_sash_px"] = int(spx)
    elif raw.get("mid_right_sash_px") is None:
        merged["mid_right_sash_px"] = None
    rpw = raw.get("right_panel_width_px")
    if isinstance(rpw, int) and rpw > 0:
        merged["right_panel_width_px"] = int(rpw)
    lpw = raw.get("left_panel_width_px")
    if isinstance(lpw, int) and lpw > 0:
        merged["left_panel_width_px"] = int(lpw)
    elif isinstance(merged.get("right_panel_width_px"), int):
        merged["left_panel_width_px"] = int(merged["right_panel_width_px"])
    lpo = raw.get("log_panel_open")
    if isinstance(lpo, bool):
        merged["log_panel_open"] = lpo
    lph = raw.get("log_panel_height_px")
    if isinstance(lph, int) and lph >= 80:
        merged["log_panel_height_px"] = int(lph)
    lao = raw.get("log_auto_open_on_append")
    if isinstance(lao, bool):
        merged["log_auto_open_on_append"] = lao
    wtd = raw.get("workspace_tree_dock")
    if wtd in ("left", "right"):
        merged["workspace_tree_dock"] = str(wtd)
    sld = raw.get("shell_log_dock")
    if sld in ("left", "right"):
        merged["shell_log_dock"] = str(sld)
    ppo = raw.get("properties_panel_open")
    if isinstance(ppo, bool):
        merged["properties_panel_open"] = ppo
    pph = raw.get("properties_panel_height_px")
    if isinstance(pph, int) and pph >= 80:
        merged["properties_panel_height_px"] = int(pph)
    ppd = raw.get("properties_panel_dock")
    if ppd in ("left", "right"):
        merged["properties_panel_dock"] = str(ppd)
    pnc = raw.get("properties_name_col_width_px")
    if isinstance(pnc, int) and pnc >= 72:
        merged["properties_name_col_width_px"] = min(240, int(pnc))
    rm = raw.get("ribbon_mode")
    if rm in (0, 1):
        merged["ribbon_mode"] = int(rm)
    return merged


def _normalized_test_fixtures(raw: Any) -> dict[str, Any]:
    """launcher.json → test_fixtures（检出根目录、勾选列表）。"""
    base: dict[str, Any] = {
        "checkout_root": None,
        "enabled": [],
    }
    if not isinstance(raw, dict):
        return base
    cr = raw.get("checkout_root")
    if cr is not None:
        s = str(cr).strip()
        base["checkout_root"] = s if s else None
    en = raw.get("enabled")
    if isinstance(en, list):
        seen: set[str] = set()
        out: list[str] = []
        for item in en:
            name = str(item).strip()
            if name and name not in seen:
                seen.add(name)
                out.append(name)
        base["enabled"] = out
    return base


_LAUNCHER_DEFAULT: dict[str, Any] = {
    "version": 2,
    "recent_workspaces": [],
    "freecad_dir": None,
    "window_geometry": None,
    "shell_layout": dict(_LAUNCHER_SHELL_LAYOUT_DEFAULT),
    "nav_modules": {"enabled": list(DEFAULT_NAV_MODULES_ENABLED)},
    "test_fixtures": {
        "checkout_root": None,
        "enabled": [],
    },
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def launcher_prefs_file() -> Path:
    """启动器 JSON：``PHOENIX_LAUNCHER_CONFIG`` 或本机 ``…/phoenix-wing/phoenix/launcher.json``。"""
    env = os.environ.get("PHOENIX_LAUNCHER_CONFIG", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return platform_launcher_prefs_file()


def _launcher_prefs_write_path() -> Path:
    return launcher_prefs_file()


def _resolve_path_for_storage(path_like: Any) -> str | None:
    if path_like is None:
        return None
    s = str(path_like).strip()
    if not s:
        return None
    try:
        return str(Path(s).expanduser().resolve(strict=False))
    except OSError:
        return None


def _recent_workspace_paths_from_raw(raw: dict[str, Any] | None) -> list[str]:
    """从 launcher JSON 提取最近工作空间（含 v1 ``toolbar.repo_root``）。"""
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()

    def add(path_like: Any) -> None:
        resolved = _resolve_path_for_storage(path_like)
        if not resolved or resolved in seen:
            return
        seen.add(resolved)
        out.append(resolved)

    recent = raw.get("recent_workspaces")
    if isinstance(recent, list):
        for item in recent:
            add(item)

    toolbar = raw.get("toolbar")
    if isinstance(toolbar, dict):
        add(toolbar.get("repo_root"))

    return out


def workspace_phoenix_dir(repo_root: Path) -> Path:
    return repo_root.expanduser().resolve(strict=False) / WORKSPACE_PHOENIX_DIR


def workspace_dotfile_path(repo_root: Path) -> Path:
    return workspace_phoenix_dir(repo_root) / resolve_workspace_prefs_basename()


def _legacy_workspace_prefs_paths(repo_root: Path) -> list[Path]:
    rr = repo_root.expanduser().resolve(strict=False)
    ph = workspace_phoenix_dir(rr)
    paths: list[Path] = []
    for name in _LEGACY_WORKSPACE_PREFS_BASENAMES:
        paths.append(ph / name)
    paths.append(rr / _LEGACY_ROOT_DOTFILE_NAME)
    return paths


def _migrate_workspace_prefs_if_needed(repo_root: Path) -> None:
    """旧 dotfile 存在且新文件缺失时，复制到新路径（不删旧文件）。"""
    target = workspace_dotfile_path(repo_root)
    if target.is_file():
        return
    for legacy in _legacy_workspace_prefs_paths(repo_root):
        if not legacy.is_file() or legacy == target:
            continue
        raw = _read_json(legacy)
        if not raw:
            return
        target.parent.mkdir(parents=True, exist_ok=True)
        _write_json(target, raw)
        return


def store_path_under_repo(path: Path, repo_root: Path) -> str:
    p = path.expanduser().resolve()
    rr = repo_root.expanduser().resolve()
    try:
        return _canonical_repo_relative_posix(p.relative_to(rr).as_posix())
    except ValueError:
        return str(p)


def _canonical_repo_relative_posix(rel_posix: str) -> str:
    """将 relative_to(workspace) 的结果规范为稳定的 posix（去掉 `./`、`foo/../bar`）。"""
    raw = rel_posix.replace("\\", "/").strip()
    if not raw or raw == ".":
        return "."
    n = posixpath.normpath(raw)
    if not n or n == ".":
        return "."
    if n.startswith("../"):
        # 不应出现在在工作空间树根下的路径；退回未规范串以免误裁剪
        return raw
    return n


def format_relative_workspace_for_ui(canonical_under_repo: str) -> str:
    """界面展示用：明示「相对工作空间根」的路径前加 `./`（存盘仍为 canonical 无前缀）。"""
    if not (canonical_under_repo or "").strip():
        return ""
    s = canonical_under_repo.replace("\\", "/").strip()
    if s == ".":
        return "."
    if s.startswith("../"):
        return s
    if s.startswith("./"):
        n = posixpath.normpath(s)
        if not n or n == ".":
            return "."
        if n.startswith("../"):
            return n
        return "./" + n
    return "./" + s


def format_resolved_under_workspace(abs_path: Path, repo_root: Path) -> str:
    """用于界面展示：落在工作空间内则 `./` + 相对 posix（已 canonical），否则绝对路径。"""
    p = abs_path.expanduser().resolve(strict=False)
    rr = repo_root.expanduser().resolve(strict=False)
    try:
        raw_rel = p.relative_to(rr).as_posix()
        canon = _canonical_repo_relative_posix(raw_rel)
        return format_relative_workspace_for_ui(canon)
    except ValueError:
        return str(p.expanduser())


def format_stored_path_for_display(stored: str | None, repo_root: Path) -> str | None:
    """从配置文件读到的路径字段 → 输入框显示的字符串（与工作空间内存相对、外部存绝对的习惯一致）。"""
    resolved = resolve_pref_path(stored, repo_root)
    if resolved is None:
        return None
    return format_resolved_under_workspace(resolved, repo_root)


def shorten_workspace_relative_display(text: str) -> str:
    """工作空间树下路径的占位展示：等价于 roots 或未填相对目录 → 输入框固定为 ``'.'``。"""
    s = (text or "").strip()
    return "." if not s or s == "." else s


def format_absolute_config_path(path: Path | str | None) -> str:
    """配置页、启动器等：路径展示一律为规范化绝对路径（不参与工作空间相对缩略）。"""
    if path is None:
        return ""
    s = str(path).strip()
    if not s:
        return ""
    return str(Path(s).expanduser().resolve(strict=False))


def resolve_workspace_path_entry(text: str, repo_root: Path) -> Path:
    """解析输入框相对于工作空间的目录：空白或 '.' → 工作空间根。"""
    rr = repo_root.expanduser().resolve(strict=False)
    raw = (text or "").strip()
    if not raw or raw == ".":
        return rr
    q = Path(raw).expanduser()
    if q.is_absolute():
        return q.resolve(strict=False)
    rel = posixpath.normpath(raw.replace("\\", "/"))
    return (rr / rel).resolve(strict=False)


def normalize_workspace_subpath(rel: str) -> str:
    """与工作空间根拼接用的 **相对片断**：统一到无前导 './' / 冗余斜杠 的 posix 式样。"""
    t = (rel or "").strip().replace("\\", "/")
    if not t:
        return ""
    n = posixpath.normpath(t)
    if n in (".", "/"):
        return ""
    if n.startswith("../"):
        return n.lstrip("/")
    while n.startswith("./"):
        n = n[2:]
    return n.lstrip("/")


def resolve_pref_path(stored: str | None, repo_root: Path) -> Path | None:
    if stored is None or not str(stored).strip():
        return None
    s = str(stored).strip()
    if Path(s).is_absolute():
        return Path(s).expanduser().resolve(strict=False)
    return (repo_root.expanduser().resolve(strict=False) / Path(s)).resolve(strict=False)


def _read_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def load_launcher_prefs() -> dict[str, Any]:
    data = deepcopy(_LAUNCHER_DEFAULT)
    raw = _read_json(launcher_prefs_file())
    if not raw:
        return data
    if isinstance(raw.get("version"), int):
        data["version"] = raw["version"]
    recent = raw.get("recent_workspaces")
    if isinstance(recent, list):
        data["recent_workspaces"] = [str(p) for p in recent if p]
    fd = raw.get("freecad_dir")
    if fd is not None:
        data["freecad_dir"] = str(fd)
    # v1 兼容：toolbar.freecad_dir
    toolbar = raw.get("toolbar")
    if isinstance(toolbar, dict) and toolbar.get("freecad_dir") and not data.get("freecad_dir"):
        data["freecad_dir"] = str(toolbar["freecad_dir"])
    wg = raw.get("window_geometry")
    if isinstance(wg, str) and wg.strip():
        data["window_geometry"] = wg.strip()
    data["shell_layout"] = _normalized_shell_layout(raw.get("shell_layout"))
    data["nav_modules"] = normalized_nav_modules(raw.get("nav_modules"))
    data["test_fixtures"] = _normalized_test_fixtures(raw.get("test_fixtures"))
    return data


def save_launcher_window_geometry(geom: str) -> None:
    """主窗口 WxH+X+Y，写入 launcher JSON（仅存尺寸位置，与各工作空间无关）。"""
    launcher = load_launcher_prefs()
    launcher["window_geometry"] = geom.strip()
    save_launcher_prefs(launcher)


def save_launcher_shell_layout(
    *,
    nav_rail_mode: int | None = None,
    ribbon_mode: int | None = None,
    right_panel_open: bool | None = None,
    mid_right_sash_px: int | None = None,
    left_panel_width_px: int | None = None,
    right_panel_width_px: int | None = None,
    log_panel_open: bool | None = None,
    log_panel_height_px: int | None = None,
    log_auto_open_on_append: bool | None = None,
    workspace_tree_dock: str | None = None,
    shell_log_dock: str | None = None,
    properties_panel_open: bool | None = None,
    properties_panel_height_px: int | None = None,
    properties_panel_dock: str | None = None,
    properties_name_col_width_px: int | None = None,
) -> None:
    """将左侧导航宽窄 / 右栏开合 / 中右分割 sash / 运行日志窗 写入 launcher JSON。"""
    launcher = load_launcher_prefs()
    cur = _normalized_shell_layout(launcher.get("shell_layout"))
    if nav_rail_mode is not None and int(nav_rail_mode) in (0, 1):
        cur["nav_rail_mode"] = int(nav_rail_mode)
    if ribbon_mode is not None and int(ribbon_mode) in (0, 1):
        cur["ribbon_mode"] = int(ribbon_mode)
    if right_panel_open is not None:
        cur["right_panel_open"] = bool(right_panel_open)
    if mid_right_sash_px is not None:
        cur["mid_right_sash_px"] = int(mid_right_sash_px)
    if left_panel_width_px is not None:
        cur["left_panel_width_px"] = max(160, min(560, int(left_panel_width_px)))
    if right_panel_width_px is not None:
        cur["right_panel_width_px"] = max(160, min(560, int(right_panel_width_px)))
    if log_panel_open is not None:
        cur["log_panel_open"] = bool(log_panel_open)
    if log_panel_height_px is not None:
        cur["log_panel_height_px"] = max(80, int(log_panel_height_px))
    if log_auto_open_on_append is not None:
        cur["log_auto_open_on_append"] = bool(log_auto_open_on_append)
    if workspace_tree_dock in ("left", "right"):
        cur["workspace_tree_dock"] = str(workspace_tree_dock)
    if shell_log_dock in ("left", "right"):
        cur["shell_log_dock"] = str(shell_log_dock)
    if properties_panel_open is not None:
        cur["properties_panel_open"] = bool(properties_panel_open)
    if properties_panel_height_px is not None:
        cur["properties_panel_height_px"] = max(80, int(properties_panel_height_px))
    if properties_panel_dock in ("left", "right"):
        cur["properties_panel_dock"] = str(properties_panel_dock)
    if properties_name_col_width_px is not None:
        cur["properties_name_col_width_px"] = max(72, min(240, int(properties_name_col_width_px)))
    launcher["shell_layout"] = cur
    save_launcher_prefs(launcher)


def save_launcher_nav_modules(enabled: list[str]) -> dict[str, Any]:
    """写入侧栏模块勾选（``cad`` / ``code``）到 launcher JSON。"""
    launcher = load_launcher_prefs()
    launcher["nav_modules"] = normalized_nav_modules({"enabled": enabled})
    save_launcher_prefs(launcher)
    return dict(launcher["nav_modules"])


def save_launcher_prefs(data: dict[str, Any]) -> None:
    _write_json(_launcher_prefs_write_path(), data)


def reset_launcher_prefs_to_factory() -> dict[str, Any]:
    """将本机 launcher.json 恢复为出厂默认（最近工作空间、FreeCAD、壳层布局等）。"""
    data = deepcopy(_LAUNCHER_DEFAULT)
    save_launcher_prefs(data)
    return data


def get_recent_workspaces() -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    for item in load_launcher_prefs().get("recent_workspaces") or []:
        try:
            p = Path(str(item)).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        key = str(p)
        if key in seen or not p.is_dir() or is_ephemeral_workspace_path(p):
            continue
        seen.add(key)
        out.append(p)
    return out


def is_ephemeral_workspace_path(path: Path) -> bool:
    """系统临时目录或开发/单测用的临时工作空间，不应记入「最近打开」。"""
    try:
        p = path.expanduser().resolve(strict=False)
    except (OSError, RuntimeError):
        return True
    name = p.name
    if any(marker in name for marker in _EPHEMERAL_DIR_NAME_MARKERS):
        return True
    try:
        tmp_root = Path(tempfile.gettempdir()).resolve(strict=False)
        if p == tmp_root or tmp_root in p.parents:
            return True
    except (OSError, RuntimeError):
        pass
    parts = p.parts
    if len(parts) >= 3 and parts[1] == "var" and parts[2] == "folders":
        return True
    if len(parts) >= 2 and parts[1] == "tmp":
        return True
    if is_tool_install_path(p):
        return True
    return False


def list_recent_workspace_paths_raw() -> list[Path]:
    """launcher.json 中的最近列表（含目录已不存在项，去重保序）。"""
    out: list[Path] = []
    seen: set[str] = set()
    for item in load_launcher_prefs().get("recent_workspaces") or []:
        try:
            p = Path(str(item)).expanduser().resolve(strict=False)
        except (OSError, RuntimeError):
            continue
        key = str(p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def prune_recent_workspaces(*, persist: bool = True) -> int:
    """移除临时目录等不应保留的最近项；返回删除条数。"""
    launcher = load_launcher_prefs()
    recent = launcher.get("recent_workspaces") or []
    kept: list[str] = []
    removed = 0
    seen: set[str] = set()
    for item in recent:
        try:
            p = Path(str(item)).expanduser().resolve(strict=False)
            key = str(p)
        except (OSError, RuntimeError):
            key = str(item).strip()
            p = None
        if key in seen:
            removed += 1
            continue
        seen.add(key)
        if p is not None and is_ephemeral_workspace_path(p):
            removed += 1
            continue
        kept.append(str(item))
    if removed and persist:
        launcher["recent_workspaces"] = kept
        save_launcher_prefs(launcher)
    return removed


def remove_recent_workspace(repo_root: Path) -> bool:
    """从最近列表移除一项（按规范化路径匹配）。"""
    target = _normalize_path_key(repo_root)
    launcher = load_launcher_prefs()
    recent = launcher.get("recent_workspaces") or []
    kept: list[str] = []
    removed = False
    for item in recent:
        if _paths_equal(item, target):
            removed = True
            continue
        kept.append(str(item))
    if not removed:
        return False
    launcher["recent_workspaces"] = kept
    save_launcher_prefs(launcher)
    return True


def record_recent_workspace(repo_root: Path) -> None:
    rp = repo_root.expanduser().resolve()
    if not rp.is_dir() or is_ephemeral_workspace_path(rp):
        return
    launcher = load_launcher_prefs()
    recent = [str(rp)]
    for item in launcher.get("recent_workspaces") or []:
        s = str(item)
        if s != str(rp):
            recent.append(s)
    launcher["recent_workspaces"] = recent[:MAX_RECENT_WORKSPACES]
    save_launcher_prefs(launcher)


def save_launcher_freecad_dir(path: Path | None) -> None:
    launcher = load_launcher_prefs()
    launcher["freecad_dir"] = str(path.resolve()) if path and path.is_dir() else None
    save_launcher_prefs(launcher)


def load_workspace_prefs(repo_root: Path) -> dict[str, Any]:
    from phoenix.config.workspace_prefs_store import import_dotfile_to_sqlite_if_needed, load_prefs_from_sqlite

    _migrate_workspace_prefs_if_needed(repo_root)
    import_dotfile_to_sqlite_if_needed(repo_root)
    data = deepcopy(_WORKSPACE_DEFAULT)
    raw = load_prefs_from_sqlite(repo_root)
    if not raw:
        # 无 SQLite 数据时仍可读 JSON（只读回退，不写）
        raw = _read_json(workspace_dotfile_path(repo_root)) or {}
    for key in _WORKSPACE_SECTIONS:
        inc = raw.get(key)
        if isinstance(inc, dict) and isinstance(data[key], dict):
            data[key].update(inc)
    if isinstance(raw.get("version"), int):
        data["version"] = raw["version"]
    return data


def save_workspace_prefs(repo_root: Path, data: dict[str, Any]) -> None:
    from phoenix.config.workspace_prefs_store import save_prefs_to_sqlite

    save_prefs_to_sqlite(repo_root, data)


def merge_workspace_section(section: str, patch: dict[str, Any], repo_root: Path) -> dict[str, Any]:
    rp = repo_root.expanduser().resolve()
    dat = load_workspace_prefs(rp)
    cur = dat.get(section)
    if not isinstance(cur, dict):
        cur = {}
        dat[section] = cur
    for k, v in patch.items():
        if v is None:
            cur.pop(k, None)
        else:
            cur[k] = v
    save_workspace_prefs(rp, dat)
    return dat


def load_workspace_nav_modules(repo_root: Path) -> dict[str, Any]:
    prefs = load_workspace_prefs(repo_root)
    block = prefs.get("nav_modules")
    return normalized_workspace_nav_modules(block)


def save_workspace_nav_modules(
    repo_root: Path,
    *,
    scope: str | None = None,
    enabled: list[str] | None = None,
) -> dict[str, Any]:
    rp = repo_root.expanduser().resolve()
    if scope is not None:
        norm_scope = normalize_module_scope(scope)
        payload = {
            "scope": norm_scope,
            "enabled": enabled_from_module_scope(norm_scope),
        }
    elif enabled is not None:
        norm_enabled = normalize_nav_modules_enabled(enabled)
        payload = {
            "scope": module_scope_from_enabled(norm_enabled),
            "enabled": norm_enabled,
        }
    else:
        raise ValueError("需要 scope 或 enabled")
    merge_workspace_section("nav_modules", payload, rp)
    return payload


def apply_launcher_prefs_to_state(state: Any) -> None:
    """启动时：最近工作空间 + 本机 FreeCAD 安装目录。"""
    launcher = load_launcher_prefs()
    for p in get_recent_workspaces():
        state.repo_root = p
        break
    fd = launcher.get("freecad_dir")
    if fd:
        p = Path(str(fd)).expanduser().resolve()
        if p.is_dir():
            state.freecad_dir = p


def set_active_workspace(repo_root: Path, state: Any) -> None:
    rp = repo_root.expanduser().resolve()
    if not rp.is_dir():
        raise ValueError(f"不是有效目录: {rp}")
    if is_tool_install_path(rp):
        raise ValueError(
            f"不能使用 phoenix-desk-tools 工具目录作为 CAD 工作空间: {rp}"
        )
    state.repo_root = rp
    record_recent_workspace(rp)


def _normalize_path_key(path: Path | str) -> str:
    try:
        return str(Path(str(path)).expanduser().resolve(strict=False))
    except (OSError, RuntimeError):
        return str(path).strip()


def _paths_equal(a: Path | str, b: Path | str) -> bool:
    return _normalize_path_key(a) == _normalize_path_key(b)
