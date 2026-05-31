"""从 FCStd 提取 Document.xml 内的 XLink file 属性。"""

from __future__ import annotations

import zipfile
from pathlib import Path

from fcdesk.freecad.cad_index_types import is_fcstd_filename
from fcdesk.freecad.rename_analysis.xlink import XLINK_FILE_RE


def read_document_xml_from_fcstd(path: Path) -> str | None:
    try:
        with zipfile.ZipFile(path, "r") as zf:
            if "Document.xml" not in zf.namelist():
                return None
            return zf.read("Document.xml").decode("utf-8", errors="replace")
    except (OSError, zipfile.BadZipFile, UnicodeDecodeError):
        return None


def list_xlink_file_attrs(xml: str) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for m in XLINK_FILE_RE.finditer(xml):
        attr = m.group(2).strip()
        if not attr or attr in seen:
            continue
        seen.add(attr)
        out.append(attr)
    return out


def list_fcstd_xlink_attrs_from_file(fcstd_path: Path) -> list[str]:
    if not is_fcstd_filename(fcstd_path.name):
        return []
    xml = read_document_xml_from_fcstd(fcstd_path)
    if xml is None:
        return []
    return [a for a in list_xlink_file_attrs(xml) if a.lower().endswith(".fcstd")]
