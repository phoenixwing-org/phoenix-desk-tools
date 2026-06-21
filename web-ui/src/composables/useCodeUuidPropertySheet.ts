import { computed, type Ref } from "vue";
import type { UuidApplyStrategy } from "../api";
import WorksetScopePicker from "../components/WorksetScopePicker.vue";
import { usePagePropertySheet } from "./usePagePropertySheet";
import { propEnum, propGroup, propSheet, propSlot } from "../utils/pagePropertySchema";

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
  usePagePropertySheet(pageId, () =>
    propSheet(
      [
        propGroup("scope", "扫描范围", [
          propSlot("workset_scope", "范围", {
            component: WorksetScopePicker,
            props: { pageId },
          }),
        ]),
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
      { title: "Code UUID 替换", schemaVersion: 1 },
    ),
  );
}
