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

_SKIP_DIRS = frozenset({".git", ".phoenix", "__pycache__", "node_modules", ".venv", "venv"})


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

    count = 0

    def repl(m: re.Match[str]) -> str:
        nonlocal count
        old = m.group(2)
        new = replacements.get(old)
        if new is None:
            return m.group(0)
        count += 1
        return f"{m.group(1)}{new}{m.group(3)}"

    new_xml = XLINK_FILE_RE.sub(repl, xml)
    if count == 0:
        return 0
    try:
        _rewrite_fcstd_document_xml(fcstd_path, new_xml)
    except OSError as e:
        raise RenameAnalysisError(f"写回失败（可能被占用）：{fcstd_path} · {e}") from e
    return count


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


def apply_host_xlink_corrections(
    repo_root: Path,
    host_repo_rel_path: str,
    hits: list[XLinkBasenameHit],
) -> int:
    """对单个宿主文件应用一组 XLink 替换。"""
    rr = repo_root.expanduser().resolve(strict=False)
    host = (rr / host_repo_rel_path).resolve(strict=False)
    if not host.is_file():
        raise RenameAnalysisError(f"宿主文件不存在：{host_repo_rel_path}")
    replacements = {h.xlink_file_attr: h.proposed_new_attr for h in hits}
    return patch_fcstd_xlink_attrs(host, replacements)
