"""用户偏好：启动器（本机 ``launcher.json``）+ 工作空间 ``.phoenix/phoenix-freecad-desktop.json``。"""

from __future__ import annotations

import json
import os
import posixpath
from copy import deepcopy
from pathlib import Path
from typing import Any

from fcdesk.config.launcher_paths import legacy_flat_launcher_prefs_file, platform_launcher_prefs_file

WORKSPACE_PHOENIX_DIR = ".phoenix"
WORKSPACE_PREFS_BASENAME = "phoenix-freecad-desktop.json"
WORKSPACE_DOTFILE_LEGACY_NAME = ".phoenix-freecad-desktop.json"
# 界面 / API 展示用相对工作空间根的路径
WORKSPACE_DOTFILE_NAME = f"{WORKSPACE_PHOENIX_DIR}/{WORKSPACE_PREFS_BASENAME}"
MAX_RECENT_WORKSPACES = 10

_WORKSPACE_SECTIONS = ("fc_linkfix", "fcstd_map", "step_batch", "sw_step_export", "part_dedup", "bom_apply")

_WORKSPACE_DEFAULT: dict[str, Any] = {
    "PartVersion": 1,
    "fc_linkfix": {
        "freecad_batch_dir": None,
        "dry_run": True,
        "all_in_dir": True,
    },
    "fcstd_map": {"scan_root": None, "force_update_part_name": False},
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
}

_LAUNCHER_SHELL_LAYOUT_DEFAULT: dict[str, Any] = {
    "nav_rail_mode": 0,  # 0 窄仅图标 · 1 宽图标+文字
    "right_panel_open": True,
    "mid_right_sash_px": None,  # Panedwindow 首根 sash 距左侧像素；None 表示由窗口宽度推导默认
    "right_panel_width_px": 300,  # Web 右侧工作空间树宽度
    "log_panel_open": True,
    "log_panel_height_px": 180,
    "log_auto_open_on_append": True,
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
    lpo = raw.get("log_panel_open")
    if isinstance(lpo, bool):
        merged["log_panel_open"] = lpo
    lph = raw.get("log_panel_height_px")
    if isinstance(lph, int) and lph >= 80:
        merged["log_panel_height_px"] = int(lph)
    lao = raw.get("log_auto_open_on_append")
    if isinstance(lao, bool):
        merged["log_auto_open_on_append"] = lao
    return merged


_LAUNCHER_DEFAULT: dict[str, Any] = {
    "version": 2,
    "recent_workspaces": [],
    "freecad_dir": None,
    "window_geometry": None,
    "shell_layout": dict(_LAUNCHER_SHELL_LAYOUT_DEFAULT),
}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def web_launcher_prefs_file() -> Path:
    """旧路径 ``web-ui/.local/launcher.json``（仅迁移读取）。"""
    return _repo_root() / "web-ui" / ".local" / "launcher.json"


def legacy_launcher_prefs_file() -> Path:
    """桌面壳旧路径（兼容读取，写入时迁移到新路径）。"""
    return Path(__file__).resolve().parent / "workspace.custom.json"


def launcher_prefs_file() -> Path:
    """启动器 JSON 读取路径：环境变量 > 本机平台路径 > 旧 web-ui/.local > 旧 workspace.custom.json。"""
    env = os.environ.get("FCDESK_LAUNCHER_CONFIG", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    platform = platform_launcher_prefs_file()
    if platform.is_file():
        return platform
    web_path = web_launcher_prefs_file()
    if web_path.is_file():
        return web_path
    legacy = legacy_launcher_prefs_file()
    if legacy.is_file():
        return legacy
    return platform


def _launcher_prefs_write_path() -> Path:
    env = os.environ.get("FCDESK_LAUNCHER_CONFIG", "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return platform_launcher_prefs_file()


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


def _merge_launcher_prefs(web_raw: dict[str, Any] | None, legacy_raw: dict[str, Any] | None) -> dict[str, Any]:
    """合并两份 launcher 片段（legacy 最近项优先、补全 freecad 等）。"""
    base = deepcopy(_LAUNCHER_DEFAULT)
    if web_raw:
        for key in ("version", "recent_workspaces", "freecad_dir", "window_geometry"):
            if key in web_raw:
                base[key] = web_raw[key]
        if isinstance(web_raw.get("shell_layout"), dict):
            base["shell_layout"] = _normalized_shell_layout(web_raw["shell_layout"])

    merged_recent: list[str] = []
    seen: set[str] = set()
    for group in (_recent_workspace_paths_from_raw(legacy_raw), _recent_workspace_paths_from_raw(web_raw)):
        for p in group:
            if p not in seen:
                seen.add(p)
                merged_recent.append(p)
    base["recent_workspaces"] = merged_recent[:MAX_RECENT_WORKSPACES]

    if not base.get("freecad_dir") and legacy_raw:
        fd = legacy_raw.get("freecad_dir")
        if fd:
            base["freecad_dir"] = str(fd)
        toolbar = legacy_raw.get("toolbar")
        if isinstance(toolbar, dict) and toolbar.get("freecad_dir") and not base.get("freecad_dir"):
            base["freecad_dir"] = str(toolbar["freecad_dir"])

    if not base.get("window_geometry") and legacy_raw:
        wg = legacy_raw.get("window_geometry")
        if isinstance(wg, str) and wg.strip():
            base["window_geometry"] = wg.strip()

    if legacy_raw and isinstance(legacy_raw.get("shell_layout"), dict):
        if not web_raw or not isinstance(web_raw.get("shell_layout"), dict):
            base["shell_layout"] = _normalized_shell_layout(legacy_raw["shell_layout"])

    base["version"] = 2
    return base


def _launcher_storage_subset(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not raw:
        return {}
    out: dict[str, Any] = {}
    for key in ("version", "recent_workspaces", "freecad_dir", "window_geometry"):
        if key in raw:
            out[key] = raw[key]
    if isinstance(raw.get("shell_layout"), dict):
        out["shell_layout"] = _normalized_shell_layout(raw["shell_layout"])
    return out


def _merge_launcher_sources(*sources: dict[str, Any] | None) -> dict[str, Any]:
    """合并多份 launcher 来源；``sources`` 顺序越靠后，标量字段优先级越高。"""
    present = [s for s in sources if s]
    if not present:
        return deepcopy(_LAUNCHER_DEFAULT)

    merged = deepcopy(_LAUNCHER_DEFAULT)
    merged_recent: list[str] = []
    seen: set[str] = set()
    for raw in present:
        for p in _recent_workspace_paths_from_raw(raw):
            if p not in seen:
                seen.add(p)
                merged_recent.append(p)
    merged["recent_workspaces"] = merged_recent[:MAX_RECENT_WORKSPACES]

    for raw in reversed(present):
        if isinstance(raw.get("version"), int):
            merged["version"] = raw["version"]
        fd = raw.get("freecad_dir")
        if fd:
            merged["freecad_dir"] = str(fd)
        toolbar = raw.get("toolbar")
        if isinstance(toolbar, dict) and toolbar.get("freecad_dir") and not merged.get("freecad_dir"):
            merged["freecad_dir"] = str(toolbar["freecad_dir"])
        wg = raw.get("window_geometry")
        if isinstance(wg, str) and wg.strip():
            merged["window_geometry"] = wg.strip()
        if isinstance(raw.get("shell_layout"), dict):
            merged["shell_layout"] = _normalized_shell_layout(raw["shell_layout"])

    merged["version"] = 2
    return merged


def workspace_phoenix_dir(repo_root: Path) -> Path:
    return repo_root.expanduser().resolve(strict=False) / WORKSPACE_PHOENIX_DIR


def legacy_workspace_dotfile_path(repo_root: Path) -> Path:
    """旧版：工作空间根下的 ``.phoenix-freecad-desktop.json``（仅迁移读取）。"""
    return repo_root.expanduser().resolve(strict=False) / WORKSPACE_DOTFILE_LEGACY_NAME


def workspace_dotfile_path(repo_root: Path) -> Path:
    return workspace_phoenix_dir(repo_root) / WORKSPACE_PREFS_BASENAME


def migrate_workspace_dotfile(repo_root: Path) -> bool:
    """将根目录遗留 dotfile 迁入 ``.phoenix/phoenix-freecad-desktop.json``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    new_path = workspace_dotfile_path(rr)
    if new_path.is_file():
        return False
    legacy_path = legacy_workspace_dotfile_path(rr)
    legacy_raw = _read_json(legacy_path)
    if not legacy_raw:
        return False
    _write_json(new_path, legacy_raw)
    return True


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
    return data


def save_launcher_window_geometry(geom: str) -> None:
    """主窗口 WxH+X+Y，写入 launcher JSON（仅存尺寸位置，与各工作空间无关）。"""
    launcher = load_launcher_prefs()
    launcher["window_geometry"] = geom.strip()
    save_launcher_prefs(launcher)


def save_launcher_shell_layout(
    *,
    nav_rail_mode: int | None = None,
    right_panel_open: bool | None = None,
    mid_right_sash_px: int | None = None,
    right_panel_width_px: int | None = None,
    log_panel_open: bool | None = None,
    log_panel_height_px: int | None = None,
    log_auto_open_on_append: bool | None = None,
) -> None:
    """将左侧导航宽窄 / 右栏开合 / 中右分割 sash / 运行日志窗 写入 launcher JSON。"""
    launcher = load_launcher_prefs()
    cur = _normalized_shell_layout(launcher.get("shell_layout"))
    if nav_rail_mode is not None and int(nav_rail_mode) in (0, 1):
        cur["nav_rail_mode"] = int(nav_rail_mode)
    if right_panel_open is not None:
        cur["right_panel_open"] = bool(right_panel_open)
    if mid_right_sash_px is not None:
        cur["mid_right_sash_px"] = int(mid_right_sash_px)
    if right_panel_width_px is not None:
        cur["right_panel_width_px"] = int(right_panel_width_px)
    if log_panel_open is not None:
        cur["log_panel_open"] = bool(log_panel_open)
    if log_panel_height_px is not None:
        cur["log_panel_height_px"] = max(80, int(log_panel_height_px))
    if log_auto_open_on_append is not None:
        cur["log_auto_open_on_append"] = bool(log_auto_open_on_append)
    launcher["shell_layout"] = cur
    save_launcher_prefs(launcher)


def save_launcher_prefs(data: dict[str, Any]) -> None:
    target = _launcher_prefs_write_path()
    _write_json(target, data)
    legacy = legacy_launcher_prefs_file()
    if legacy.is_file() and legacy.resolve() != target.resolve():
        try:
            legacy.unlink()
        except OSError:
            pass


def get_recent_workspaces() -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    for item in load_launcher_prefs().get("recent_workspaces") or []:
        try:
            p = Path(str(item)).expanduser().resolve()
        except (OSError, RuntimeError):
            continue
        key = str(p)
        if key in seen or not p.is_dir():
            continue
        seen.add(key)
        out.append(p)
    return out


def record_recent_workspace(repo_root: Path) -> None:
    rp = repo_root.expanduser().resolve()
    if not rp.is_dir():
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
    migrate_workspace_dotfile(repo_root)
    data = deepcopy(_WORKSPACE_DEFAULT)
    raw = _read_json(workspace_dotfile_path(repo_root))
    if not raw:
        return data
    for key in _WORKSPACE_SECTIONS:
        inc = raw.get(key)
        if isinstance(inc, dict) and isinstance(data[key], dict):
            data[key].update(inc)
    if isinstance(raw.get("version"), int):
        data["version"] = raw["version"]
    return data


def save_workspace_prefs(repo_root: Path, data: dict[str, Any]) -> None:
    _write_json(workspace_dotfile_path(repo_root), data)


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
    record_recent_workspace(rp)
    return dat


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
    state.repo_root = rp
    record_recent_workspace(rp)


def migrate_launcher_prefs() -> bool:
    """将 legacy / 旧 ``web-ui/.local`` 合并写入本机平台 ``launcher.json``。

    返回是否写入了平台路径。
    """
    platform_path = platform_launcher_prefs_file()
    legacy_raw = _read_json(legacy_launcher_prefs_file())
    web_raw = _read_json(web_launcher_prefs_file())
    flat_platform_raw = _read_json(legacy_flat_launcher_prefs_file())
    platform_raw = _read_json(platform_path)

    if not legacy_raw and not web_raw and not flat_platform_raw and not platform_raw:
        return False

    merged = _merge_launcher_sources(legacy_raw, web_raw, flat_platform_raw, platform_raw)
    changed = _launcher_storage_subset(merged) != _launcher_storage_subset(platform_raw)
    if not platform_path.is_file() or changed:
        _write_json(platform_path, merged)
        return True
    return False


def migrate_launcher_prefs_to_web() -> bool:
    """兼容旧名：等同于 :func:`migrate_launcher_prefs`。"""
    return migrate_launcher_prefs()


def migrate_legacy_workspace_prefs() -> None:
    """将旧版 ``workspace.custom.json`` 内嵌的工作区配置迁到各仓库根目录。"""
    migrate_launcher_prefs()
    legacy_raw = _read_json(legacy_launcher_prefs_file())
    raw = _read_json(launcher_prefs_file())
    section_source = legacy_raw if legacy_raw else raw
    if not section_source:
        return
    has_workspace_sections = any(k in section_source for k in _WORKSPACE_SECTIONS)
    toolbar = section_source.get("toolbar") if isinstance(section_source.get("toolbar"), dict) else {}
    legacy_repo = toolbar.get("repo_root") if isinstance(toolbar, dict) else None

    if not has_workspace_sections and not legacy_repo:
        return

    # 已是 v2 且无内嵌工作区小节、也无 legacy 需迁时跳过
    if (
        not legacy_raw
        and raw
        and raw.get("version") == 2
        and not has_workspace_sections
    ):
        return

    repo_path: Path | None = None
    if legacy_repo:
        try:
            candidate = Path(str(legacy_repo)).expanduser().resolve()
            if candidate.is_dir():
                repo_path = candidate
        except (OSError, RuntimeError):
            pass

    if repo_path is None and has_workspace_sections:
        for p in get_recent_workspaces():
            repo_path = p
            break

    if repo_path is not None and has_workspace_sections:
        dot = workspace_dotfile_path(repo_path)
        migrate_workspace_dotfile(repo_path)
        if not dot.is_file():
            ws = deepcopy(_WORKSPACE_DEFAULT)
            for key in _WORKSPACE_SECTIONS:
                inc = section_source.get(key)
                if isinstance(inc, dict):
                    ws[key].update(inc)
            if isinstance(section_source.get("version"), int):
                ws["version"] = section_source["version"]
            save_workspace_prefs(repo_path, ws)

    launcher = load_launcher_prefs()
    if repo_path is not None:
        record_recent_workspace(repo_path)
        launcher = load_launcher_prefs()
    if isinstance(toolbar, dict) and toolbar.get("freecad_dir") and not launcher.get("freecad_dir"):
        launcher["freecad_dir"] = str(toolbar["freecad_dir"])
    launcher["version"] = 2
    for key in _WORKSPACE_SECTIONS:
        launcher.pop(key, None)
    launcher.pop("toolbar", None)
    save_launcher_prefs(launcher)
