import { computed, type Ref } from "vue";
import type { UuidApplyStrategy } from "../api";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { useWorksetScopePropertyGroups } from "./useWorksetScopePropertyGroups";
import { propEnum, propGroup, propSheet } from "../utils/pagePropertySchema";

const STRATEGY_OPTIONS = [
  {
    value: "map_per_value",
    label: "同值一组",
    description: "同一 UUID 写法共用一个新 UUID（按原格式写回）",
  },
  {
    value: "fresh_per_hit",
    label: "每条独立",
    description: "每条命中生成独立新 UUID",
  },
] as const;

export function useCodeUuidPropertySheet(pageId: string, strategy: Ref<UuidApplyStrategy>) {
  const scopeGroups = useWorksetScopePropertyGroups(pageId);

  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        ...scopeGroups(),
        propGroup("replace", "替换", [
          propEnum("strategy", "替换策略", {
            value: computed(() => strategy.value),
            options: STRATEGY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              description: o.description,
            })),
            hint:
              STRATEGY_OPTIONS.find((o) => o.value === strategy.value)?.description ?? "",
            onChange: (v) => {
              strategy.value = v as UuidApplyStrategy;
            },
          }),
        ]),
      ],
      { title: "Code UUID 替换", schemaVersion: 5 },
    ),
  );
}
