import { computed, type Ref } from "vue";
import type { BomPreview } from "../api";
import { useAppShell } from "./useAppShell";

/** 图纸 FCStd · App::Link 只读 BOM 的文案与跳转（文件详情各 Tab 共用） */
export function useDrawingBomReadonly(preview: Ref<BomPreview | null | undefined>) {
  const shell = useAppShell();

  const bomReadonly = computed(() => preview.value?.bom_readonly ?? isDrawingFcstdFile(preview.value?.rel_path || ""));
  const bomSourceRel = computed(() => {
    const rel = preview.value?.bom_source_rel?.trim();
    return rel || null;
  });
  const canOpenSourceModel = computed(() => bomReadonly.value && Boolean(bomSourceRel.value));

  const editSubTabLabel = computed(() => (bomReadonly.value ? "查看属性" : "编辑属性"));
  const attrsPanelTitle = computed(() => (bomReadonly.value ? "图纸文件" : "编辑属性"));

  const readonlyTitle = computed(() => "图纸文件 · BOM 只读");

  const readonlyDescription = computed(() => {
    if (bomSourceRel.value) {
      return "独立图纸不编辑 BOM 属性，请打开源模型。这里只修改图纸文件名。";
    }
    return `独立图纸不编辑 BOM 属性。${preview.value?.bom_readonly_reason || "未找到唯一源模型，请检查外部引用。"}`;
  });

  function openSourceModel() {
    const src = bomSourceRel.value;
    if (!src) return;
    shell.openFileDetailForRel(src, { subTab: "edit" });
  }

  return {
    bomReadonly,
    bomSourceRel,
    canOpenSourceModel,
    editSubTabLabel,
    attrsPanelTitle,
    readonlyTitle,
    readonlyDescription,
    openSourceModel,
  };
}

/** 零件详情 · 关联文件是否为图纸 FCStd（BOM 只读，应跳转文件详情查看属性） */
export function isDrawingFcstdFile(filename: string, fileRole?: string): boolean {
  if (fileRole === "drawing") return true;
  return /\.drawing\.fcstd$/i.test(filename.trim());
}
