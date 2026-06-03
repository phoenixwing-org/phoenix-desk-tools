"""改名分析：FCStd 内 XLink basename 扫描与写回。"""

from __future__ import annotations

import os
import re
import tempfile
import zipfile
from pathlib import Path

from fcdesk.freecad.cad_index_types import is_fcstd_filename
from fcdesk.freecad.rename_analysis.types import HostRefGroup, RenameAnalysisError, XLinkBasenameHit

XLINK_FILE_RE = re.compile(r'(<XLink\s+file=")([^"]*)(")', re.MULTILINE)
LABEL_STRING_RE = re.compile(
    r'(<Property\s+name="Label"\s+type="App::PropertyString"[^>]*>\s*<String\s+value=")([^"]*)(")',
    re.DOTALL,
)
LINKLIST_PROPERTY_RE = re.compile(
    r"<Property\s+name=\"[^\"]*\"\s+type=\"App::PropertyLinkList\"[^>]*>.*?</Property>",
    re.DOTALL,
)

_SKIP_DIRS = frozenset({".git", ".phoenix", "__pycache__", "node_modules", ".venv", "venv"})


def preferred_xlink_attr_for_target(
    repo_root: Path,
    host_repo_rel: str,
    target_repo_rel: str,
) -> str:
    """从宿主 FCStd 所在目录到目标文件的相对 ``file`` 属性（FreeCAD 惯例）。"""
    rr = repo_root.expanduser().resolve(strict=False)
    host = (rr / host_repo_rel).resolve(strict=False)
    target = (rr / target_repo_rel).resolve(strict=False)
    return os.path.relpath(target, host.parent).replace(os.sep, "/")


def resolve_xlink_attr_to_abs(repo_root: Path, host_repo_rel: str, xlink_attr: str) -> Path | None:
    rr = repo_root.expanduser().resolve(strict=False)
    host = (rr / host_repo_rel).resolve(strict=False)
    attr = xlink_attr.replace("\\", "/").strip()
    if not attr:
        return None
    candidate = (host.parent / attr).resolve(strict=False)
    return candidate if candidate.is_file() else None


def xlink_attr_matches_target(
    repo_root: Path,
    host_repo_rel: str,
    xlink_attr: str,
    target_repo_rel: str,
) -> bool:
    """XLink ``file`` 解析结果是否与目标文件路径一致。"""
    rr = repo_root.expanduser().resolve(strict=False)
    expected = (rr / target_repo_rel).resolve(strict=False)
    actual = resolve_xlink_attr_to_abs(repo_root, host_repo_rel, xlink_attr)
    if actual is None:
        return False
    try:
        return actual.samefile(expected)
    except OSError:
        return actual == expected


def replace_basename_in_xlink_attr(attr: str, old_basename: str, new_basename: str) -> str | None:
    """若 ``attr`` 末尾 basename 与 ``old_basename`` 相同（大小写忽略），返回替换后的 ``file`` 值。"""
    norm = attr.replace("\\", "/")
    base = Path(norm).name
    if base.casefold() != old_basename.casefold():
        return None
    if norm == base:
        return new_basename
    prefix = norm[: -len(base)]
    return prefix + new_basename


def scan_document_xml_xlink_hits(
    xml: str,
    *,
    old_basename: str,
    new_basename: str,
) -> list[tuple[str, str]]:
    """返回 ``(old_attr, proposed_new_attr)`` 去重列表。"""
    out: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for m in XLINK_FILE_RE.finditer(xml):
        old_attr = m.group(2)
        new_attr = replace_basename_in_xlink_attr(old_attr, old_basename, new_basename)
        if not new_attr or new_attr == old_attr:
            continue
        key = (old_attr, new_attr)
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _read_document_xml_from_fcstd(path: Path) -> str | None:
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if "Document.xml" not in zf.namelist():
                return None
            return zf.read("Document.xml").decode("utf-8", errors="replace")
    except (OSError, zipfile.BadZipFile, UnicodeDecodeError):
        return None


def _rewrite_fcstd_document_xml(fcstd_path: Path, document_xml: str) -> None:
    fcstd_path = fcstd_path.expanduser().resolve(strict=False)
    directory = fcstd_path.parent
    try:
        with zipfile.ZipFile(fcstd_path, "r") as zin:
            cached: list[tuple[zipfile.ZipInfo, bytes]] = [
                (info, zin.read(info.filename)) for info in zin.infolist()
            ]
    except zipfile.BadZipFile as e:
        raise RenameAnalysisError(f"无效的 FCStd/ZIP：{fcstd_path}") from e

    fd, tmp_name = tempfile.mkstemp(prefix=".fcdesk_", suffix=".partial", dir=str(directory))
    os.close(fd)
    tmp_path = Path(tmp_name)
    xml_bytes = document_xml.encode("utf-8")
    doc_written = False
    try:
        with zipfile.ZipFile(tmp_path, "w") as zout:
            for info, blob in cached:
                if info.filename == "Document.xml":
                    zout.writestr(info, xml_bytes)
                    doc_written = True
                else:
                    zout.writestr(info, blob)
        if not doc_written:
            raise RenameAnalysisError(f"ZIP 内缺少 Document.xml：{fcstd_path}")
        os.replace(tmp_path, fcstd_path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def patch_fcstd_xlink_attrs(fcstd_path: Path, replacements: dict[str, str]) -> int:
    """将宿主 FCStd 内匹配的 XLink ``file`` 属性写回；返回修改条数。"""
    if not replacements:
        return 0
    xml = _read_document_xml_from_fcstd(fcstd_path)
    if xml is None:
        raise RenameAnalysisError(f"无法读取 Document.xml：{fcstd_path}")

    new_xml, count = _patch_xlink_attrs_in_xml(xml, replacements)
    if count == 0:
        return 0
    try:
        _rewrite_fcstd_document_xml(fcstd_path, new_xml)
    except OSError as e:
        raise RenameAnalysisError(f"写回失败（可能被占用）：{fcstd_path} · {e}") from e
    return count


def _patch_xlink_attrs_in_xml(xml: str, replacements: dict[str, str]) -> tuple[str, int]:
    count = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal count
        old = m.group(2)
        new = replacements.get(old)
        if new is None:
            return m.group(0)
        count += 1
        return f"{m.group(1)}{new}{m.group(3)}"

    return XLINK_FILE_RE.sub(repl, xml), count


def resolve_fcstd_display_label(fcstd_path: Path) -> str:
    """读取 FCStd 挂载对象的显示 Label（Document → 索引字段组合 → 文件名兜底）。"""
    from fcdesk.freecad.fcstd_embedded_attrs import FcdeskFcstdEmbeddedError, read_embedded_bom_attrs
    from fcdesk.freecad.fcstd_mapping import compose_fcstd_body_label_display, infer_fcstd_name_suffix

    try:
        attrs = read_embedded_bom_attrs(fcstd_path)
    except FcdeskFcstdEmbeddedError:
        attrs = {}
    label = (attrs.get("label") or "").strip()
    if label:
        return label
    composed = compose_fcstd_body_label_display(
        part_number=attrs.get("PartNumber", ""),
        part_version=attrs.get("PartVersion", ""),
        part_name=attrs.get("PartName", ""),
        label_fallback=label,
    )
    if composed:
        return composed
    name = fcstd_path.name
    suffix = infer_fcstd_name_suffix(name)
    if name.casefold().endswith(suffix.casefold()):
        stem = name[: -len(suffix)]
        if stem:
            return stem
    return Path(name).stem


def resolve_rule_display_label(
    repo_root: Path,
    *,
    fcstd_path: Path | None = None,
    repo_rel_path: str | None = None,
) -> str:
    """规则显示名：CAD 索引 ``file_asset`` → FCStd 内嵌属性 → 文件名兜底。"""
    from fcdesk.freecad.fcstd_mapping import compose_fcstd_body_label_display
    from fcdesk.freecad.phoenix_store import get_file_asset_bom_fields

    rr = repo_root.expanduser().resolve(strict=False)
    rel = (repo_rel_path or "").strip().replace("\\", "/")
    if not rel and fcstd_path is not None:
        try:
            rel = os.path.relpath(fcstd_path.resolve(strict=False), rr).replace(os.sep, "/")
        except ValueError:
            rel = ""

    if rel:
        fields = get_file_asset_bom_fields(rr, rel)
        if fields:
            label = (fields.get("label") or "").strip()
            if label:
                return label
            composed = compose_fcstd_body_label_display(
                part_number=fields.get("part_number", ""),
                part_version=fields.get("part_version", ""),
                part_name=fields.get("part_name", ""),
                label_fallback=label,
            )
            if composed:
                return composed

    if fcstd_path is not None:
        return resolve_fcstd_display_label(fcstd_path)

    if rel:
        return Path(rel).name
    return ""


def _resolve_target_fcstd_for_hit(
    repo_root: Path,
    host_repo_rel: str,
    old_attr: str,
    proposed_attr: str,
) -> Path | None:
    for attr in (proposed_attr, old_attr):
        resolved = resolve_xlink_attr_to_abs(repo_root, host_repo_rel, attr)
        if resolved is not None and resolved.is_file():
            return resolved
    from fcdesk.freecad.phoenix_store import find_present_repo_rel_by_filename

    for base in (Path(proposed_attr.replace("\\", "/")).name, Path(old_attr.replace("\\", "/")).name):
        rel = find_present_repo_rel_by_filename(repo_root, base)
        if not rel:
            continue
        candidate = (repo_root / rel).resolve(strict=False)
        if candidate.is_file():
            return candidate
    return None


def _find_object_block_span(xml: str, pos: int) -> tuple[int, int] | None:
    """返回 ``ObjectData`` 内含 ``pos`` 的最内层 ``<Object>…</Object>`` 区间。"""
    objdata_start = xml.find("<ObjectData")
    if objdata_start < 0 or pos < objdata_start:
        return None
    objdata_end = xml.find("</ObjectData>", objdata_start)
    if objdata_end < 0:
        objdata_end = len(xml)

    best: tuple[int, int] | None = None
    search_from = objdata_start
    while search_from < objdata_end:
        open_at = xml.find("<Object", search_from, objdata_end)
        if open_at < 0:
            break
        if not (xml.startswith("<Object ", open_at) or xml.startswith("<Object>", open_at)):
            search_from = open_at + 7
            continue
        depth = 0
        i = open_at
        while i < objdata_end:
            if xml.startswith("<Object ", i) or xml.startswith("<Object>", i):
                depth += 1
                gt = xml.find(">", i)
                if gt < 0:
                    break
                i = gt + 1
                continue
            if xml.startswith("</Object>", i):
                depth -= 1
                end = i + len("</Object>")
                if depth == 0:
                    if open_at <= pos < end and (best is None or open_at > best[0]):
                        best = (open_at, end)
                    break
                i = end
                continue
            i += 1
        search_from = open_at + 7
    return best


def _is_direct_objectdata_object(xml: str, obj_start: int) -> bool:
    """``Object`` 块是否为 ``ObjectData`` 的直接子节点（非嵌套）。"""
    objdata_start = xml.find("<ObjectData")
    if objdata_start < 0 or obj_start < objdata_start:
        return False
    content_start = xml.find(">", objdata_start)
    if content_start < 0:
        return False
    content_start += 1
    segment = xml[content_start:obj_start]
    opens = len(re.findall(r"<Object(?:\s|>)", segment))
    closes = segment.count("</Object>")
    return opens == closes


def _find_first_level_linklist_span(xml: str, pos: int) -> tuple[int, int] | None:
    """含 ``pos`` 的第一级 ``PropertyLinkList`` 区间（``ObjectData`` 直接子对象的 Group 等）。"""
    obj_block = _find_object_block_span(xml, pos)
    if obj_block is None:
        return None
    obj_start, obj_end = obj_block
    if not _is_direct_objectdata_object(xml, obj_start):
        return None

    best: tuple[int, int] | None = None
    for m in LINKLIST_PROPERTY_RE.finditer(xml, obj_start, obj_end):
        if m.start() <= pos < m.end():
            if best is None or m.start() > best[0]:
                best = (m.start(), m.end())
    return best


def _plan_reference_label_updates(
    xml: str,
    hits: list[XLinkBasenameHit],
    *,
    repo_root: Path,
    host_repo_rel: str,
) -> dict[tuple[int, int], str]:
    """单引用用目标 Label；同一第一级 ``PropertyLinkList`` 内多引用追加 ``.001`` 起序号。"""
    if not hits:
        return {}

    attr_to_hit = {h.xlink_file_attr: h for h in hits}
    entries: list[tuple[int, str, str]] = []
    for m in XLINK_FILE_RE.finditer(xml):
        old = m.group(2)
        hit = attr_to_hit.get(old)
        if hit is None:
            continue
        entries.append((m.start(), old, hit.proposed_new_attr))

    if not entries:
        return {}

    # 编号范围：同一第一级 PropertyLinkList + 同一目标 basename
    by_scope: dict[tuple[tuple[int, int], str], list[tuple[int, str, str]]] = {}
    for pos, old_attr, proposed in entries:
        scope = _find_first_level_linklist_span(xml, pos)
        target_key = Path(proposed.replace("\\", "/")).name.casefold()
        if scope is None:
            scope = (-1, pos)
        by_scope.setdefault((scope, target_key), []).append((pos, old_attr, proposed))

    block_labels: dict[tuple[int, int], str] = {}
    for (_scope, _target_key), group in by_scope.items():
        group.sort(key=lambda item: item[0])
        target_path = _resolve_target_fcstd_for_hit(
            repo_root,
            host_repo_rel,
            group[0][1],
            group[0][2],
        )
        target_rel: str | None = None
        if target_path is not None:
            try:
                target_rel = os.path.relpath(target_path, repo_root).replace(os.sep, "/")
            except ValueError:
                target_rel = None
        if not target_rel:
            from fcdesk.freecad.phoenix_store import find_present_repo_rel_by_filename

            target_rel = find_present_repo_rel_by_filename(
                repo_root,
                Path(group[0][2].replace("\\", "/")).name,
            )
        if target_path is not None or target_rel:
            base_label = resolve_rule_display_label(
                repo_root,
                fcstd_path=target_path,
                repo_rel_path=target_rel,
            )
        else:
            base_label = Path(group[0][2].replace("\\", "/")).name
            for suffix in (".drawing.fcstd", ".assy.fcstd", ".fcstd"):
                if base_label.casefold().endswith(suffix):
                    base_label = base_label[: -len(suffix)]
                    break

        use_suffix = _scope[0] >= 0 and len(group) > 1
        for idx, (pos, _old, _proposed) in enumerate(group, start=1):
            label = base_label if not use_suffix else f"{base_label}.{idx:03d}"
            block = _find_object_block_span(xml, pos)
            if block is None:
                continue
            block_labels[block] = label
    return block_labels


def read_reference_labels_by_xlink_attr(xml: str) -> dict[str, str]:
    """读取 Document.xml 内各 XLink 对应引用对象的 ``Label``（装配树子件标签）。"""
    labels: dict[str, str] = {}
    for m in XLINK_FILE_RE.finditer(xml):
        attr = m.group(2).strip()
        if not attr:
            continue
        block = _find_object_block_span(xml, m.start())
        if block is None:
            continue
        lm = LABEL_STRING_RE.search(xml[block[0] : block[1]])
        if lm:
            labels[attr] = lm.group(2)
    return labels


def read_host_reference_labels(repo_root: Path, host_repo_rel: str) -> dict[str, str]:
    from fcdesk.freecad.bom_xref.extract import read_document_xml_from_fcstd

    path = (repo_root.expanduser().resolve(strict=False) / host_repo_rel.strip()).resolve(strict=False)
    if not path.is_file():
        return {}
    xml = read_document_xml_from_fcstd(path)
    if not xml:
        return {}
    return read_reference_labels_by_xlink_attr(xml)


def plan_explicit_reference_label_updates(
    xml: str,
    attr_labels: dict[str, str],
) -> dict[tuple[int, int], str]:
    """按 XLink ``file`` 属性指定引用实例 ``Label``（手工编辑）。"""
    if not attr_labels:
        return {}
    block_labels: dict[tuple[int, int], str] = {}
    for m in XLINK_FILE_RE.finditer(xml):
        attr = m.group(2).strip()
        if attr not in attr_labels:
            continue
        block = _find_object_block_span(xml, m.start())
        if block is None:
            continue
        block_labels[block] = attr_labels[attr]
    return block_labels


def patch_fcstd_reference_labels_explicit(
    fcstd_path: Path,
    attr_labels: dict[str, str],
) -> tuple[int, list[dict[str, str]]]:
    """仅写回指定 XLink 引用实例的 ``Label``。返回 ``(变更数, 变更明细)``。"""
    if not attr_labels:
        return 0, []
    xml = _read_document_xml_from_fcstd(fcstd_path)
    if xml is None:
        raise RenameAnalysisError(f"无法读取 Document.xml：{fcstd_path}")
    block_labels = plan_explicit_reference_label_updates(xml, attr_labels)
    xml, label_count, changes = _patch_reference_labels_in_xml(xml, block_labels)
    if label_count == 0:
        return 0, []
    try:
        _rewrite_fcstd_document_xml(fcstd_path, xml)
    except OSError as e:
        raise RenameAnalysisError(f"写回失败（可能被占用）：{fcstd_path} · {e}") from e
    return label_count, changes


def _patch_reference_labels_in_xml(
    xml: str,
    block_labels: dict[tuple[int, int], str],
) -> tuple[str, int, list[dict[str, str]]]:
    if not block_labels:
        return xml, 0, []
    count = 0
    changes: list[dict[str, str]] = []
    for (start, end), label in sorted(block_labels.items(), key=lambda item: item[0][0], reverse=True):
        block = xml[start:end]
        m = LABEL_STRING_RE.search(block)
        if m is None or m.group(2) == label:
            continue
        old_label = m.group(2)
        xlink_m = XLINK_FILE_RE.search(block)
        xlink_attr = xlink_m.group(2).strip() if xlink_m else ""
        changes.append(
            {
                "xlink_file_attr": xlink_attr,
                "old_label": old_label,
                "new_label": label,
            }
        )
        new_block = block[: m.start(2)] + label + block[m.end(2) :]
        xml = xml[:start] + new_block + xml[end:]
        count += 1
    changes.reverse()
    return xml, count, changes


def patch_fcstd_reference_labels(
    fcstd_path: Path,
    hits: list[XLinkBasenameHit],
    *,
    repo_root: Path,
    host_repo_rel: str,
) -> tuple[int, list[dict[str, str]]]:
    """仅写回引用实例 ``Label``（不改 XLink ``file``）。返回 ``(变更数, 变更明细)``。"""
    if not hits:
        return 0, []
    xml = _read_document_xml_from_fcstd(fcstd_path)
    if xml is None:
        raise RenameAnalysisError(f"无法读取 Document.xml：{fcstd_path}")

    block_labels = _plan_reference_label_updates(
        xml,
        hits,
        repo_root=repo_root,
        host_repo_rel=host_repo_rel,
    )
    xml, label_count, changes = _patch_reference_labels_in_xml(xml, block_labels)
    if label_count == 0:
        return 0, []
    try:
        _rewrite_fcstd_document_xml(fcstd_path, xml)
    except OSError as e:
        raise RenameAnalysisError(f"写回失败（可能被占用）：{fcstd_path} · {e}") from e
    return label_count, changes


def patch_fcstd_host_corrections(
    fcstd_path: Path,
    hits: list[XLinkBasenameHit],
    *,
    repo_root: Path,
    host_repo_rel: str,
    sync_reference_labels: bool = False,
) -> tuple[int, int]:
    """写回 XLink ``file``，可选同步装配内引用实例 ``Label``。返回 ``(xlink_patches, label_patches)``。"""
    replacements = {
        h.xlink_file_attr: h.proposed_new_attr
        for h in hits
        if h.proposed_new_attr != h.xlink_file_attr
    }
    if not replacements and not sync_reference_labels:
        return 0, 0

    xml = _read_document_xml_from_fcstd(fcstd_path)
    if xml is None:
        raise RenameAnalysisError(f"无法读取 Document.xml：{fcstd_path}")

    label_count = 0
    if sync_reference_labels:
        block_labels = _plan_reference_label_updates(
            xml,
            hits,
            repo_root=repo_root,
            host_repo_rel=host_repo_rel,
        )
        xml, label_count, _changes = _patch_reference_labels_in_xml(xml, block_labels)

    xml, xlink_count = _patch_xlink_attrs_in_xml(xml, replacements)

    if xlink_count == 0 and label_count == 0:
        return 0, 0
    try:
        _rewrite_fcstd_document_xml(fcstd_path, xml)
    except OSError as e:
        raise RenameAnalysisError(f"写回失败（可能被占用）：{fcstd_path} · {e}") from e
    return xlink_count, label_count


def scan_fcstd_host_hits(
    host_path: Path,
    *,
    repo_root: Path,
    old_basename: str,
    new_basename: str,
) -> list[XLinkBasenameHit]:
    xml = _read_document_xml_from_fcstd(host_path)
    if xml is None:
        return []
    try:
        rel = os.path.relpath(host_path.resolve(), repo_root.resolve()).replace(os.sep, "/")
    except ValueError:
        rel = host_path.as_posix()
    pairs = scan_document_xml_xlink_hits(xml, old_basename=old_basename, new_basename=new_basename)
    return [
        XLinkBasenameHit(
            host_repo_rel_path=rel,
            xlink_file_attr=old_attr,
            proposed_new_attr=new_attr,
        )
        for old_attr, new_attr in pairs
    ]


def analyze_workspace_xlink_refs(
    repo_root: Path,
    *,
    old_basename: str,
    new_basename: str,
    scan_root: Path | None = None,
    exclude_repo_rel: str | None = None,
) -> list[HostRefGroup]:
    """扫描工作空间内 FCStd 宿主文件中仍引用 ``old_basename`` 的 XLink。"""
    rr = repo_root.expanduser().resolve(strict=False)
    root = (scan_root or rr).expanduser().resolve(strict=False)
    if not root.is_dir():
        raise RenameAnalysisError(f"扫描根不是有效目录: {root}")

    exclude_key = (exclude_repo_rel or "").replace("\\", "/").strip().lstrip("./")
    groups: dict[str, list[XLinkBasenameHit]] = {}

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in _SKIP_DIRS]
        for name in filenames:
            if not is_fcstd_filename(name):
                continue
            host_path = Path(dirpath, name).resolve()
            try:
                rel = os.path.relpath(host_path, rr).replace(os.sep, "/")
            except ValueError:
                continue
            if exclude_key and rel.replace("\\", "/").lstrip("./") == exclude_key:
                continue
            hits = scan_fcstd_host_hits(
                host_path,
                repo_root=rr,
                old_basename=old_basename,
                new_basename=new_basename,
            )
            if hits:
                groups[rel] = hits

    out: list[HostRefGroup] = []
    for rel in sorted(groups.keys()):
        hits = groups[rel]
        out.append(
            HostRefGroup(
                host_repo_rel_path=rel,
                host_filename=Path(rel).name,
                hits=tuple(hits),
            )
        )
    return out


def apply_host_reference_label_corrections(
    repo_root: Path,
    host_repo_rel_path: str,
    hits: list[XLinkBasenameHit],
) -> tuple[int, list[dict[str, str]]]:
    """对单个宿主文件仅同步引用实例 Label。返回 ``(变更数, 变更明细)``。"""
    rr = repo_root.expanduser().resolve(strict=False)
    host = (rr / host_repo_rel_path).resolve(strict=False)
    if not host.is_file():
        raise RenameAnalysisError(f"宿主文件不存在：{host_repo_rel_path}")
    if not hits:
        return 0, []
    return patch_fcstd_reference_labels(
        host,
        hits,
        repo_root=rr,
        host_repo_rel=host_repo_rel_path,
    )


def apply_host_xlink_corrections(
    repo_root: Path,
    host_repo_rel_path: str,
    hits: list[XLinkBasenameHit],
    *,
    sync_reference_labels: bool = False,
) -> tuple[int, int]:
    """对单个宿主文件应用 XLink 替换，可选同步引用实例 Label。"""
    rr = repo_root.expanduser().resolve(strict=False)
    host = (rr / host_repo_rel_path).resolve(strict=False)
    if not host.is_file():
        raise RenameAnalysisError(f"宿主文件不存在：{host_repo_rel_path}")
    pending = [h for h in hits if h.proposed_new_attr != h.xlink_file_attr]
    if not pending and not sync_reference_labels:
        return 0, 0
    return patch_fcstd_host_corrections(
        host,
        pending,
        repo_root=rr,
        host_repo_rel=host_repo_rel_path,
        sync_reference_labels=sync_reference_labels,
    )
