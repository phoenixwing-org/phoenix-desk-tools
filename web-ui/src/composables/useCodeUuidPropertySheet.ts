import { computed, type Ref } from "vue";
import type { UuidApplyStrategy } from "../api";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { useWorksetScopePropertyGroups } from "./useWorksetScopePropertyGroups";
import { pnwPropEnum, pnwPropGroup, pnwPropSheet } from "phoenix-wing";

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

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        ...scopeGroups(),
        pnwPropGroup("replace", "替换", [
          pnwPropEnum("strategy", "替换策略", {
            value: computed(() => strategy.value),
            options: STRATEGY_OPTIONS.map((o) => ({
              value: o.value,
              label: o.label,
              description: o.description,
            })),
            hint: computed(
              () => STRATEGY_OPTIONS.find((o) => o.value === strategy.value)?.description ?? "",
            ),
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
