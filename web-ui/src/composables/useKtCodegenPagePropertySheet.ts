import { computed, type ComputedRef } from "vue";
import {
  pnwRegisterPageProperties,
  pnwUnregisterPageProperties,
  usePnwPagePropertiesHost,
  type PnwPagePropertiesSheet,
} from "phoenix-wing";
import type { KtCodegenPageParam } from "../models/ktCodegenPageParam";
import {
  KT_CODEGEN_PROPERTY_SCHEMA,
  deriveKtCodegenPageView,
} from "../models/ktCodegenPagePropertySchema";

/** 把纯 Page Param/PropertySchema 桥接到 Wing Host；不读取 store 或文件系统。 */
export function useKtCodegenPagePropertySheet(param: ComputedRef<KtCodegenPageParam>) {
  const view = computed(() => deriveKtCodegenPageView(param.value));
  const sheet: PnwPagePropertiesSheet = {
    pageId: "kt_codegen",
    title: "KT Codegen 属性",
    schemaVersion: 2,
    groups: KT_CODEGEN_PROPERTY_SCHEMA.map((group) => ({
      id: group.id,
      label: group.label,
      fields: group.fields.map((field) => ({
        id: field.id,
        label: field.label,
        kind: "info" as const,
        value: computed(() => view.value[field.valueKey]),
        ...(field.mono ? { mono: true } : {}),
      })),
    })),
  };
  const { activeSheet } = usePnwPagePropertiesHost();

  return {
    sheet,
    view,
    register: () => pnwRegisterPageProperties(sheet),
    unregister: () => {
      if (activeSheet.value === sheet) pnwUnregisterPageProperties("kt_codegen");
    },
  };
}
