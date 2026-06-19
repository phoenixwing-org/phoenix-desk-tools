"""向后兼容：请改用 phoenix.code.reorder_avoidance。"""

from phoenix.code.reorder_avoidance import (  # noqa: F401
    AVOIDANCE_RULES,
    AvoidanceRule,
    AvoidanceSpan,
    extract_avoidance_blocks,
    find_avoidance_spans,
    list_avoidance_rules,
    split_by_avoidance_rules,
)

# 旧名别名
ProtectedRegionRule = AvoidanceRule
ProtectedRegion = AvoidanceSpan
PROTECTED_REGION_RULES = AVOIDANCE_RULES
find_protected_regions = find_avoidance_spans
extract_protected_blocks = extract_avoidance_blocks
split_by_protected_regions = split_by_avoidance_rules
list_protected_region_rules = list_avoidance_rules
