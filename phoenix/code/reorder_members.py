#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Reorder C++ class member declarations (.h) and definitions (.cpp) per cxx-code-style skill.

Full rules (zh): doc/code/成员函数排序-reorder_members.md

Usage:
    python -m phoenix.code.reorder_members <directory|file> [options]

Options:
    --dry-run       Print changes without writing files
    --cpp-only      Process .cpp only
    --header-only   Process .h / .hpp only
    --sort-members  Sort member variables in .h (default: keep source order)
    --verbose       Print per-file details

Rules (summary):
    P0    locked regions: clang-format / CAA Wizard / #pragma region … — whole blocks
          frozen first (see reorder_avoidance.py); never sorted with other members
    .cpp  special members: default ctor -> other ctors -> dtor -> copy/move ctor -> operator=;
          then rest alphabetically (case-insensitive name); same-name overloads keep source order;
          remove blank lines between functions; add //--- separator if missing;
          move leading // or /* */ comments with the function;
          member initializer lists use () not {} (e.g. build_(100101), not build_{100101})
    .h    per access section (public:/private:/…): special members first (same order as .cpp),
          then all other declarations alphabetically (case-insensitive name); same-name overloads keep source order;
          member variables: keep source order and slot position (use --sort-members to alphabetize members only)
          supports export macro: class ExportedByModule ClassName : ...
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

from phoenix.code.reorder_avoidance import split_by_avoidance_rules
from phoenix.code.reorder_ignore import load_ignore_patterns
from phoenix.code.ignore import is_ignored_name
from phoenix.code.rename.encoding import (
    detect_and_read,
    text_content_equivalent,
    write_text_if_changed,
    would_change_on_disk,
)

# 运行日志 / 摘要中标记「此文件有成员排序变更」（Web 侧栏、CLI 共用）
CHANGED_LOG_MARK = "✎"


def format_changed_file_log_line(rel_path: str, *, indent: str = "  ") -> str:
    """单行变更文件列表项，如 ``  ✎ Mod/a.cpp``。"""
    return f"{indent}{CHANGED_LOG_MARK} {rel_path}"


SEP_LINE_RE = re.compile(r"^//-+\s*$", re.MULTILINE)
ACCESS_RE = re.compile(
    r"^(\s*)((?:public|private|protected)(?:\s+slots)?|signals)[ \t]*:[ \t]*(?://[^\r\n]*)?\s*$",
    re.MULTILINE,
)
# Optional export / attribute tokens before class name: ExportedByModule ClassName
CLASS_RE = re.compile(
    r"(?<!enum\s)\bclass\s+(?:\w+\s+)*(\w+)\s*(?:final\s*)?(?::\s*[^{;]+)?\s*\{",
)
CPP_IMPL_RE = re.compile(
    r"\b(\w+)::((?:~\w+)|~?\w+|operator\s*[^\(\s]+)\s*[\(<]",
)

# Class-body macro invocations: Q_OBJECT, AB_DECLARE_Foo(...), AB_BASE_IMPLEMENT_*(...)
_CLASS_BODY_MACRO_RE = re.compile(
    r"^[A-Z][A-Z0-9_]*.*(?:DECLARE|IMPLEMENT)\w*\s*\(",
)


def _is_class_body_macro(stripped: str) -> bool:
    """True for Qt / friend / ALL_CAPS project macro invocations inside a class."""
    if stripped.startswith("Q_") or stripped.startswith("friend "):
        return True
    return bool(_CLASS_BODY_MACRO_RE.match(stripped))


# ---------------------------------------------------------------------------
# Sort keys
# ---------------------------------------------------------------------------


def _ci(name: str) -> str:
    return name.casefold()


def sort_case_insensitive(name: str) -> str:
    return _ci(name)


SPECIAL_MEMBER_ORDER = {
    "default_ctor": 0,
    "other_ctor": 1,
    "dtor": 2,
    "copy_ctor": 3,
    "move_ctor": 4,
    "copy_assign": 5,
    "move_assign": 6,
    "other_special": 7,
}


def _flatten_sig(text: str) -> str:
    return " ".join(text.split())


def _classify_special_member(class_name: str, impl_name: str, text: str) -> str:
    """
    Classify ctor/dtor/operator special members.
    Order: default ctor -> other ctors -> dtor -> copy ctor -> move ctor -> operator= ...
    """
    flat = _flatten_sig(text)
    if impl_name.startswith("~") or impl_name == f"~{class_name}":
        return "dtor"
    if impl_name.startswith("operator"):
        after = flat.split("operator=", 1)[1] if "operator=" in flat else ""
        if "operator=" in flat:
            return "move_assign" if "&&" in after[:40] else "copy_assign"
        return "other_special"
    if impl_name == class_name:
        if re.search(rf"\b{re.escape(class_name)}\s*\(\s*const\s+{re.escape(class_name)}\s*&", flat):
            return "copy_ctor"
        if re.search(rf"\b{re.escape(class_name)}\s*\(\s*{re.escape(class_name)}\s*&&", flat):
            return "move_ctor"
        if re.search(rf"\b{re.escape(class_name)}\s*\(\s*\)", flat):
            return "default_ctor"
        return "other_ctor"
    return "member"


def sort_special_member_key(class_name: str, impl_name: str, text: str = "") -> Tuple[int, str]:
    kind = _classify_special_member(class_name, impl_name, text)
    if kind == "member":
        return (99, sort_case_insensitive(impl_name))
    return (SPECIAL_MEMBER_ORDER[kind], sort_case_insensitive(impl_name))


def sort_special_cpp_key(class_name: str, impl_name: str) -> Tuple[int, str]:
    return sort_special_member_key(class_name, impl_name, "")


# ---------------------------------------------------------------------------
# .cpp reorder
# ---------------------------------------------------------------------------


def _find_class_name(cpp_text: str, file_stem: str) -> Optional[str]:
    counts: dict[str, int] = {}
    for cls, impl in CPP_IMPL_RE.findall(cpp_text):
        if cls and cls[0].isupper():
            counts[cls] = counts.get(cls, 0) + 1
    if not counts:
        return None
    if file_stem in counts:
        return file_stem
    return max(counts, key=counts.get)


def _split_cpp_preamble_and_body(text: str, class_name: str) -> Tuple[str, str]:
    """Return (preamble before first ctor, rest from first ctor)."""
    ctor_pat = re.compile(
        rf"^[ \t]*(?:[\w:<>,\s*&]+\s+)?\b{re.escape(class_name)}::{re.escape(class_name)}\s*\(",
        re.MULTILINE,
    )
    m = ctor_pat.search(text)
    if not m:
        return text, ""

    start = m.start()
    start = _include_return_type_lines(text, start, 0, class_name)

    line_start = text.rfind("\n", 0, start) + 1
    prev_line_end = line_start - 1
    if prev_line_end > 0:
        prev_line_start = text.rfind("\n", 0, prev_line_end) + 1
        prev_stripped = text[prev_line_start:prev_line_end + 1].strip()
        if SEP_LINE_RE.match(prev_stripped):
            start = prev_line_start

    return text[:start], text[start:]


DEFAULT_CPP_SEP = "//----------------------------------------\n"


def _normalize_sep_line(sep: str) -> str:
    if not sep:
        return DEFAULT_CPP_SEP
    s = sep.strip("\r\n")
    if not s:
        return DEFAULT_CPP_SEP
    return s + "\n"


def _strip_block_outer_blanks(text: str) -> str:
    """Remove leading/trailing blank lines; keep internal content and attached comments."""
    if not text:
        return ""
    lines = text.splitlines(keepends=True)
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return ""
    out = "".join(lines)
    return out if out.endswith("\n") else out + "\n"


def _clean_block_text(text: str) -> str:
    """Normalize block text: strip outer blanks, detach glued //---, drop embedded separator lines."""
    text = _strip_block_outer_blanks(text)
    if not text:
        return ""
    text = re.sub(r"\}(//-+\s*)$", "}\n", text.rstrip("\r\n"))
    text = re.sub(r"^(//-+\s*\n)+", "", text)
    text = re.sub(r"(//-+\s*\n)+$", "", text.rstrip("\r\n"))
    if not text:
        return ""
    if not text.endswith("\n"):
        text += "\n"
    return text


def _is_cpp_code_position(body: str, index: int) -> bool:
    """``index`` 不在 ``//``、块注释或字符串/字符字面量内时为真。"""
    i = 0
    n = len(body)
    while i < n and i < index:
        c = body[i]
        if c == "/" and i + 1 < n:
            if body[i + 1] == "/":
                end = i + 2
                while end < n and body[end] not in "\r\n":
                    end += 1
                if i <= index < end:
                    return False
                i = end
                continue
            if body[i + 1] == "*":
                end = i + 2
                while end + 1 < n and not (body[end] == "*" and body[end + 1] == "/"):
                    end += 1
                end = min(end + 2, n)
                if i <= index < end:
                    return False
                i = end
                continue
        if c == '"':
            end = i + 1
            while end < n:
                if body[end] == "\\":
                    end += 2
                    continue
                if body[end] == '"':
                    end += 1
                    break
                end += 1
            if i <= index < end:
                return False
            i = end
            continue
        if c == "'":
            end = i + 1
            while end < n:
                if body[end] == "\\":
                    end += 2
                    continue
                if body[end] == "'":
                    end += 1
                    break
                end += 1
            if i <= index < end:
                return False
            i = end
            continue
        i += 1
    return True


def _advance_past_function_end(body: str, i: int, n: int) -> int:
    """Skip trailing same-line //--- and blank lines after closing brace/semicolon."""
    while i < n and body[i] in " \t":
        i += 1
    if i + 1 < n and body[i] == "/" and body[i + 1] == "/":
        while i < n and body[i] not in "\r\n":
            i += 1
    while i < n and body[i] in "\r\n":
        i += 1
    return i


def _find_function_body_end(body: str, impl_start: int) -> int:
    """Return index after the closing brace (or semicolon) of a member function definition."""
    n = len(body)
    paren_start = body.find("(", impl_start)
    if paren_start < 0:
        return n

    paren = 1
    i = paren_start + 1
    while i < n and paren > 0:
        c = body[i]
        if c == "(":
            paren += 1
        elif c == ")":
            paren -= 1
        i += 1

    while i < n:
        while i < n and body[i] in " \t\r\n":
            i += 1
        if i >= n:
            return n

        c = body[i]
        if c == "{":
            depth = 1
            i += 1
            while i < n and depth > 0:
                if body[i] == "{":
                    depth += 1
                elif body[i] == "}":
                    depth -= 1
                i += 1
            return _advance_past_function_end(body, i, n)

        if c == ";":
            i += 1
            while i < n and body[i] not in "\r\n":
                i += 1
            return _advance_past_function_end(body, i, n)

        if c == ":":
            i += 1
            paren_depth = 0
            brace_depth = 0
            while i < n:
                while i < n and body[i] in " \t\r\n":
                    i += 1
                if i >= n:
                    return n
                ic = body[i]
                if ic == "(":
                    paren_depth += 1
                    i += 1
                elif ic == ")":
                    paren_depth = max(0, paren_depth - 1)
                    i += 1
                elif ic == "{":
                    if paren_depth == 0 and brace_depth == 0:
                        prev = i - 1
                        while prev >= 0 and body[prev] in " \t":
                            prev -= 1
                        if prev >= 0 and body[prev] == ")":
                            break
                        if prev >= 0 and (
                            body[prev] in "_=," or body[prev].isalnum()
                        ):
                            brace_depth += 1
                            i += 1
                        else:
                            break
                    else:
                        brace_depth += 1
                        i += 1
                elif ic == "}":
                    brace_depth = max(0, brace_depth - 1)
                    i += 1
                else:
                    i += 1
            continue

        if c.isalpha() or c == "_":
            while i < n and (body[i].isalnum() or body[i] in "_:"):
                i += 1
            continue

        i += 1

    return n


def _is_return_type_line(stripped: str, class_name: str) -> bool:
    """True if line is a return-type continuation above ClassName::method (clang-format split)."""
    if not stripped or SEP_LINE_RE.match(stripped):
        return False
    if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("#"):
        return False
    if stripped.endswith("}") or stripped.endswith(";") or stripped.endswith("{"):
        return False
    if re.search(rf"\b{re.escape(class_name)}::", stripped):
        return False
    if "(" in stripped or ")" in stripped:
        return False
    return bool(
        re.match(
            r"^[\w:<>,\s*&]+(?:const|volatile|static|virtual|constexpr|inline|"
            r"unsigned|signed|long|short|friend|explicit|mutable|\*)*\s*$",
            stripped,
        )
    )


def _include_return_type_lines(body: str, block_start: int, prev_end: int, class_name: str) -> int:
    """Walk upward to include return-type line(s) split above ClassName::method."""
    pos = block_start
    while pos > prev_end:
        line_end = pos - 1
        while line_end > prev_end and body[line_end] in "\r\n":
            line_end -= 1
        if line_end <= prev_end:
            break
        line_start = body.rfind("\n", prev_end, line_end) + 1
        stripped = body[line_start : line_end + 1].strip()
        if not _is_return_type_line(stripped, class_name):
            break
        block_start = line_start
        pos = line_start
    return block_start


def _walk_back_block_start(
    body: str, func_line_start: int, prev_end: int, class_name: str = ""
) -> Tuple[int, str]:
    """
    Walk upward from the function line to include leading // or /* */ comments.
    Returns (block_start, separator_line) — separator is not part of block text.
    """
    block_start = func_line_start
    sep = ""
    pos = func_line_start

    while pos > prev_end:
        line_end = pos - 1
        while line_end > prev_end and body[line_end] in "\r\n":
            line_end -= 1
        if line_end <= prev_end:
            break
        line_start = body.rfind("\n", prev_end, line_end) + 1
        if line_start <= prev_end and prev_end > 0:
            line_start = prev_end
        line = body[line_start : line_end + 1]
        stripped = line.strip()

        if not stripped:
            break

        glued_sep = re.match(r"^}\s*(//-+\s*)$", stripped)
        if glued_sep:
            sep = _normalize_sep_line(glued_sep.group(1))
            pos = line_start
            break

        if SEP_LINE_RE.match(stripped):
            sep = _normalize_sep_line(stripped)
            pos = line_start
            break

        if stripped.endswith("*/"):
            comment_start = body.rfind("/*", prev_end, line_start)
            if comment_start >= prev_end:
                block_start = comment_start
                pos = comment_start
                continue
            break

        if stripped.startswith("//"):
            block_start = line_start
            pos = line_start
            continue

        if stripped.startswith("#"):
            break

        break

    if class_name:
        block_start = _include_return_type_lines(body, block_start, prev_end, class_name)

    return block_start, sep


def _scan_cpp_blocks(body: str, class_name: str) -> List[Tuple[str, str, str]]:
    """
    Scan member function definitions in .cpp body.
    Returns [(impl_name, block_text_without_sep, original_sep), ...] in source order.
    """
    pat = re.compile(
        rf"\b{re.escape(class_name)}::((?:~{re.escape(class_name)})|~?\w+|operator\s*[^\(\s]+)\s*[\(<]",
    )
    blocks: List[Tuple[str, str, str]] = []
    prev_end = 0

    for m in pat.finditer(body):
        if not _is_cpp_code_position(body, m.start()):
            continue
        impl_name = m.group(1)
        func_line_start = body.rfind("\n", 0, m.start()) + 1
        block_start, sep = _walk_back_block_start(body, func_line_start, prev_end, class_name)
        func_end = _find_function_body_end(body, m.start())
        text = _clean_block_text(body[block_start:func_end])
        blocks.append((impl_name, text, sep))
        prev_end = func_end

    return blocks


def _extract_cpp_blocks(body: str, class_name: str) -> Tuple[List[Tuple[str, str, str]], List[Tuple[str, str, str]]]:
    """
    Returns (special_blocks, member_blocks) each as [(impl_name, block_text, sep), ...].
    Special members: default ctor -> other ctors -> dtor -> copy/move ctor -> operator= ...
    """
    scanned = _scan_cpp_blocks(body, class_name)
    if not scanned:
        return [], []

    special_blocks: List[Tuple[str, str, str]] = []
    member_blocks: List[Tuple[str, str, str]] = []

    for impl_name, text, sep in scanned:
        entry = (impl_name, text, sep)
        kind = _classify_special_member(class_name, impl_name, text)
        if kind == "member":
            member_blocks.append(entry)
        else:
            special_blocks.append(entry)

    special_blocks.sort(
        key=lambda t: sort_special_member_key(class_name, t[0], t[1]),
    )
    member_blocks.sort(key=lambda t: sort_case_insensitive(t[0]))
    return special_blocks, member_blocks


def _rebuild_cpp_blocks(special_blocks: List[Tuple[str, str, str]], member_blocks: List[Tuple[str, str, str]]) -> str:
    """Rebuild .cpp body: no blank lines between functions; separator always on its own line."""
    out = ""
    for impl_name, text, sep in special_blocks + member_blocks:
        text = _clean_block_text(text)
        if not text:
            continue
        out += _normalize_sep_line(sep) + text
    return out


def reorder_cpp_file(path: Path, dry_run: bool = False) -> bool | None:
    payload = detect_and_read(path)
    if payload is None:
        return None
    text = payload.text
    class_name = _find_class_name(text, path.stem)
    if not class_name:
        return False

    preamble, body = _split_cpp_preamble_and_body(text, class_name)
    if not body:
        return False

    special_blocks, member_blocks = _extract_cpp_blocks(body, class_name)
    if not special_blocks and not member_blocks:
        return False

    new_body = _rebuild_cpp_blocks(special_blocks, member_blocks)
    new_text = preamble + new_body
    if not would_change_on_disk(path, payload, new_text):
        return False
    if not dry_run:
        write_text_if_changed(path, payload, new_text)
    return True


# ---------------------------------------------------------------------------
# .h reorder
# ---------------------------------------------------------------------------

DOXYGEN_GROUP_OPEN_RE = re.compile(r"^\s*///@\{")
DOXYGEN_GROUP_CLOSE_RE = re.compile(r"^\s*///@\}")
KEVIN_SYSTEM_CODE_START_RE = re.compile(r"^\s*//\s*KEVIN_SYSTEM_CODE\s+START\b")
KEVIN_SYSTEM_CODE_END_RE = re.compile(r"^\s*//\s*KEVIN_SYSTEM_CODE\s+END\b")
KEVIN_SYSTEM_CODE_NOTE_RE = re.compile(r"@note\s+KEVIN_SYSTEM_CODE\b")
FUNCTIONS_SECTION_LABEL_RE = re.compile(r"\bfunctions\b", re.IGNORECASE)
KEVIN_SYSTEM_CODE_MODES = frozenset({"merge_strip", "keep_markers", "off"})


def normalize_kevin_system_code_mode(mode: str | None) -> str:
    m = (mode or "merge_strip").strip().lower()
    return m if m in KEVIN_SYSTEM_CODE_MODES else "merge_strip"


@dataclass
class DeclItem:
    text: str
    name: str
    kind: str  # special, method, member, group, nested, macro, other
    trailing_gap: bool = False  # blank line after this item in source


@dataclass
class AccessSection:
    label: str  # e.g. "public:", "private slots:", "signals:"
    indent: str
    label_text: str = ""  # full source line, e.g. "public: // construct operator"
    items: List[DeclItem] = field(default_factory=list)
    blank_pairs: set = field(default_factory=set)  # item-name pairs separated by blank line in source


NUMBERED_DOXY_ITEM_RE = re.compile(r"/\*\*\s*\d+\.|^\s*\*\s+\d+\.", re.MULTILINE)


def _normalize_access_label(raw_label: str) -> str:
    """Ensure access label includes trailing colon (public: / public slots: / signals:)."""
    label = raw_label.strip().rstrip(":")
    if label == "signals":
        return "signals:"
    if label.endswith(" slots"):
        return f"{label}:"
    return f"{label}:"


_CPP_KEYWORDS = frozenset(
    {
        "if",
        "for",
        "while",
        "switch",
        "return",
        "explicit",
        "virtual",
        "static",
        "constexpr",
        "inline",
        "friend",
        "const",
        "volatile",
        "noexcept",
        "override",
        "final",
        "mutable",
        "thread_local",
        "extern",
        "typedef",
        "typename",
        "class",
        "struct",
        "enum",
        "union",
        "template",
        "decltype",
        "consteval",
        "concept",
        "requires",
        "operator",
        "using",
    }
)


def _declaration_sig_for_name(decl: str) -> str:
    """Flattened declaration signature without Doxygen or inline function body."""
    sig = _strip_comment_lines(decl)
    brace = sig.find("{")
    if brace >= 0:
        before = sig[:brace].rstrip()
        # In-class member initializer: int count_{-1}; — keep full line for member parsing
        if re.search(r"\w_\s*$", before) and re.search(r"\{[^}]*\}\s*;", sig[brace:]):
            return sig
        sig = before.rstrip()
    return sig


def _strip_comment_lines(decl: str) -> str:
    """Code lines only (skip Doxygen / //); flattened to one line."""
    parts: List[str] = []
    for line in decl.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("/**") or stripped.startswith("*") or stripped.startswith("//"):
            continue
        code = re.sub(r"\s*//.*$", "", stripped)
        if code:
            parts.append(code)
    return " ".join(parts)


def _first_top_level_paren(sig: str) -> int:
    """Index of first '(' not inside angle brackets."""
    angle = 0
    for i, c in enumerate(sig):
        if c == "<":
            angle += 1
        elif c == ">":
            angle = max(0, angle - 1)
        elif c == "(" and angle == 0:
            return i
    return -1


def _is_doxygen_group_block(text: str) -> bool:
    """True when text is a Doxygen ///@{ ... ///@} block (optional leading @name)."""
    has_open = False
    has_close = False
    for line in text.splitlines():
        stripped = line.strip()
        if DOXYGEN_GROUP_OPEN_RE.match(line):
            has_open = True
        if DOXYGEN_GROUP_CLOSE_RE.match(line):
            has_close = True
    return has_open and has_close


def _strip_orphan_group_markers(text: str) -> str:
    """Drop stray ///@{ or ///@} lines left between standalone declarations."""
    lines = text.splitlines(keepends=True)
    kept: List[str] = []
    for line in lines:
        if DOXYGEN_GROUP_OPEN_RE.match(line) or DOXYGEN_GROUP_CLOSE_RE.match(line):
            continue
        kept.append(line)
    return "".join(kept)


def _has_numbered_doxygen_item(text: str) -> bool:
    """True when a declaration carries a numbered Doxygen tag (e.g. /** 1. bool */)."""
    return bool(NUMBERED_DOXY_ITEM_RE.search(text))


def _section_has_numbered_doxygen_sequence(section: AccessSection) -> bool:
    """Numbered sequences keep source order (e.g. /** 1. bool */ … /** 11. … */)."""
    count = sum(1 for it in section.items if _has_numbered_doxygen_item(it.text))
    return count >= 2


def _collect_doxygen_sort_warnings(
    sections: List[AccessSection],
    class_name: str,
) -> List[str]:
    """
    Hints when Doxygen markup prevents full section sorting.
    Caller should print these so the user can remove or refactor Doxygen blocks.
    """
    prefix = f"{class_name}: " if class_name else ""

    warnings: List[str] = []
    for sec in sections:
        label = sec.label

        if _section_has_numbered_doxygen_sequence(sec):
            warnings.append(
                f"{prefix}{label} 含编号 Doxygen（如 /** 1. … */），段内保持源码顺序、未做字母序；"
                "若需排序请删除编号或改为普通 @brief。"
            )
            continue

        if any(it.kind == "nested" for it in sec.items):
            nested = [it.name for it in sec.items if it.kind == "nested" and it.name]
            hint = "、".join(nested[:3])
            if len(nested) > 3:
                hint += "…"
            warnings.append(
                f"{prefix}{label} 含类内 enum/using/struct（{hint}），段内保持源码顺序；"
                "若需排序请将嵌套类型移到类外或去掉块内 Doxygen 编号。"
            )
            continue

        for grp in (it for it in sec.items if it.kind == "group"):
            warnings.append(
                f"{prefix}{label} 含 Doxygen 组 ///@{{ ///@}}（首项 {grp.name or 'group'}）；"
                "规范不使用分组，请删除 @name 与 ///@{ ///@}，改为各函数独立 @brief 后重跑。"
            )

    return warnings


def _is_member_only_section(section: AccessSection, class_name: str) -> bool:
    """True when every item in the section is a member variable."""
    if not section.items:
        return False
    return all(_extract_decl_name(it.text, class_name)[0] == "member" for it in section.items)


def _extract_decl_name(decl: str, class_name: str) -> Tuple[str, str]:
    """Return (kind, name). kind: special|method|member|group|nested|macro|other"""
    stripped = decl.strip()
    if not stripped or stripped.startswith("#") or stripped.startswith("//"):
        return "other", ""
    if _is_class_body_macro(stripped):
        return "macro", stripped
    if _is_doxygen_group_block(decl):
        return "group", _first_method_name_in_block(decl, class_name)

    sig = _declaration_sig_for_name(decl)
    code = _strip_comment_lines(decl)

    if re.search(r"\busing\s+(\w+)\s*=", code):
        m = re.search(r"\busing\s+(\w+)\s*=", code)
        return "nested", m.group(1) if m else "using"
    if re.search(r"\benum\s+(?:class\s+)?(\w+)", code) and "{" in decl:
        m = re.search(r"\benum\s+(?:class\s+)?(\w+)", code)
        return "nested", m.group(1) if m else "enum"
    if re.search(r"\bstruct\s+(\w+)", code) and "{" in decl:
        m = re.search(r"\bstruct\s+(\w+)", code)
        return "nested", m.group(1) if m else "struct"

    if "= delete" in sig or "= default" in sig:
        if f"{class_name}(" in sig or "operator=" in sig:
            return "special", _parse_special_name(sig, class_name)
        return "method", _parse_method_name(decl, class_name)

    if re.search(rf"\b{re.escape(class_name)}\s*\(", sig):
        if "~" in sig.split("(")[0]:
            return "special", f"~{class_name}"
        return "special", class_name

    if re.search(rf"\b~{re.escape(class_name)}\s*\(", sig):
        return "special", f"~{class_name}"

    if "(" in sig:
        member_name = _parse_member_name(decl)
        if member_name.endswith("_") and re.search(rf"\b{re.escape(member_name)}\s*;", sig):
            if not re.search(rf"\b{re.escape(member_name)}\s*\(", sig):
                return "member", member_name
        return "method", _parse_method_name(decl, class_name)

    if ";" in sig and not sig.rstrip().endswith(");"):
        return "member", _parse_member_name(decl)

    return "other", stripped[:40]


def _parse_special_name(decl: str, class_name: str) -> str:
    if f"~{class_name}" in decl:
        return f"~{class_name}"
    if "operator=" in decl:
        return "operator="
    if re.search(rf"\b{re.escape(class_name)}\s*\(", decl):
        return class_name
    m = re.search(r"operator\s*\S+\s*\(", decl)
    return m.group(0).split("(")[0].strip() if m else decl[:30]


def _parse_method_name(decl: str, class_name: str) -> str:
    """Last identifier before the parameter list; Doxygen stripped (avoids regex backtracking)."""
    sig = _declaration_sig_for_name(decl)
    if not sig:
        sig = " ".join(decl.split())[:200]

    if "operator=" in sig:
        return "operator="
    op = re.search(r"\boperator\s*[^\s(]+\s*\(", sig)
    if op:
        return op.group(0).split("(")[0].strip()

    paren_idx = _first_top_level_paren(sig)
    if paren_idx < 0:
        return sig[:40]

    before = sig[:paren_idx].rstrip()
    m = re.search(r"(\w+)\s*$", before)
    if m:
        name = m.group(1)
        if name not in _CPP_KEYWORDS:
            return name
    return sig[:40]


def _parse_member_name(decl: str) -> str:
    sig = _declaration_sig_for_name(decl)
    if not sig:
        sig = " ".join(decl.split())
    m = re.search(r"(\w+_)\s*\{[^}]*\}\s*;", sig)
    if m:
        return m.group(1)
    m = re.search(r"(\w+_)\s*(?:\/\/\/<|;)", sig)
    if m:
        return m.group(1)
    m = re.search(r"(\w+_)\s*;", sig)
    if m:
        return m.group(1)
    m = re.search(r"(\w+)\s*(?:\/\/\/<|;)", sig)
    if m:
        return m.group(1)
    m = re.search(r"(\w+)\s*;", sig)
    return m.group(1) if m else sig[:30]


def _first_method_name_in_block(text: str, class_name: str) -> str:
    """First method name inside a declaration block (for Doxygen group sort keys)."""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("/**") or stripped.startswith("*"):
            continue
        if stripped.startswith("//"):
            continue
        if "(" not in stripped:
            continue
        kind, name = _extract_decl_name(stripped, class_name)
        if kind in ("method", "special") and name:
            return name
    return "group"


def _collect_blank_pairs(items: List[DeclItem]) -> set:
    """Pairs of declaration names that had a blank line between them in source."""
    pairs: set = set()
    for idx, it in enumerate(items):
        if not it.trailing_gap or idx + 1 >= len(items):
            continue
        a = items[idx].name
        b = items[idx + 1].name
        if a and b:
            pairs.add(frozenset({a, b}))
    return pairs


def _split_class_items(
    body: str,
    class_name: str = "",
    *,
    kevin_system_code_mode: str = "merge_strip",
) -> Tuple[str, List[AccessSection]]:
    """Split class body into preamble (macros) and access sections."""
    m = ACCESS_RE.search(body)
    if not m:
        return body, []

    preamble = body[: m.start()]
    sections: List[AccessSection] = []
    matches = list(ACCESS_RE.finditer(body))

    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(body)
        chunk = body[start:end]
        label = _normalize_access_label(match.group(2).strip())
        indent = match.group(1)
        label_text = match.group(0).rstrip()
        items = _split_declarations(chunk, class_name, kevin_system_code_mode=kevin_system_code_mode)
        blank_pairs = _collect_blank_pairs(items)
        sections.append(
            AccessSection(
                label=label,
                indent=indent,
                label_text=label_text,
                items=items,
                blank_pairs=blank_pairs,
            )
        )

    return preamble, sections


def _skip_inter_item_gap(chunk: str, i: int, n: int) -> int:
    """Skip blank lines between declarations; preserve indentation of the next item."""
    while i < n:
        line_end = i
        while line_end < n and chunk[line_end] not in "\r\n":
            line_end += 1
        if chunk[i:line_end].strip():
            break
        i = line_end
        while i < n and chunk[i] in "\r\n":
            i += 1
    return i


def _split_by_doxygen_groups(chunk: str) -> List[str]:
    """
    Split a section chunk into Doxygen @{...} groups and runs of other declarations.
    Each ///@{ ... ///@} block (with optional preceding /** @name */) stays one segment.
    """
    lines = chunk.splitlines(keepends=True)
    segments: List[str] = []
    buf: List[str] = []
    in_group = False
    pending_name: List[str] = []

    def flush_buf() -> None:
        nonlocal buf
        if buf:
            segments.append("".join(buf))
            buf = []

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not in_group and stripped.startswith("/**"):
            pending_name = [line]
            i += 1
            while i < len(lines):
                if DOXYGEN_GROUP_OPEN_RE.match(lines[i]):
                    flush_buf()
                    in_group = True
                    buf = pending_name + [lines[i]]
                    pending_name = []
                    i += 1
                    break
                sl = lines[i].strip()
                if sl and not sl.startswith("*") and not sl.startswith("/**"):
                    buf.extend(pending_name)
                    pending_name = []
                    break
                pending_name.append(lines[i])
                i += 1
            continue

        if DOXYGEN_GROUP_OPEN_RE.match(line):
            flush_buf()
            in_group = True
            buf = [line]
            i += 1
            continue

        if in_group and DOXYGEN_GROUP_CLOSE_RE.match(line):
            buf.append(line)
            flush_buf()
            in_group = False
            i += 1
            continue

        if pending_name:
            buf.extend(pending_name)
            pending_name = []
        buf.append(line)
        i += 1

    if pending_name:
        buf.extend(pending_name)
    flush_buf()
    return segments


def _walk_back_line_comments(chunk: str, item_start: int, prev_end: int) -> int:
    """Include consecutive // comment lines directly above a declaration."""
    block_start = item_start
    pos = item_start
    while pos > prev_end:
        line_end = pos - 1
        while line_end > prev_end and chunk[line_end] in "\r\n":
            line_end -= 1
        if line_end <= prev_end:
            break
        line_start = chunk.rfind("\n", prev_end, line_end) + 1
        stripped = chunk[line_start : line_end + 1].strip()
        if stripped.startswith("//") and not stripped.startswith("///"):
            block_start = line_start
            pos = line_start
            continue
        break
    return block_start


def _split_declaration_run(chunk: str, class_name: str) -> List[DeclItem]:
    """Split section body into declarations; each item keeps leading indent and attached Doxygen."""
    chunk = _strip_orphan_group_markers(chunk)
    if not chunk.strip():
        return []

    items: List[DeclItem] = []
    i = 0
    n = len(chunk)
    while i < n:
        i = _skip_inter_item_gap(chunk, i, n)
        if i >= n:
            break

        item_start = i
        item_start = _walk_back_line_comments(chunk, item_start, 0)

        brace = 0
        paren = 0
        had_body = False
        in_block_comment = False
        in_line_comment = False
        in_string = False
        string_quote = ""
        while i < n:
            c = chunk[i]

            if in_line_comment:
                if c in "\r\n":
                    in_line_comment = False
                i += 1
                continue

            if in_block_comment:
                if i + 1 < n and chunk[i : i + 2] == "*/":
                    in_block_comment = False
                    i += 2
                    continue
                i += 1
                continue

            if in_string:
                if c == "\\" and i + 1 < n:
                    i += 2
                    continue
                if c == string_quote:
                    in_string = False
                    string_quote = ""
                i += 1
                continue

            if i + 1 < n and chunk[i : i + 2] == "//":
                in_line_comment = True
                i += 2
                continue
            if i + 1 < n and chunk[i : i + 2] == "/*":
                in_block_comment = True
                i += 2
                continue
            if c in "\"'":
                in_string = True
                string_quote = c
                i += 1
                continue

            if c == "(":
                paren += 1
            elif c == ")":
                paren = max(0, paren - 1)
            elif c == "{" and paren == 0:
                brace += 1
                if brace == 1:
                    had_body = True
            elif c == "}" and paren == 0:
                brace -= 1
                if brace == 0 and had_body:
                    # `member_{};` aggregate init also uses {}; only stop at `}` for real bodies
                    j = i + 1
                    while j < n and chunk[j] in " \t\r\n":
                        j += 1
                    if j < n and chunk[j] == ";":
                        had_body = False
                    else:
                        i += 1
                        break
            elif c == ";" and brace == 0 and paren == 0:
                i += 1
                # Keep trailing same-line comment (e.g. // @nodoc)
                while i < n and chunk[i] not in "\r\n":
                    i += 1
                break
            i += 1

        raw = chunk[item_start:i]
        if not raw.strip():
            continue

        next_start = _skip_inter_item_gap(chunk, i, n)
        gap_region = chunk[i:next_start]
        trailing_gap = bool(re.search(r"\r?\n\s*\r?\n", gap_region))

        name = ""
        kind = "other"
        if class_name:
            kind, name = _extract_decl_name(raw, class_name)
        items.append(DeclItem(text=raw, name=name, kind=kind, trailing_gap=trailing_gap))
        i = next_start
    return items


def _starts_with_blank_line(text: str) -> bool:
    return bool(re.match(r"^[ \t]*\r?\n", text))


def _strip_one_leading_blank_line(text: str) -> str:
    return re.sub(r"^[ \t]*\r?\n", "", text, count=1)


def _sort_system_code_items(items: List[DeclItem], class_name: str) -> List[DeclItem]:
    for it in items:
        if not it.name:
            it.kind, it.name = _extract_decl_name(it.text, class_name)
    specials = [d for d in items if d.kind == "special"]
    rest = [d for d in items if d.kind != "special"]
    specials.sort(key=lambda d: _special_header_key(class_name, d.name, d.text))
    rest.sort(key=_sortable_decl_key)
    return specials + rest


def _is_kevin_system_code_section(sec: AccessSection) -> bool:
    return "KEVIN_SYSTEM_CODE" in (sec.label_text or "")


def _is_functions_section(sec: AccessSection) -> bool:
    return bool(FUNCTIONS_SECTION_LABEL_RE.search(sec.label_text or ""))


def _strip_kevin_system_code_marker_lines(text: str) -> str:
    out: List[str] = []
    for line in text.splitlines(keepends=True):
        if KEVIN_SYSTEM_CODE_START_RE.match(line) or KEVIN_SYSTEM_CODE_END_RE.match(line):
            continue
        out.append(line)
    return "".join(out)


def _decl_has_kevin_system_code_note(text: str) -> bool:
    return bool(KEVIN_SYSTEM_CODE_NOTE_RE.search(text))


def _is_static_method_decl(text: str, class_name: str) -> bool:
    kind, _ = _extract_decl_name(text, class_name)
    if kind != "method":
        return False
    sig = _strip_comment_lines(text)
    return bool(re.search(r"\bstatic\b", sig))


def _decl_items_from_chunk(chunk: str, class_name: str) -> List[DeclItem]:
    cleaned = _strip_kevin_system_code_marker_lines(chunk)
    if not cleaned.strip():
        return []
    return _split_declaration_run(cleaned, class_name)


def _expand_section_decl_pool(sec: AccessSection, class_name: str) -> Tuple[List[DeclItem], List[DeclItem]]:
    """Return (fixed non-sortable items, declaration pool for system-code merge)."""
    fixed: List[DeclItem] = []
    pool: List[DeclItem] = []
    for it in sec.items:
        if it.kind == "avoidance":
            fixed.append(it)
        elif it.kind == "system_code":
            pool.extend(_decl_items_from_chunk(it.text, class_name))
        else:
            pool.extend(_decl_items_from_chunk(it.text, class_name))
    return fixed, pool


def _normalize_kevin_system_code_sections(sections: List[AccessSection], class_name: str) -> None:
    """Merge ``public: // KEVIN_SYSTEM_CODE`` + 紧随其后的 ``// functions`` 段内相关声明；清除 START/END 标记。"""
    i = 0
    while i < len(sections):
        sec = sections[i]
        if not _is_kevin_system_code_section(sec):
            i += 1
            continue

        fixed, pool = _expand_section_decl_pool(sec, class_name)

        if i + 1 < len(sections) and _is_functions_section(sections[i + 1]):
            fn_sec = sections[i + 1]
            keep: List[DeclItem] = []
            for it in fn_sec.items:
                if it.kind == "avoidance":
                    keep.append(it)
                    continue
                if not it.name:
                    it.kind, it.name = _extract_decl_name(it.text, class_name)
                if _decl_has_kevin_system_code_note(it.text) or _is_static_method_decl(
                    it.text, class_name
                ):
                    pool.append(it)
                else:
                    keep.append(it)
            fn_sec.items = keep
            if not keep:
                sections.pop(i + 1)

        if pool:
            sorted_pool = _sort_system_code_items(pool, class_name)
            sec.items = fixed + [
                DeclItem(
                    text=_join_decl_items_text(sorted_pool),
                    name="kevin_system_code",
                    kind="system_code",
                )
            ]
        else:
            sec.items = fixed
        i += 1


def _join_decl_items_text(items: List[DeclItem]) -> str:
    out = ""
    for idx, it in enumerate(items):
        trailing = it.trailing_gap if idx < len(items) - 1 else False
        out += _emit_item_text(it.text, trailing_blank=trailing)
    return out


def _split_doxygen_and_decls(chunk: str, class_name: str) -> List[DeclItem]:
    items: List[DeclItem] = []
    for sub in _split_by_doxygen_groups(chunk):
        if _is_doxygen_group_block(sub):
            kind, name = _extract_decl_name(sub, class_name)
            items.append(DeclItem(text=sub, name=name, kind=kind))
            continue
        items.extend(_split_declaration_run(sub, class_name))
    return items


def _split_non_avoidance_chunk(
    chunk: str,
    class_name: str,
    *,
    kevin_system_code_mode: str = "merge_strip",
) -> List[DeclItem]:
    """Doxygen groups, KEVIN_SYSTEM_CODE segment, and plain declarations."""
    if not chunk.strip():
        return []

    items: List[DeclItem] = []
    lines = chunk.splitlines(keepends=True)
    buf: List[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if KEVIN_SYSTEM_CODE_START_RE.match(line):
            if kevin_system_code_mode == "off":
                buf.append(line)
                i += 1
                continue
            if buf:
                items.extend(_split_doxygen_and_decls("".join(buf), class_name))
                buf = []
            inner_lines: List[str] = []
            i += 1
            end_line = ""
            while i < len(lines):
                if KEVIN_SYSTEM_CODE_END_RE.match(lines[i]):
                    if kevin_system_code_mode == "keep_markers":
                        end_line = lines[i]
                    i += 1
                    break
                inner_lines.append(lines[i])
                i += 1
            inner_chunk = "".join(inner_lines)
            inner_items = _split_declaration_run(inner_chunk, class_name)
            if inner_items:
                inner_items = _sort_system_code_items(inner_items, class_name)
                inner_text = _join_decl_items_text(inner_items)
            else:
                inner_text = inner_chunk
            if inner_text and not inner_text.endswith("\n"):
                inner_text += "\n"
            if kevin_system_code_mode == "keep_markers":
                block = line + inner_text + end_line
                items.append(DeclItem(text=block, name="kevin_system_code", kind="system_code"))
            else:
                items.append(DeclItem(text=inner_text, name="kevin_system_code", kind="system_code"))
            continue
        buf.append(line)
        i += 1
    if buf:
        items.extend(_split_doxygen_and_decls("".join(buf), class_name))
    return items


def _split_declarations(
    chunk: str,
    class_name: str,
    *,
    kevin_system_code_mode: str = "merge_strip",
) -> List[DeclItem]:
    """Split section body; P0 locked regions, then Doxygen groups, then declarations."""
    items: List[DeclItem] = []
    parts = split_by_avoidance_rules(chunk)
    for idx, (segment, is_avoidance) in enumerate(parts):
        if is_avoidance:
            if segment.strip():
                trailing_gap = False
                if idx + 1 < len(parts):
                    nxt = parts[idx + 1][0]
                    trailing_gap = _starts_with_blank_line(nxt)
                items.append(
                    DeclItem(text=segment, name="avoidance", kind="avoidance", trailing_gap=trailing_gap)
                )
            continue

        seg = segment
        if items and items[-1].kind == "avoidance" and _starts_with_blank_line(seg):
            items[-1].trailing_gap = True
            seg = _strip_one_leading_blank_line(seg)
        items.extend(
            _split_non_avoidance_chunk(seg, class_name, kevin_system_code_mode=kevin_system_code_mode)
        )
    return items


def _alphabetical_decl_key(item: DeclItem) -> str:
    """Case-insensitive function name; stable sort keeps overload order within the same name."""
    return sort_case_insensitive(item.name or item.text)


def _sortable_decl_key(item: DeclItem) -> Tuple[int, str]:
    """Case-insensitive sort by declaration name (function name); no get_/is_ tiers."""
    if item.kind in ("group", "method", "other", "macro"):
        return (0, _alphabetical_decl_key(item))
    return (99, _alphabetical_decl_key(item))


def _section_kind(label: str) -> str:
    label = label.lower().rstrip(":")
    if label == "signals":
        return "signals"
    if "slots" in label:
        return "slots"
    if label.startswith("public"):
        return "public"
    if label.startswith("private"):
        return "private"
    if label.startswith("protected"):
        return "protected"
    return "other"


def _sort_section_items(
    section: AccessSection,
    class_name: str,
    section_type: str,
    sort_members: bool = False,
) -> None:
    for it in section.items:
        if not it.name:
            it.kind, it.name = _extract_decl_name(it.text, class_name)

    if _is_member_only_section(section, class_name):
        return
    if _section_has_numbered_doxygen_sequence(section):
        return
    if any(it.kind == "nested" for it in section.items):
        return

    if section_type == "signals" or section_type == "slots":
        section.items.sort(key=lambda d: sort_case_insensitive(d.name or d.text))
        return

    if section_type in ("public", "private", "protected"):
        items = section.items
        fixed_indices = [
            i
            for i, it in enumerate(items)
            if it.kind in ("member", "nested", "avoidance", "system_code")
        ]
        sortable = [it for it in items if it.kind not in ("member", "nested", "avoidance", "system_code")]

        specials = [d for d in sortable if d.kind == "special"]
        rest = [d for d in sortable if d.kind != "special"]
        specials.sort(key=lambda d: _special_header_key(class_name, d.name, d.text))
        rest.sort(key=_sortable_decl_key)
        sorted_sortable = specials + rest

        fixed_items = [items[i] for i in fixed_indices]
        if sort_members:
            members_only = [it for it in fixed_items if it.kind == "member"]
            members_only.sort(key=lambda d: sort_case_insensitive(d.name or d.text))
            mi = 0
            rebuilt_fixed: List[DeclItem] = []
            for it in fixed_items:
                if it.kind == "member":
                    rebuilt_fixed.append(members_only[mi])
                    mi += 1
                else:
                    rebuilt_fixed.append(it)
            fixed_items = rebuilt_fixed

        result = list(items)
        si = 0
        for i, it in enumerate(items):
            if it.kind in ("member", "nested", "avoidance", "system_code"):
                continue
            result[i] = sorted_sortable[si]
            si += 1
        for idx, fi in enumerate(fixed_indices):
            result[fi] = fixed_items[idx]
        section.items = result
        return

    section.items.sort(key=lambda d: sort_case_insensitive(d.name or d.text))


def _decl_starts_with_doxygen(text: str) -> bool:
    """True when the declaration block begins with a Doxygen comment (/**)."""
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped.startswith("/**")
    return False


def _collapse_consecutive_blank_lines(text: str) -> str:
    """Collapse 2+ consecutive blank lines to a single blank line (.h hygiene)."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"(\r?\n)(?:[ \t]*\r?\n)+", r"\1\n", text)
    return text


def _emit_item_text(text: str, trailing_blank: bool = False) -> str:
    """Preserve declaration text; ensure single trailing newline; keep indent and Doxygen."""
    if not text:
        return ""
    out = text.rstrip("\r\n \t") + "\n"
    if trailing_blank:
        out += "\n"
    return out


def _special_header_key(class_name: str, name: str, text: str = "") -> Tuple[int, str]:
    return sort_special_member_key(class_name, name, text)


def _is_private_member_only_section(section: AccessSection, class_name: str) -> bool:
    """True when a private: section contains only member variables (Qt archive tail)."""
    if _section_kind(section.label) != "private":
        return False
    if not section.items:
        return False
    return all(_extract_decl_name(it.text, class_name)[0] == "member" for it in section.items)


def _simple_rebuild_sections(
    preamble: str,
    sections: List[AccessSection],
    class_name: str,
    sort_members: bool = False,
) -> str:
    """Sort items within each section; keep section order stable except Qt archive before last private members."""
    if not sections:
        return preamble

    # Classify sections
    method_sections: List[AccessSection] = []
    signal_sections: List[AccessSection] = []
    slot_sections: List[AccessSection] = []
    member_sections: List[AccessSection] = []

    for sec in sections:
        sk = _section_kind(sec.label)
        _sort_section_items(sec, class_name, sk, sort_members)
        if sk == "signals":
            signal_sections.append(sec)
        elif sk == "slots":
            slot_sections.append(sec)
        elif _is_private_member_only_section(sec, class_name):
            member_sections.append(sec)
        else:
            method_sections.append(sec)

    # Order: non-signal/slot sections in original order, then signals, slots, private members only
    ordered: List[AccessSection] = []
    for sec in sections:
        sk = _section_kind(sec.label)
        if sk in ("signals", "slots") or _is_private_member_only_section(sec, class_name):
            continue
        ordered.append(sec)

    ordered.extend(signal_sections)
    ordered.extend(slot_sections)
    ordered.extend(member_sections)

    out = preamble
    for sec in ordered:
        access_line = sec.label_text or f"{sec.indent}{sec.label}"
        out += f"{access_line}\n"
        for idx, it in enumerate(sec.items):
            trailing_blank = it.trailing_gap
            if idx < len(sec.items) - 1:
                nxt = sec.items[idx + 1]
                if _section_has_numbered_doxygen_sequence(sec) or any(
                    x.kind == "nested" for x in sec.items
                ):
                    pass
                elif it.kind == "member" and _decl_starts_with_doxygen(it.text):
                    trailing_blank = True
                elif _decl_starts_with_doxygen(nxt.text):
                    trailing_blank = True
            out += _emit_item_text(it.text, trailing_blank=trailing_blank)
    return _collapse_consecutive_blank_lines(out)


def _reorder_class_in_header(
    class_match: re.Match,
    text: str,
    class_name: str,
    sort_members: bool = False,
    kevin_system_code_mode: str = "merge_strip",
) -> Tuple[str, bool, List[str]]:
    start = class_match.end() - 1  # position of {
    brace = 0
    i = start
    while i < len(text):
        if text[i] == "{":
            brace += 1
        elif text[i] == "}":
            brace -= 1
            if brace == 0:
                end = i
                break
        i += 1
    else:
        return text, False, []

    body = text[start + 1 : end]
    has_qobject = "Q_OBJECT" in text[class_match.start() : end]
    preamble, sections = _split_class_items(body, class_name, kevin_system_code_mode=kevin_system_code_mode)
    if not sections:
        # still sort single blob if only methods
        return text, False, []

    mode = normalize_kevin_system_code_mode(kevin_system_code_mode)
    if mode == "merge_strip":
        _normalize_kevin_system_code_sections(sections, class_name)

    for sec in sections:
        for it in sec.items:
            if it.kind == "avoidance":
                continue
            it.kind, it.name = _extract_decl_name(it.text, class_name)

    warnings = _collect_doxygen_sort_warnings(sections, class_name)

    for sec in sections:
        _sort_section_items(sec, class_name, _section_kind(sec.label), sort_members)

    new_body = _simple_rebuild_sections(preamble, sections, class_name, sort_members)
    if new_body == _collapse_consecutive_blank_lines(body):
        return text, False, warnings

    new_text = text[: start + 1] + new_body + text[end:]
    return new_text, True, warnings


def reorder_header_file(
    path: Path,
    dry_run: bool = False,
    sort_members: bool = False,
    kevin_system_code_mode: str = "merge_strip",
) -> Tuple[bool | None, List[str]]:
    payload = detect_and_read(path)
    if payload is None:
        return None, ["无法识别文件编码，已跳过"]
    text = payload.text
    changed = False
    new_text = text
    warnings: List[str] = []

    for m in list(CLASS_RE.finditer(text)):
        class_name = m.group(1)
        new_text, did, class_warnings = _reorder_class_in_header(
            m, new_text, class_name, sort_members, kevin_system_code_mode=kevin_system_code_mode
        )
        changed = changed or did
        warnings.extend(class_warnings)

    warnings = list(dict.fromkeys(warnings))

    collapsed = _collapse_consecutive_blank_lines(new_text)
    if not text_content_equivalent(collapsed, text):
        new_text = collapsed

    if not would_change_on_disk(path, payload, new_text):
        return False, warnings

    if not dry_run:
        write_text_if_changed(path, payload, new_text)
    return True, warnings


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def normalize_reorder_file_filters(cpp_only: bool, header_only: bool) -> tuple[bool, bool]:
    """``cpp_only`` 与 ``header_only`` 不可同时为真，否则扩展名集合为空（CLI 旧语义）。"""
    if cpp_only and header_only:
        return False, False
    return cpp_only, header_only


def normalize_reorder_include_flags(include_cpp: bool, include_header: bool) -> tuple[bool, bool]:
    """Web 勾选语义：至少保留一种源文件类型；默认二者皆勾选。"""
    if not include_cpp and not include_header:
        return True, True
    return include_cpp, include_header


def include_flags_to_legacy_filters(include_cpp: bool, include_header: bool) -> tuple[bool, bool]:
    """将 ``include_cpp`` / ``include_header`` 转为 ``iter_source_files`` 的 cpp_only/header_only。"""
    include_cpp, include_header = normalize_reorder_include_flags(include_cpp, include_header)
    cpp_only = include_cpp and not include_header
    header_only = include_header and not include_cpp
    return cpp_only, header_only


def legacy_filters_to_include_flags(cpp_only: bool, header_only: bool) -> tuple[bool, bool]:
    """从旧偏好 ``cpp_only`` / ``header_only`` 迁移为 include 勾选。"""
    cpp_only, header_only = normalize_reorder_file_filters(cpp_only, header_only)
    if cpp_only and not header_only:
        return True, False
    if header_only and not cpp_only:
        return False, True
    return True, True


def read_reorder_include_flags(prefs: dict) -> tuple[bool, bool]:
    """读工作空间 ``code_reorder`` 段，兼容旧字段。"""
    if "include_cpp" in prefs or "include_header" in prefs:
        return normalize_reorder_include_flags(
            bool(prefs.get("include_cpp", True)),
            bool(prefs.get("include_header", True)),
        )
    return legacy_filters_to_include_flags(
        bool(prefs.get("cpp_only", False)),
        bool(prefs.get("header_only", False)),
    )


def resolve_reorder_include_for_run(patch: dict | None) -> tuple[bool, bool]:
    """运行请求未带筛选字段时处理全部源文件（.cpp + .h/.hpp），不限制。"""
    if not patch:
        return True, True
    if "include_cpp" in patch or "include_header" in patch:
        return normalize_reorder_include_flags(
            bool(patch.get("include_cpp", True)),
            bool(patch.get("include_header", True)),
        )
    if "cpp_only" in patch or "header_only" in patch:
        return read_reorder_include_flags(
            {
                "cpp_only": bool(patch.get("cpp_only", False)),
                "header_only": bool(patch.get("header_only", False)),
            }
        )
    return True, True


def iter_source_files(
    root: Path,
    cpp_only: bool,
    header_only: bool,
    *,
    repo_root: Path | None = None,
) -> Iterable[Path]:
    cpp_only, header_only = normalize_reorder_file_filters(cpp_only, header_only)
    exts = set()
    if not header_only:
        exts.add(".cpp")
    if not cpp_only:
        exts.update({".h", ".hpp"})

    scan_root = root.expanduser().resolve(strict=False)
    ws = (repo_root or root).expanduser().resolve(strict=False)
    patterns, _, _ = load_ignore_patterns(ws)

    for path in scan_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in exts:
            continue
        try:
            rel = path.relative_to(ws)
        except ValueError:
            rel = path.relative_to(scan_root)
        if any(is_ignored_name(part, patterns) for part in rel.parts[:-1]):
            continue
        yield path


@dataclass
class ReorderMembersRunResult:
    ok: bool
    lines: list[str] = field(default_factory=list)
    cpp_changed: int = 0
    hdr_changed: int = 0
    dry_run: bool = False
    files_scanned: int = 0
    changed_files: list[str] = field(default_factory=list)


def run_reorder_members(
    root: Path,
    *,
    files: list[Path] | None = None,
    dry_run: bool = False,
    cpp_only: bool = False,
    header_only: bool = False,
    sort_members: bool = False,
    verbose: bool = False,
    repo_root: Path | None = None,
    kevin_system_code_mode: str = "merge_strip",
) -> ReorderMembersRunResult:
    """对目录或文件列表执行成员排序，返回结构化日志（供 Web / CLI 共用）。"""
    root = root.expanduser().resolve(strict=False)
    lines: list[str] = []
    if not root.is_dir() and files is None:
        return ReorderMembersRunResult(ok=False, lines=[f"Error: not a directory: {root}"])

    cpp_changed = hdr_changed = 0
    files_scanned = 0
    changed_files: list[str] = []
    source_iter: Iterable[Path]
    if files is not None:
        source_iter = sorted(f for f in files if f.suffix in {".cpp", ".h", ".hpp"})
    else:
        source_iter = iter_source_files(
            root, cpp_only, header_only, repo_root=repo_root or root
        )

    for path in sorted(source_iter):
        files_scanned += 1
        try:
            rel = path.relative_to(root)
        except ValueError:
            rel = path.name
        rel_s = rel.as_posix() if hasattr(rel, "as_posix") else str(rel)
        if verbose:
            lines.append(f"processing {rel_s}...")
        try:
            if path.suffix == ".cpp":
                cpp_result = reorder_cpp_file(path, dry_run)
                if cpp_result is None:
                    if verbose:
                        lines.append(f"skip  {rel_s}: 无法识别文件编码")
                    continue
                if cpp_result:
                    cpp_changed += 1
                    changed_files.append(rel_s)
                    if verbose:
                        prefix = "[dry-run] " if dry_run else ""
                        lines.append(f"{prefix}{CHANGED_LOG_MARK} cpp   {rel_s}")
            else:
                changed, hints = reorder_header_file(
                    path, dry_run, sort_members, kevin_system_code_mode=kevin_system_code_mode
                )
                if changed is None:
                    if verbose:
                        lines.append(f"skip  {rel_s}: 无法识别文件编码")
                    continue
                if verbose:
                    for hint in hints:
                        lines.append(f"hint  {rel_s}: {hint}")
                if changed:
                    hdr_changed += 1
                    changed_files.append(rel_s)
                    if verbose:
                        prefix = "[dry-run] " if dry_run else ""
                        lines.append(f"{prefix}{CHANGED_LOG_MARK} header  {rel_s}")
        except UnicodeDecodeError:
            if verbose:
                lines.append(f"skip  {rel_s}: 无法解码文件编码")
            continue

    if verbose and (cpp_changed or hdr_changed or files_scanned):
        mode = "would update" if dry_run else "updated"
        lines.append(
            f"Done: {mode} {cpp_changed} .cpp, {hdr_changed} header(s) ({files_scanned} file(s) scanned)"
        )
    return ReorderMembersRunResult(
        ok=True,
        lines=lines,
        cpp_changed=cpp_changed,
        hdr_changed=hdr_changed,
        dry_run=dry_run,
        files_scanned=files_scanned,
        changed_files=changed_files,
    )


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Reorder C++ class members in .h/.cpp per cxx-code-style skill.",
    )
    parser.add_argument(
        "path",
        type=Path,
        help="Root directory (or single .h/.cpp file) to process",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report files that would change without writing",
    )
    parser.add_argument("--cpp-only", action="store_true")
    parser.add_argument("--header-only", action="store_true")
    parser.add_argument(
        "--sort-members",
        action="store_true",
        help="Alphabetize member variables in .h (default: keep source order and position)",
    )
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    root = args.path.resolve()
    if root.is_file():
        files = [root]
        root = root.parent
    elif not root.is_dir():
        print(f"Error: not a directory or file: {root}", file=sys.stderr)
        return 1
    else:
        files = None

    result = run_reorder_members(
        root,
        files=files,
        dry_run=args.dry_run,
        cpp_only=args.cpp_only,
        header_only=args.header_only,
        sort_members=args.sort_members,
        verbose=args.verbose,
    )
    for line in result.lines:
        stream = sys.stderr if line.startswith("hint  ") else sys.stdout
        print(line, file=stream, flush=True)
    if not args.verbose:
        if result.changed_files:
            mode = "would update" if args.dry_run else "updated"
            print(
                f"Done: {mode} {result.cpp_changed} .cpp, {result.hdr_changed} header(s)",
                flush=True,
            )
            for rel in result.changed_files:
                print(format_changed_file_log_line(rel), flush=True)
        elif result.files_scanned:
            print(f"Done: no changes ({result.files_scanned} file(s) scanned)", flush=True)
    return 0 if result.ok else 1


if __name__ == "__main__":
    sys.exit(main())
