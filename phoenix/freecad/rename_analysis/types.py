"""改名分析：数据类型。"""

from __future__ import annotations

from dataclasses import dataclass


class RenameAnalysisError(Exception):
    """引用分析 / 写回失败。"""


@dataclass(frozen=True)
class XLinkBasenameHit:
    host_repo_rel_path: str
    xlink_file_attr: str
    proposed_new_attr: str


@dataclass(frozen=True)
class HostRefGroup:
    host_repo_rel_path: str
    host_filename: str
    hits: tuple[XLinkBasenameHit, ...]
    depth: int = 0
    usage_kind: str = "direct"
    via_chain: tuple[str, ...] = ()

    @property
    def hit_count(self) -> int:
        return len(self.hits)
