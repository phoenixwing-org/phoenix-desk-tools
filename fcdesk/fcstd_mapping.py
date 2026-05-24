"""FCStd 映射的高层数据模型。

供桌面「链接路径修正」、`fcstd_map.py`、以及将来的 BOM / 查重等复用。
JSON 分为两种形态：

- **结构化（默认）**：``schema_version`` + ``entries``，每条含零件号、**型号（如 ``ABC``）**、版本、类型、零件名称 (`PartName`) / label 等可扩展字段。
- **遗留扁平**：``{ "某.FCStd": ["repo/relative/path.FCStd", ...], ... }``（仍可读）。

路径字符串解释为相对调用方传入的「锚点目录」：桌面 Shell 下与 **工作空间根** 一致（`fcstd_map.json` 写入该目录；`fcstd_map --relative-to` 与 **`fix_fcstd_xlink_paths --map-anchor`** 均指向该根）。
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Mapping

SCHEMA_VERSION: int = 2


def normalize_repo_rel_path_for_map(rel: str) -> str:
    """写入映射 JSON：相对锚点目录时，路径统一带 ``./`` 前缀（避免与 ``../工作空间/…`` 混用）。

    绝对路径、``..`` 开头、已带 ``./`` 的条目原样返回。
    """
    s = rel.replace("\\", "/").strip()
    if not s or s.startswith(("/", "..")):
        return s
    if s.startswith("./"):
        return s
    return f"./{s}"


def compose_fcstd_body_label_display(
    *,
    part_number: str,
    part_version: str,
    part_name: str,
    label_fallback: str,
) -> str | None:
    """``PartNumber``.``PartVersion``-名称；名称为空时用 ``label_fallback``。

    零件号与版本均非空时才生成字符串，否则 ``None``。
    """
    pn = (part_number or "").strip()
    pv = (part_version or "").strip()
    pname = (part_name or "").strip() or (label_fallback or "").strip()
    if not pn or not pv:
        return None
    return f"{pn}.{pv}-{pname}"


_INFIX_TYPE = re.compile(r"[-._]([HSR])[-._]", re.IGNORECASE)

# 型号：文件名中的 「数字+TB」（如 ABC），或路径段 SampleABC…
_SERIES_DIGITS_TB = re.compile(r"(?<![A-Za-z0-9])(\d+)TB\b", re.IGNORECASE)
_SAMPLE_TB_SEGMENT = re.compile(r"Sample(\d+)TB", re.IGNORECASE)


@dataclass
class FcstdMapEntry:
    """一条 FCStd 在仓库内的索引记录。"""

    repo_rel_path: str
    filename: str
    PartNumber: str | None = None
    PartVersion: str | None = None
    TypeCode: str | None = None
    """零件类型/层级记号，如 H/S/R（从文件名推断，可手工扩展）"""

    ModelSeries: str | None = None
    """产品/平台型号片段，如 ``ABC``；无法从路径或文件名识别时省略（JSON 不出现该键）"""

    PartName: str | None = None
    """可读零件名称（如与 Body ``Label`` 分离存储）；fcdesk / ``Document.xml`` 可与 Label 对齐。"""

    label: str | None = None
    """可读标签或外部系统引用；暂无解析时为空。"""

    extra: dict[str, Any] = field(default_factory=dict)
    """后续扩展字段，序列化原样写入 JSON。"""

    def to_json_dict(self) -> dict[str, Any]:
        """与 JSON ``entries[]`` 单条对象对齐。"""
        d = asdict(self)
        if not d.get("extra"):
            d.pop("extra", None)
        keep_keys = frozenset({"repo_rel_path", "filename"})
        return {k: v for k, v in d.items() if k in keep_keys or v not in ("", None)}

    @classmethod
    def preview_from_workspace_relative(cls, rel_workspace: Path) -> FcstdMapEntry:
        """从相对工作空间根的路径构建一条预览/推断记录（不写盘）。

        字段与 ``fcstd_map.json`` / ``hints_from_fcstd_location`` 对齐；``.fcstd`` 走完整推断，
        ``.sldprt`` 复用语义相近的文件名推断 + ``ModelSeries``；其余后缀仅填充路径与文件名。
        ``label`` 由映射或外部 BOM 填入，此处推断阶段一般为 ``None``。
        """

        rr = normalize_repo_rel_path_for_map(rel_workspace.as_posix())
        name = rel_workspace.name

        suf = Path(name).suffix.casefold()

        hints: dict[str, Any]
        if suf == ".fcstd":
            hints = dict(hints_from_fcstd_location(name, rr))
        elif suf == ".sldprt":
            hints = dict(hints_from_fcstd_filename(name))
            stem = Path(name).stem
            ms = infer_model_series(stem=stem, rel_posix=rr.replace("\\", "/"))
            if ms:
                hints["ModelSeries"] = ms
        else:
            hints = {}

        return cls(
            repo_rel_path=rr,
            filename=name,
            PartNumber=hints.get("PartNumber"),
            PartVersion=hints.get("PartVersion"),
            TypeCode=_opt_str_upper(hints.get("TypeCode")),
            ModelSeries=_opt_str_upper(hints.get("ModelSeries")),
            PartName=_opt_str(hints.get("PartName")),
            label=_opt_str(hints.get("label")),
        )


@dataclass
class FcstdMapDocument:
    """整份映射文件（可被其他模块载入、筛选、JOIN）。"""

    entries: list[FcstdMapEntry] = field(default_factory=list)
    schema_version: int = SCHEMA_VERSION
    mapping_kind: str = "fcstd"
    anchor_note: str = (
        "repo_rel_path 相对于本文件所在目录（与 fcstd_map --relative-to / CAD 搜索根一致）。"
    )

    def to_json_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "mapping_kind": self.mapping_kind,
            "anchor_note": self.anchor_note,
            "entries": [e.to_json_dict() for e in self.entries],
        }

    @classmethod
    def from_json_mapping(cls, data: Mapping[str, Any]) -> FcstdMapDocument:
        sv_raw = data.get("schema_version", SCHEMA_VERSION)
        sv = int(sv_raw) if sv_raw is not None else SCHEMA_VERSION
        if sv < 2:
            raise ValueError("from_json_mapping 需要 schema_version >= 2")

        entries_raw = data.get("entries")
        if not isinstance(entries_raw, list):
            raise ValueError("缺少 entries 数组")

        items: list[FcstdMapEntry] = []
        for row in entries_raw:
            if not isinstance(row, Mapping):
                continue
            rr = row.get("repo_rel_path")
            fn = row.get("filename")
            if not isinstance(rr, str) or not isinstance(fn, str):
                continue
            ex = row.get("extra")
            if not isinstance(ex, dict):
                ex = {}
            items.append(
                FcstdMapEntry(
                    repo_rel_path=rr,
                    filename=fn,
                    PartNumber=_opt_str(row.get("PartNumber")),
                    PartVersion=_opt_str(row.get("PartVersion")),
                    TypeCode=_opt_str_upper(row.get("TypeCode")),
                    ModelSeries=_opt_str_upper(row.get("ModelSeries")),
                    PartName=_opt_str(row.get("PartName")),
                    label=_opt_str(row.get("label")),
                    extra=dict(ex),
                )
            )

        an = data.get("anchor_note")
        note = (
            str(an)
            if an is not None
            else "repo_rel_path 相对于本映射文件所在目录（与 fcstd_map --relative-to / CAD 搜索根一致）。"
        )
        return cls(
            entries=items,
            schema_version=sv,
            mapping_kind=str(data.get("mapping_kind", "fcstd")),
            anchor_note=note,
        )

    def to_legacy_basename_paths(self) -> dict[str, list[str]]:
        """转为旧版「文件名 → 仓库相对路径列表」，供 xlink 等只认文件名的逻辑使用。"""
        m: dict[str, list[str]] = {}
        for e in self.entries:
            m.setdefault(e.filename, []).append(e.repo_rel_path)
        for v in m.values():
            v.sort()
        return m


def hints_from_fcstd_filename(filename: str) -> dict[str, Any]:
    """从文件名做轻量推断（不访问磁盘）；推断失败字段省略。

    - ``PartNumber``：主干若数字开头 ``^\\d+``
    - ``PartVersion``：与 ``fix_fcstd_xlink_paths`` 一致 ``.NNN[-.]``
    - ``TypeCode``：``-X-`` /``.X.`` /``_X_`` 且 X∈HSR（大小写忽略）
    """
    stem = Path(filename).stem
    out: dict[str, Any] = {}

    mp = re.match(r"^(\d+)", stem)
    if mp:
        out["PartNumber"] = mp.group(1)

    m_ver = re.search(r"\.(\d{3})[-.]", stem)
    if m_ver:
        out["PartVersion"] = m_ver.group(1)

    mt = _INFIX_TYPE.search(stem)
    if mt:
        t = (mt.group(1) or "").upper()
        if t in frozenset("HSR"):
            out["TypeCode"] = t

    return out


def infer_model_series(*, stem: str, rel_posix: str) -> str | None:
    """从产品命名中推断型号片段（如 ``ABC``、``3TB``）；无则 ``None``.

    优先 ``Sample\\d+TB`` / 片段中的 ``\\d+TB``；再匹配 ``Sample[A-Za-z]+\\d+`` 路径；
    再匹配 ``-H-ABC-…`` 中类型码后的字母型号段。
    """
    rp = rel_posix.replace("\\", "/")

    def from_fragment(fragment: str) -> str | None:
        if not fragment:
            return None
        md = _SAMPLE_TB_SEGMENT.search(fragment)
        if md:
            return f"{md.group(1)}TB".upper()
        tb = _SERIES_DIGITS_TB.search(fragment)
        if tb:
            return f"{tb.group(1)}TB".upper()
        return None

    x = from_fragment(stem)
    if x:
        return x
    x = from_fragment(rp)
    if x:
        return x
    for part in rp.split("/"):
        x = from_fragment(part)
        if x:
            return x

    hay = f"{stem}/{rp}"
    m_sample_lett = re.search(r"Sample([A-Za-z]{2,15})\d+", hay, re.IGNORECASE)
    if m_sample_lett:
        return (m_sample_lett.group(1) or "").upper()

    m_mid = re.search(r"[-._]([HSR])[-._]([A-Za-z0-9]{2,24})(?=([-._]|$))", stem, re.IGNORECASE)
    if m_mid:
        tok = (m_mid.group(2) or "").upper()
        return tok if len(tok) >= 2 else None

    return None


def hints_from_fcstd_location(filename: str, repo_rel_path: str) -> dict[str, Any]:
    """结合文件名与 ``repo_rel_path`` 推断（比仅看文件名多出 ``ModelSeries`` 等）。"""
    h = hints_from_fcstd_filename(filename)
    rp = repo_rel_path.replace("\\", "/")
    stem = Path(filename).stem
    ms = infer_model_series(stem=stem, rel_posix=rp)
    if ms:
        h["ModelSeries"] = ms
    return h


def _opt_str(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, str) and not v.strip():
        return None
    return str(v) if v is not None else None


def _opt_str_upper(v: Any) -> str | None:
    s = _opt_str(v)
    return s.upper() if s else None


def legacy_flat_dict_to_document(
    flat: Mapping[str, Any],
    *,
    anchor_note: str | None = None,
) -> FcstdMapDocument:
    """把旧版 `{ 文件名: [相对路径, ...] }` 升格为结构化文档。"""
    entries: list[FcstdMapEntry] = []
    for basename, paths in flat.items():
        if not isinstance(basename, str) or not basename.endswith(".FCStd"):
            continue
        if not isinstance(paths, list):
            continue
        for raw in paths:
            if not isinstance(raw, str) or not raw.strip():
                continue
            rp = raw.strip()
            hints = hints_from_fcstd_location(basename, rp)
            entries.append(
                FcstdMapEntry(
                    repo_rel_path=rp,
                    filename=basename,
                    PartNumber=hints.get("PartNumber"),
                    PartVersion=hints.get("PartVersion"),
                    TypeCode=hints.get("TypeCode"),
                    ModelSeries=hints.get("ModelSeries"),
                    PartName=hints.get("PartName"),
                    label=hints.get("label"),
                )
            )
    doc = FcstdMapDocument(entries=entries)
    if anchor_note:
        doc.anchor_note = anchor_note
    return doc


def coerce_payload_to_basename_rel_paths(payload: Mapping[str, Any]) -> dict[str, list[str]]:
    """将任意载入的顶层 JSON 对象规范为「basename → repo 相对路径」。"""
    if not isinstance(payload, Mapping):
        return {}

    if "entries" in payload and isinstance(payload["entries"], list):
        try:
            patched = dict(payload)
            if "schema_version" not in patched:
                patched["schema_version"] = SCHEMA_VERSION
            doc = FcstdMapDocument.from_json_mapping(patched)
            return doc.to_legacy_basename_paths()
        except (TypeError, ValueError):
            pass

    legacy: dict[str, list[str]] = {}
    for k, v in payload.items():
        if k in ("schema_version", "mapping_kind", "anchor_note", "entries"):
            continue
        if isinstance(k, str) and isinstance(v, list):
            legacy[k] = [str(x) for x in v if isinstance(x, str)]
    return legacy


def basename_pathstrings_to_abs(
    basename_to_rel: Mapping[str, list[str]],
    anchor: Path | str,
) -> dict[str, list[Path]]:
    """文件名 → 相对锚点解析后的绝对路径列表。"""
    base = Path(anchor).expanduser().resolve()
    out: dict[str, list[Path]] = {}
    for name, paths_obj in basename_to_rel.items():
        if not isinstance(name, str):
            continue
        if not isinstance(paths_obj, list):
            continue
        resolved: list[Path] = []
        for raw in paths_obj:
            if not isinstance(raw, str):
                continue
            s = raw.strip()
            if not s:
                continue
            q = Path(s)
            pth = q.resolve(strict=False) if q.is_absolute() else (base / q).resolve(strict=False)
            resolved.append(pth)
        if resolved:
            out[name] = resolved
    return out


def map_json_payload_to_abs(payload: Mapping[str, Any], anchor: Path | str) -> dict[str, list[Path]]:
    """从顶层 JSON dict 载入（结构化或遗留），产出 xlink 可用的 basename→绝对路径列表。"""
    flat = coerce_payload_to_basename_rel_paths(payload)
    return basename_pathstrings_to_abs(flat, anchor)


def try_load_fcstd_entry_from_workspace_map(
    *,
    repo_root: Path,
    rel_workspace: Path,
) -> FcstdMapEntry | None:
    """若工作空间根存在 ``fcstd_map.json``，按 ``repo_rel_path`` 查找与当前选中文件匹配的条目。"""
    root = repo_root.expanduser().resolve(strict=False)
    jp = root / "fcstd_map.json"
    if not jp.is_file():
        return None
    try:
        raw = json.loads(jp.read_text(encoding="utf-8"))
        if not isinstance(raw, Mapping):
            return None
        doc = FcstdMapDocument.from_json_mapping(raw)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        return None

    want = normalize_repo_rel_path_for_map(rel_workspace.as_posix())
    for e in doc.entries:
        cand = normalize_repo_rel_path_for_map(Path(str(e.repo_rel_path)).as_posix())
        if cand == want:
            return e
    return None
