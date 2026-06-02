"""零件名 / Part Key 解析（统一算法入口）。

从 FCStd 等 CAD 文件名、label、路径推断 ``PartNumber``、``PartVersion``、``TypeCode``、
``ModelSeries``、``PartName`` 等；供索引扫描、XLink、BOM、Web 树点击共用。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

_DRAWING_STEM_SUFFIX = re.compile(r"\.drawing$", re.IGNORECASE)
_PART_KEY_PREFIX = re.compile(r"^(\d+(?:\.\d+)?)\.(\d{1,3})(?=[\-_.]|$)")
_INFIX_TYPE = re.compile(r"[-._]([HSR])[-._]", re.IGNORECASE)
_SERIES_DIGITS_TB = re.compile(r"(?<![A-Za-z0-9])(\d+)TB\b", re.IGNORECASE)
_SAMPLE_TB_SEGMENT = re.compile(r"Sample(\d+)TB", re.IGNORECASE)
_PART_KEY_TEXT = re.compile(r"^(\d+(?:\.\d+)?)\.(\d{1,3})$")


class PartNamingParser:
    """零件名解析：Part Key、BOM 字段与 ``PartName`` 名称段推断。"""

    @staticmethod
    def normalize_filename_stem(filename: str) -> str:
        """去掉扩展名与 ``.Drawing`` 后缀。"""
        name = Path(filename.replace("\\", "/")).name
        stem = Path(name).stem
        return _DRAWING_STEM_SUFFIX.sub("", stem)

    @staticmethod
    def normalize_part_version(pv: str) -> str:
        s = (pv or "").strip()
        if not s:
            return ""
        if len(s) < 3:
            return s.zfill(3)
        return s

    @classmethod
    def parse_part_number_version_from_stem(cls, stem: str) -> tuple[str, str]:
        """从文件名主干解析零件号与版本（短号如 ``8001`` 亦可）。"""
        # ``9.3-灯座`` → 9 / 003（优先于把小数点当零件号一部分）
        m_label = re.match(r"^(\d+)\.(\d{1,3})(?=[\-_.])", stem)
        if m_label:
            return m_label.group(1), cls.normalize_part_version(m_label.group(2))

        m = _PART_KEY_PREFIX.match(stem)
        if m:
            pn = m.group(1)
            pv = m.group(2)
            if len(pv) < 3:
                pv = pv.zfill(3)
            return pn, cls.normalize_part_version(pv)

        pn = ""
        mp = re.match(r"^(\d+(?:\.\d+)?)", stem)
        if mp:
            pn = mp.group(1)

        pv = ""
        m_ver = re.search(r"\.(\d{1,3})(?=[\-_.]|$)", stem)
        if m_ver:
            pv = m_ver.group(1)
            if len(pv) < 3:
                pv = pv.zfill(3)
            pv = cls.normalize_part_version(pv)

        return pn, pv

    @classmethod
    def parse_part_key_text(cls, raw: str) -> dict[str, str] | None:
        """解析用户输入的 Part Key 文本（如 ``8001.001``）。"""
        s = (raw or "").strip()
        if not s:
            return None
        m = _PART_KEY_TEXT.match(s)
        if not m:
            return None
        pn = m.group(1)
        pv = cls.normalize_part_version(m.group(2))
        from fcdesk.freecad.phoenix_store import format_part_key

        part_key = format_part_key(pn, pv)
        return {
            "part_number": pn,
            "part_version": pv,
            "part_key": part_key,
        }

    @classmethod
    def hints_from_filename(cls, filename: str) -> dict[str, Any]:
        """从文件名推断 BOM 字段（不访问磁盘）。"""
        stem = cls.normalize_filename_stem(filename)
        out: dict[str, Any] = {}

        pn, pv = cls.parse_part_number_version_from_stem(stem)
        if pn:
            out["PartNumber"] = pn
        if pv:
            out["PartVersion"] = pv

        mt = _INFIX_TYPE.search(stem)
        if mt:
            t = (mt.group(1) or "").upper()
            if t in frozenset("HSR"):
                out["TypeCode"] = t

        return out

    @classmethod
    def infer_model_series(cls, *, stem: str, rel_posix: str) -> str | None:
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

    @classmethod
    def hints_from_location(cls, filename: str, repo_rel_path: str) -> dict[str, Any]:
        h = dict(cls.hints_from_filename(filename))
        rp = repo_rel_path.replace("\\", "/")
        stem = Path(filename).stem
        ms = cls.infer_model_series(stem=stem, rel_posix=rp)
        if ms:
            h["ModelSeries"] = ms
        return h

    @classmethod
    def part_key_hints_from_basename(cls, basename: str) -> dict[str, str]:
        name = Path(basename.replace("\\", "/")).name
        hints = cls.hints_from_filename(name)
        pn = str(hints.get("PartNumber") or "").strip()
        pv = cls.normalize_part_version(str(hints.get("PartVersion") or ""))
        pk = ""
        if pn and pv:
            from fcdesk.freecad.phoenix_store import format_part_key

            pk = format_part_key(pn, pv)
        return {
            "basename": name,
            "part_number": pn,
            "part_version": pv,
            "part_key": pk,
            "TypeCode": str(hints.get("TypeCode") or "").strip(),
        }

    @classmethod
    def infer_part_key_from_filename(cls, filename: str) -> tuple[str, str]:
        h = cls.part_key_hints_from_basename(filename)
        return h["part_number"], h["part_version"]

    @staticmethod
    def _strip_leading_field_token(text: str, token: str | None) -> str:
        tok = (token or "").strip()
        if not tok or not text:
            return text
        tu = tok.upper()
        body = text
        bu = body.upper()
        if bu == tu:
            return ""
        for sep in ("-", "_", "."):
            pref = f"{sep}{tok}"
            if bu.startswith(pref.upper()):
                return body[len(pref) :].lstrip("-._ ")
        if bu.startswith(tu) and len(body) > len(tok) and body[len(tok)] in "-._":
            return body[len(tok) :].lstrip("-._ ")
        return body

    @staticmethod
    def _merge_field(*values: str | None) -> str:
        for v in values:
            s = (v or "").strip()
            if s:
                return s
        return ""

    @staticmethod
    def _normalize_name_stem(text: str) -> str:
        s = (text or "").strip()
        if not s:
            return ""
        if Path(s).suffix.casefold() == ".fcstd":
            s = Path(s).stem
        low = s.casefold()
        for extra in (".drawing", ".assy"):
            if low.endswith(extra):
                s = s[: -len(extra)]
                break
        return s.strip()

    @staticmethod
    def _infer_model_series_from_stem_for_name(stem: str) -> str | None:
        m = re.search(
            r"[-._]([HSR])[-._]([A-Za-z0-9]{2,24})([-._].+)$",
            stem,
            re.IGNORECASE,
        )
        if not m:
            return None
        tok = (m.group(2) or "").upper()
        return tok if len(tok) >= 2 else None

    @classmethod
    def _infer_bom_fields_from_text(cls, text: str) -> dict[str, str]:
        stem = cls._normalize_name_stem(text)
        if not stem:
            return {}
        out: dict[str, str] = {}
        h = cls.hints_from_filename(f"{stem}.FCStd")
        for key in ("PartNumber", "PartVersion", "TypeCode"):
            v = h.get(key)
            if v:
                out[key] = str(v).strip()
        if not out.get("PartVersion"):
            m_ver = re.search(r"\.(\d+)[-._]", stem)
            if m_ver:
                out["PartVersion"] = m_ver.group(1)
        ms = cls._infer_model_series_from_stem_for_name(stem)
        if ms:
            out["ModelSeries"] = ms
        return out

    @staticmethod
    def _compose_stem_prefix(
        part_number: str,
        part_version: str,
        *,
        type_code: str = "",
        model_series: str = "",
    ) -> str:
        base = f"{part_number}.{part_version}"
        tc = (type_code or "").strip().upper()
        ms = (model_series or "").strip().upper()
        if tc:
            base += f"-{tc}"
        if ms:
            base += f"-{ms}"
        return base

    @staticmethod
    def _extract_tail_after_prefix(text: str, prefix: str) -> str | None:
        if not text or not prefix:
            return None
        if text.casefold() == prefix.casefold():
            return ""
        dash_prefix = f"{prefix}-"
        if text.casefold().startswith(dash_prefix.casefold()):
            return text[len(dash_prefix) :].strip()
        if text.casefold().startswith(prefix.casefold()):
            return text[len(prefix) :].lstrip("-._ ").strip()
        return None

    @classmethod
    def _merged_bom_fields_for_name(
        cls,
        raw: str,
        *,
        part_number: str | None = None,
        part_version: str | None = None,
        type_code: str | None = None,
        model_series: str | None = None,
        filename: str | None = None,
        repo_rel_path: str | None = None,
    ) -> tuple[str, str, str, str]:
        text_hints = cls._infer_bom_fields_from_text(raw)
        file_hints = cls._infer_bom_fields_from_text(filename) if filename else {}
        if filename and repo_rel_path:
            loc = cls.hints_from_location(Path(filename).name, repo_rel_path)
            ms = loc.get("ModelSeries")
            if ms and not file_hints.get("ModelSeries"):
                file_hints["ModelSeries"] = str(ms).upper()

        pn = cls._merge_field(part_number, text_hints.get("PartNumber"), file_hints.get("PartNumber"))
        pv = cls._merge_field(part_version, text_hints.get("PartVersion"), file_hints.get("PartVersion"))
        tc = cls._merge_field(type_code, text_hints.get("TypeCode"), file_hints.get("TypeCode")).upper()
        ms = cls._merge_field(model_series, text_hints.get("ModelSeries"), file_hints.get("ModelSeries")).upper()
        return pn, pv, tc, ms

    @staticmethod
    def _is_structural_token(token: str, *, pn: str, pv: str, tc: str, ms: str) -> bool:
        tu = token.upper()
        if not tu:
            return True
        if pn and tu == pn.upper():
            return True
        if pv and tu == pv.upper():
            return True
        if tc and tu == tc.upper():
            return True
        if ms and tu == ms.upper():
            return True
        return False

    @classmethod
    def refine_inferred_part_name(
        cls,
        raw: str,
        *,
        part_number: str | None = None,
        part_version: str | None = None,
        type_code: str | None = None,
        model_series: str | None = None,
        filename: str | None = None,
        repo_rel_path: str | None = None,
    ) -> str | None:
        s = cls._normalize_name_stem(raw)
        if not s:
            return None

        pn, pv, tc, ms = cls._merged_bom_fields_for_name(
            s,
            part_number=part_number,
            part_version=part_version,
            type_code=type_code,
            model_series=model_series,
            filename=filename,
            repo_rel_path=repo_rel_path,
        )

        if pn and pv:
            prefixes = [f"{pn}.{pv}"]
            if pv.isdigit():
                alt = f"{pn}.{int(pv)}"
                if alt not in prefixes:
                    prefixes.append(alt)
            if tc:
                prefixes.append(cls._compose_stem_prefix(pn, pv, type_code=tc))
                if ms:
                    prefixes.append(cls._compose_stem_prefix(pn, pv, type_code=tc, model_series=ms))
            elif ms:
                prefixes.append(cls._compose_stem_prefix(pn, pv, model_series=ms))

            for pref in sorted(prefixes, key=len, reverse=True):
                tail = cls._extract_tail_after_prefix(s, pref)
                if tail is None:
                    continue
                tail = tail.strip("-._ ")
                if not tail:
                    return None
                first_seg = re.split(r"[-._]+", tail, maxsplit=1)[0]
                if cls._is_structural_token(first_seg, pn=pn, pv=pv, tc=tc, ms=ms):
                    continue
                return tail

        for _ in range(10):
            prev = s
            if pn and pv:
                for pref in (f"{pn}.{pv}-", f"{pn}.{pv}"):
                    if s.casefold().startswith(pref.casefold()):
                        s = s[len(pref) :].lstrip("-._ ").strip()
                        break
            for tok in (tc, ms):
                if tok:
                    s = cls._strip_leading_field_token(s, tok)
            s = s.strip("-._ ")
            if s == prev:
                break

        if not s:
            return None
        if cls._is_structural_token(s, pn=pn, pv=pv, tc=tc, ms=ms):
            return None
        if re.fullmatch(r"\d+", s):
            return None
        return s

    @classmethod
    def infer_part_name_from_filename(
        cls,
        filename: str,
        *,
        part_number: str | None = None,
        part_version: str | None = None,
        type_code: str | None = None,
        model_series: str | None = None,
        repo_rel_path: str | None = None,
    ) -> str | None:
        return cls.refine_inferred_part_name(
            filename,
            part_number=part_number,
            part_version=part_version,
            type_code=type_code,
            model_series=model_series,
            filename=filename,
            repo_rel_path=repo_rel_path,
        )

    @classmethod
    def coerce_inferred_part_name(
        cls,
        part_name: str | None,
        label: str | None = None,
        *,
        filename: str | None = None,
        repo_rel_path: str | None = None,
        part_number: str | None = None,
        part_version: str | None = None,
        type_code: str | None = None,
        model_series: str | None = None,
    ) -> str | None:
        existing = (part_name or "").strip()
        if existing:
            return existing

        pn, pv, tc, ms = cls._merged_bom_fields_for_name(
            cls._merge_field(label, filename),
            part_number=part_number,
            part_version=part_version,
            type_code=type_code,
            model_series=model_series,
            filename=filename,
            repo_rel_path=repo_rel_path,
        )

        if label:
            refined = cls.refine_inferred_part_name(
                label,
                part_number=pn,
                part_version=pv,
                type_code=tc,
                model_series=ms,
                filename=filename,
                repo_rel_path=repo_rel_path,
            )
            if refined:
                return refined
        if filename:
            return cls.infer_part_name_from_filename(
                filename,
                part_number=pn,
                part_version=pv,
                type_code=tc,
                model_series=ms,
                repo_rel_path=repo_rel_path,
            )
        return None


# 模块级默认实例，便于 ``PartNamingParser.xxx`` 与旧函数式 API 并存
default_part_naming_parser = PartNamingParser()
