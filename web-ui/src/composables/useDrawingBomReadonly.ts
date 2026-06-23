import { computed, type Ref } from "vue";
import type { BomPreview } from "../api";
import { useAppShell } from "./useAppShell";

/** 图纸 FCStd · App::Link 只读 BOM 的文案与跳转（文件详情各 Tab 共用） */
export function useDrawingBomReadonly(preview: Ref<BomPreview | null | undefined>) {
  const shell = useAppShell();

  const bomReadonly = computed(() => preview.value?.bom_readonly ?? false);
  const bomSourceRel = computed(() => {
    const rel = preview.value?.bom_source_rel?.trim();
    return rel || null;
  });
  const canOpenSourceModel = computed(() => bomReadonly.value && Boolean(bomSourceRel.value));

  const editSubTabLabel = computed(() => (bomReadonly.value ? "查看属性" : "编辑属性"));
  const attrsPanelTitle = computed(() => (bomReadonly.value ? "查看属性" : "编辑属性"));

  const readonlyTitle = computed(() => "图纸文件 · BOM 只读");

  const readonlyDescription = computed(() => {
    if (bomSourceRel.value) {
      return "属性挂载于 App::Link，请在 Link 关联的模型 FCStd 中编辑 BOM。";
    }
    return "属性挂载于 App::Link。未能解析来源模型，请检查 Link 或同目录模型文件。";
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
