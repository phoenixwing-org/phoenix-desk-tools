import { computed } from "vue";
import { usePnwPagePropertySheet } from "phoenix-wing";
import { useWorksetScopePropertyGroups } from "./useWorksetScopePropertyGroups";
import type { RenameLevel } from "../api";
import {
  CODE_RENAME_LEVEL_OPTIONS,
  useCodeRenamePageStore,
} from "../stores/codeRenamePage";
import { pnwPropBool, pnwPropEnum, pnwPropGroup, pnwPropSheet, pnwPropString } from "phoenix-wing";

export function useCodeRenamePropertySheet(
  pageId: string,
  onPersistServer?: () => void,
  onValidationError?: (message: string) => void,
) {
  const pageStore = useCodeRenamePageStore();
  const scopeGroups = useWorksetScopePropertyGroups(pageId);

  function toggleLevel(id: RenameLevel, checked: boolean) {
    const next = new Set(pageStore.levels);
    if (checked) next.add(id);
    else next.delete(id);
    if (!next.size) {
      onValidationError?.("至少勾选一种改名级别");
      return;
    }
    pageStore.levels = [...next];
    pageStore.persist();
    onPersistServer?.();
  }

  usePnwPagePropertySheet(pageId, () =>
    pnwPropSheet(
      [
        pnwPropGroup("rename", "改名", [
          pnwPropString("old", "旧名", {
            value: computed(() => pageStore.old),
            mono: true,
            placeholder: "精确匹配",
            onChange: (v) => {
              pageStore.setOld(v);
              onPersistServer?.();
            },
          }),
          pnwPropString("new", "新名", {
            value: computed(() => pageStore.new),
            mono: true,
            onChange: (v) => {
              pageStore.setNew(v);
              onPersistServer?.();
            },
          }),
        ]),
        ...scopeGroups(),
        pnwPropGroup("rules", "规则", [
          ...CODE_RENAME_LEVEL_OPTIONS.map((opt) =>
            pnwPropBool(`level_${opt.id}`, opt.label, {
              value: computed(() => pageStore.levelSet.has(opt.id)),
              onChange: (v) => toggleLevel(opt.id, v),
            }),
          ),
          pnwPropEnum("target_encoding", "写回编码", {
            value: computed(() => pageStore.targetEncoding),
            options: [
              { value: "utf-8", label: "UTF-8" },
              { value: "gbk", label: "GBK" },
            ],
            onChange: (v) => {
              pageStore.setTargetEncoding(v as "utf-8" | "gbk");
              onPersistServer?.();
            },
          }),
          pnwPropBool("rescan_index", "完成后重扫 Code 索引", {
            value: computed(() => pageStore.rescanIndex),
            onChange: (v) => {
              pageStore.setRescanIndex(v);
              onPersistServer?.();
            },
          }),
          pnwPropBool("include_ignored", "包含忽略目录", {
            value: computed(() => pageStore.includeIgnored),
            labelTone: "emphasis",
            hint: "包含 code.ignore 忽略目录内的条目，慎用",
            onChange: (v) => {
              pageStore.setIncludeIgnored(v);
              onPersistServer?.();
            },
          }),
        ]),
      ],
      { title: "Code 批量改名", schemaVersion: 5 },
    ),
  );
}
