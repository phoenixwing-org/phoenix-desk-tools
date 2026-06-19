#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
成员排序 · **锁定段**（locked region，P0，优先于一切重排逻辑）。

匹配到的 locked region 字节级冻结，不参与字母序、特殊成员序或 ``--sort-members``。

规则注册表：``AVOIDANCE_RULES``。新增 lock region rule 只需追加 ``AvoidanceRule``，无需改扫描循环。

嵌套
----
``clang-format off/on`` 常包裹 Kevin/CAA2 Wizard、``#pragma region`` 等；栈式闭合，
重叠区间合并为最外层 locked region；合并 ``rule_id`` 优先 ``clang-format``。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Mapping, Tuple

# 嵌套合并时，此外层 rule_id 优先（常见为 clang-format 包裹 Wizard）
OUTER_ENVELOPE_RULE_ID = "clang-format"

# ---------------------------------------------------------------------------
# 锁定规则注册表（lock region rules）— 在此扩展
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AvoidanceRule:
    """成对行标记；命中区间在排序时整段跳过。"""

    id: str
    label: str
    start: re.Pattern[str]
    end: re.Pattern[str]

    def matches_start(self, line: str) -> bool:
        return bool(self.start.match(line))

    def matches_end(self, line: str) -> bool:
        return bool(self.end.match(line))


def _rules() -> Tuple[AvoidanceRule, ...]:
    return (
        AvoidanceRule(
            id="clang-format",
            label="clang-format off/on",
            start=re.compile(r"^\s*//\s*clang-format\s+off\s*(?://.*)?$"),
            end=re.compile(r"^\s*//\s*clang-format\s+on\s*(?://.*)?$"),
        ),
        AvoidanceRule(
            id="kevin-caa-wizard",
            label="Kevin CAA Wizard SECTION",
            start=re.compile(
                r"^\s*//\s*START\s+KEVIN\s+CAA\s+WIZARD\s+SECTION\b",
                re.IGNORECASE,
            ),
            end=re.compile(
                r"^\s*//\s*END\s+KEVIN\s+CAA\s+WIZARD\s+SECTION\b",
                re.IGNORECASE,
            ),
        ),
        AvoidanceRule(
            id="caa2-wizard",
            label="CAA2 Wizard",
            start=re.compile(r"^\s*//\s*CAA2\s+WIZARD\b"),
            end=re.compile(r"^\s*//\s*END\s+CAA2\s+WIZARD\b"),
        ),
        AvoidanceRule(
            id="pragma-region",
            label="#pragma region / endregion",
            start=re.compile(r"^\s*#\s*pragma\s+region\b"),
            end=re.compile(r"^\s*#\s*pragma\s+endregion\b"),
        ),
    )


AVOIDANCE_RULES: Tuple[AvoidanceRule, ...] = _rules()
RULE_BY_ID: Mapping[str, AvoidanceRule] = {r.id: r for r in AVOIDANCE_RULES}


@dataclass(frozen=True)
class AvoidanceSpan:
    """锁定规则命中的一段源码 / locked region（偏移 + 内容）。"""

    start: int
    end: int
    content: str
    rule_id: str


def list_avoidance_rules() -> List[dict]:
    """供文档 / Web 自检展示。"""
    return [{"id": r.id, "label": r.label} for r in AVOIDANCE_RULES]


def rule_ids() -> Tuple[str, ...]:
    return tuple(r.id for r in AVOIDANCE_RULES)


def _merged_rule_id(left: AvoidanceSpan, right: AvoidanceSpan) -> str:
    ids = {left.rule_id, right.rule_id}
    if len(ids) == 1:
        return left.rule_id
    if OUTER_ENVELOPE_RULE_ID in ids:
        return OUTER_ENVELOPE_RULE_ID
    outer = left if left.start <= right.start else right
    inner = right if outer is left else left
    if inner.start >= outer.start and inner.end <= outer.end:
        return outer.rule_id
    return "mixed"


def _merge_spans(text: str, raw: List[AvoidanceSpan]) -> List[AvoidanceSpan]:
    if not raw:
        return []

    ordered = sorted(raw, key=lambda r: (r.start, r.end))
    merged: List[AvoidanceSpan] = [ordered[0]]
    for span in ordered[1:]:
        prev = merged[-1]
        if span.start > prev.end:
            merged.append(span)
            continue
        end = max(prev.end, span.end)
        merged[-1] = AvoidanceSpan(
            start=prev.start,
            end=end,
            content=text[prev.start:end],
            rule_id=_merged_rule_id(prev, span),
        )
    return merged


def _close_pending(
    pending: List[Tuple[str, int]],
    rule_id: str,
    *,
    text: str,
    line_end: int,
    raw: List[AvoidanceSpan],
) -> None:
    for i in range(len(pending) - 1, -1, -1):
        open_id, start = pending[i]
        if open_id == rule_id:
            pending.pop(i)
            raw.append(
                AvoidanceSpan(
                    start=start,
                    end=line_end,
                    content=text[start:line_end],
                    rule_id=rule_id,
                )
            )
            return


def _match_end_rule(line: str) -> AvoidanceRule | None:
    for rule in AVOIDANCE_RULES:
        if rule.matches_end(line):
            return rule
    return None


def _match_start_rule(line: str) -> AvoidanceRule | None:
    for rule in AVOIDANCE_RULES:
        if rule.matches_start(line):
            return rule
    return None


def find_avoidance_spans(text: str) -> List[AvoidanceSpan]:
    """非重叠的最外层 locked region（嵌套规则已合并）。"""
    raw: List[AvoidanceSpan] = []
    offset = 0
    pending: List[Tuple[str, int]] = []

    for line in text.splitlines(keepends=True):
        line_start = offset
        line_end = offset + len(line)

        end_rule = _match_end_rule(line)
        if end_rule is not None:
            _close_pending(
                pending,
                end_rule.id,
                text=text,
                line_end=line_end,
                raw=raw,
            )
        else:
            start_rule = _match_start_rule(line)
            if start_rule is not None:
                pending.append((start_rule.id, line_start))

        offset = line_end

    return _merge_spans(text, raw)


def extract_avoidance_blocks(text: str) -> List[str]:
    """按源码顺序返回 locked region 内容（单测断言用）。"""
    return [s.content for s in find_avoidance_spans(text)]


def split_by_avoidance_rules(chunk: str) -> List[Tuple[str, bool]]:
    """切分 class 段文本：(片段, 是否为 locked region)。"""
    spans = find_avoidance_spans(chunk)
    if not spans:
        return [(chunk, False)]

    out: List[Tuple[str, bool]] = []
    pos = 0
    for span in spans:
        if span.start > pos:
            out.append((chunk[pos : span.start], False))
        out.append((span.content, True))
        pos = span.end
    if pos < len(chunk):
        out.append((chunk[pos:], False))
    return out
