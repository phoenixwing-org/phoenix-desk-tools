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

FILE_STATUS_PRESENT = "present"
FILE_STATUS_MISSING = "missing"


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
    """组合 Label：``PartNumber.PartVersion-名称``（如 ``100001.001-拉力机2``）。

    仅含零件号、版本与名称（``PartName`` 优先，否则 ``label_fallback``）；不含类型码/型号。
    零件号与版本均非空时才生成。
    """
    pn = (part_number or "").strip()
    pv = (part_version or "").strip()
    pname = (part_name or "").strip() or (label_fallback or "").strip()
    if not pn or not pv:
        return None
    if not pname:
        return f"{pn}.{pv}"
    return f"{pn}.{pv}-{pname}"


def infer_fcstd_name_suffix(filename: str) -> str:
    """FCStd 族文件扩展名（保留 ``.Drawing.FCStd`` / ``.ASSY.FCStd`` 等复合后缀）。"""
    name = Path(filename).name
    low = name.casefold()
    for suffix_low in (".drawing.fcstd", ".assy.fcstd", ".fcstd"):
        if low.endswith(suffix_low):
            return name[-len(suffix_low) :]
    return ".FCStd"


_COMPOUND_FCSTD_TAIL_RE = re.compile(r"(\.(?:Drawing|ASSY))?\.FCStd$", re.IGNORECASE)


def strip_accidental_fcstd_suffix_from_name_segment(name: str) -> str:
    """名称段若误含 ``.Drawing.FCStd`` / ``.ASSY.FCStd`` / ``.FCStd`` 尾巴，去掉后再拼文件名。"""
    s = (name or "").strip()
    if not s:
        return ""
    return _COMPOUND_FCSTD_TAIL_RE.sub("", s).rstrip(".")


def compose_fcstd_recommended_filename(
    *,
    part_number: str,
    part_version: str,
    type_code: str = "",
    model_series: str = "",
    part_name: str = "",
    label_fallback: str = "",
    suffix: str = ".FCStd",
) -> str | None:
    """推荐 FCStd 文件名，形如 ``100001.001-H-外壳.FCStd`` 或 ``…-ABC-零件段.ASSY.FCStd``。

    规则：``{PartNumber}.{PartVersion}``，若有类型码则 ``-{TypeCode}``，若有型号则 ``-{ModelSeries}``，
    若有名称则 ``-{名称}``（``PartName`` 优先，否则 ``label_fallback``），最后接 ``suffix``。
    零件号与版本均非空时才生成，否则 ``None``。
    """
    pn = (part_number or "").strip()
    pv = (part_version or "").strip()
    if not pn or not pv:
        return None
    tc = (type_code or "").strip().upper()
    ms = (model_series or "").strip().upper()
    pname = (part_name or "").strip() or (label_fallback or "").strip()

    stem = f"{pn}.{pv}"
    if tc:
        stem += f"-{tc}"
    if ms:
        stem += f"-{ms}"
    if pname:
        stem += f"-{pname}"

    suf = suffix if suffix.startswith(".") else f".{suffix}"
    return stem + suf


def format_recommended_filename_hint(
    *,
    original_filename: str,
    recommended_filename: str,
    part_number: str,
    part_version: str,
    type_code: str,
    model_series: str,
    part_name: str,
    label: str,
    suffix: str,
) -> str:
    """界面说明：原文件名、推荐名、拼接规则与各字段取值。"""
    pname = (part_name or "").strip()
    lb = (label or "").strip()
    name_src = "PartName" if pname else ("label（PartName 为空）" if lb else "（未填名称段）")
    name_val = pname or lb or "—"
    return (
        f"原文件名：{original_filename or '—'}\n"
        f"推荐文件名：{recommended_filename}\n"
        f"规则：PartNumber.PartVersion[-TypeCode][-ModelSeries]-名称{suffix}\n"
        f"PartNumber={part_number or '（空）'} · PartVersion={part_version or '（空）'} · "
        f"TypeCode={(type_code or '').strip().upper() or '（空）'} · "
        f"ModelSeries={(model_series or '').strip().upper() or '（空）'} · "
        f"名称={name_val}（{name_src}） · label={lb or '（空）'}"
    )


from fcdesk.freecad.part_naming import PartNamingParser


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

    asset_kind: str | None = None
    """CAD 索引文件类型：``fcstd`` / ``markdown`` / ``pdf`` / ``cad_exchange`` / ``image`` 等。"""

    file_status: str | None = None
    """``present`` 本次扫描仍存在 · ``missing`` 上次有、本次未找到（供改名/BOM 统计）。"""

    last_seen_at: str | None = None
    """ISO8601 UTC；文件最后一次在扫描中出现的时间。"""

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
    last_scan_at: str | None = None
    scan_root: str | None = None
    """上次扫描范围元数据（``.`` = 工作空间根）；用户偏好中的子目录扫描根已废弃。"""

    scan_stats: dict[str, Any] | None = None
    """最近一次扫描统计（present / missing / 重名等）。"""

    def to_json_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "schema_version": self.schema_version,
            "mapping_kind": self.mapping_kind,
            "anchor_note": self.anchor_note,
            "entries": [e.to_json_dict() for e in self.entries],
        }
        if self.last_scan_at:
            out["last_scan_at"] = self.last_scan_at
        if self.scan_root:
            out["scan_root"] = self.scan_root
        if self.scan_stats:
            out["scan_stats"] = self.scan_stats
        return out

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
            fs = row.get("file_status")
            file_status = str(fs).strip() if isinstance(fs, str) and fs.strip() else None
            lsa = row.get("last_seen_at")
            last_seen_at = str(lsa).strip() if isinstance(lsa, str) and lsa.strip() else None
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
                    asset_kind=_opt_str(row.get("asset_kind")),
                    file_status=file_status,
                    last_seen_at=last_seen_at,
                    extra=dict(ex),
                )
            )

        an = data.get("anchor_note")
        note = (
            str(an)
            if an is not None
            else "repo_rel_path 相对于本映射文件所在目录（与 fcstd_map --relative-to / CAD 搜索根一致）。"
        )
        sr = data.get("scan_root")
        scan_root = str(sr).strip() if isinstance(sr, str) and sr.strip() else None
        lsa_doc = data.get("last_scan_at")
        last_scan_at = str(lsa_doc).strip() if isinstance(lsa_doc, str) and lsa_doc.strip() else None
        stats_raw = data.get("scan_stats")
        scan_stats = dict(stats_raw) if isinstance(stats_raw, dict) else None
        return cls(
            entries=items,
            schema_version=sv,
            mapping_kind=str(data.get("mapping_kind", "fcstd")),
            anchor_note=note,
            last_scan_at=last_scan_at,
            scan_root=scan_root,
            scan_stats=scan_stats,
        )

    def to_legacy_basename_paths(self) -> dict[str, list[str]]:
        """转为旧版「文件名 → 仓库相对路径列表」，供 xlink 等只认文件名的逻辑使用。"""
        m: dict[str, list[str]] = {}
        for e in self.entries:
            m.setdefault(e.filename, []).append(e.repo_rel_path)
        for v in m.values():
            v.sort()
        return m


# --- 零件名 / Part Key 解析（实现见 ``part_naming.PartNamingParser``）---

normalize_fcstd_filename_stem = PartNamingParser.normalize_filename_stem
parse_part_number_version_from_stem = PartNamingParser.parse_part_number_version_from_stem
parse_part_key_text = PartNamingParser.parse_part_key_text
part_key_hints_from_basename = PartNamingParser.part_key_hints_from_basename
infer_part_key_from_filename = PartNamingParser.infer_part_key_from_filename
hints_from_fcstd_filename = PartNamingParser.hints_from_filename
infer_model_series = PartNamingParser.infer_model_series
hints_from_fcstd_location = PartNamingParser.hints_from_location
refine_inferred_part_name = PartNamingParser.refine_inferred_part_name
infer_part_name_from_fcstd_filename = PartNamingParser.infer_part_name_from_filename
coerce_inferred_part_name = PartNamingParser.coerce_inferred_part_name


def resolve_label_for_index_scan(
    embedded_label: str | None,
    *,
    stored_label: str | None = None,
) -> str | None:
    """FCStd **索引扫描**：优先 Document.xml 内已有 ``Label``；无则保留索引/条目已有值。

    不在扫描阶段自动拼接编号公式（与属性回写「推荐 Label」区分）。
    """
    emb = (embedded_label or "").strip()
    if emb:
        return emb
    stored = (stored_label or "").strip()
    return stored or None


def resolve_part_name_for_scan(
    part_name: str | None,
    label: str | None = None,
    *,
    filename: str | None = None,
    repo_rel_path: str | None = None,
    part_number: str | None = None,
    part_version: str | None = None,
    type_code: str | None = None,
    model_series: str | None = None,
    force_update: bool = False,
) -> str | None:
    """索引扫描时解析 ``PartName``：默认仅填空；``force_update`` 时用智能去前缀覆盖已有值。"""
    if not force_update:
        return coerce_inferred_part_name(
            part_name,
            label,
            filename=filename,
            repo_rel_path=repo_rel_path,
            part_number=part_number,
            part_version=part_version,
            type_code=type_code,
            model_series=model_series,
        )

    pn, pv, tc, ms = PartNamingParser._merged_bom_fields_for_name(
        PartNamingParser._merge_field(label, filename),
        part_number=part_number,
        part_version=part_version,
        type_code=type_code,
        model_series=model_series,
        filename=filename,
        repo_rel_path=repo_rel_path,
    )

    refined: str | None = None
    if label:
        refined = refine_inferred_part_name(
            label,
            part_number=pn,
            part_version=pv,
            type_code=tc,
            model_series=ms,
            filename=filename,
            repo_rel_path=repo_rel_path,
        )
    if not refined and filename:
        refined = infer_part_name_from_fcstd_filename(
            filename,
            part_number=pn,
            part_version=pv,
            type_code=tc,
            model_series=ms,
            repo_rel_path=repo_rel_path,
        )

    existing = (part_name or "").strip()
    if refined:
        return refined
    return existing or None


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


_FCSTD_INVALID_BASENAME_CHARS = frozenset('/\\:*?"<>|')


def is_fcstd_family_basename(name: str) -> bool:
    """``.FCStd`` 族（含 ``.ASSY.FCStd``、``.Drawing.FCStd`` 等）。"""
    return bool((name or "").strip()) and name.strip().casefold().endswith(".fcstd")


def validate_fcstd_basename(name: str) -> str:
    """校验并返回去除首尾空白后的 FCStd 族文件名（仅 basename，不含目录）。"""
    s = (name or "").strip()
    if not s:
        raise ValueError("文件名为空")
    if "/" in s or "\\" in s:
        raise ValueError("文件名不能含路径分隔符")
    if any(c in s for c in _FCSTD_INVALID_BASENAME_CHARS):
        raise ValueError('文件名含非法字符（/ \\ : * ? " < > |）')
    if not is_fcstd_family_basename(s):
        raise ValueError("须为 .FCStd 族扩展名（如 .FCStd、.ASSY.FCStd、.Drawing.FCStd）")
    return s


def rename_workspace_fcstd_file(
    *,
    repo_root: Path,
    rel: Path,
    new_basename: str,
) -> Path:
    """在工作空间内重命名 FCStd 文件；返回新的相对路径。"""
    new_basename = validate_fcstd_basename(new_basename)
    root = repo_root.expanduser().resolve(strict=False)
    src = (root / rel).resolve(strict=False)
    if not src.is_file():
        raise FileNotFoundError(f"源文件不存在：{src}")
    if rel.name == new_basename:
        return rel
    new_rel = rel.parent / new_basename
    dst = (root / new_rel).resolve(strict=False)
    if dst.exists():
        raise FileExistsError(f"目标已存在：{dst}")
    src.rename(dst)
    return new_rel


def try_update_fcstd_map_entry_rename(
    *,
    repo_root: Path,
    old_rel: Path,
    new_rel: Path,
) -> bool:
    """若索引中有与 ``old_rel`` 匹配的条目，则更新路径与 ``filename``（SQLite）。"""
    from fcdesk.freecad.phoenix_store import update_fcstd_entry_rename

    return update_fcstd_entry_rename(repo_root, old_rel, new_rel)


def try_load_fcstd_entry_from_workspace_map(
    *,
    repo_root: Path,
    rel_workspace: Path,
) -> FcstdMapEntry | None:
    """按 ``repo_rel_path`` 查找索引条目（``.phoenix/cad-database.sqlite``）。"""
    from fcdesk.freecad.phoenix_store import find_fcstd_entry, migrate_fcstd_map_json

    root = repo_root.expanduser().resolve(strict=False)
    migrate_fcstd_map_json(root)
    return find_fcstd_entry(root, rel_workspace)
