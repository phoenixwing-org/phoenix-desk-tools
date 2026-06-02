import { inject, provide, type InjectionKey, type Ref } from "vue";
import type { BomFields, BomPreview } from "../api";
import type { FileDetailSubTab } from "../types/fileDetail";

export type FileDetailContext = {
  rel: Ref<string>;
  preview: Ref<BomPreview | null>;
  form: Ref<Partial<BomFields>>;
  baseline: Ref<Partial<BomFields>>;
  originalFilename: Ref<string>;
  loading: Ref<boolean>;
  pageError: Ref<string>;
  activeSubTab: Ref<FileDetailSubTab>;
  incomingCount: Ref<number>;
  outgoingCount: Ref<number>;
  switchSubTab: (tab: FileDetailSubTab) => void;
  /** 打开改名 Tab；target 为属性里填写的目标文件名（可与磁盘当前名不同） */
  openRenameTab: (target?: string) => boolean;
  reloadFile: (targetRel?: string) => Promise<void>;
  refreshXrefCounts: () => Promise<void>;
};

const FILE_DETAIL_KEY: InjectionKey<FileDetailContext> = Symbol("fileDetail");

export function provideFileDetailContext(ctx: FileDetailContext) {
  provide(FILE_DETAIL_KEY, ctx);
}

export function useFileDetailContext(): FileDetailContext {
  const ctx = inject(FILE_DETAIL_KEY);
  if (!ctx) {
    throw new Error("useFileDetailContext 须在 FileDetailPage 内使用");
  }
  return ctx;
}
