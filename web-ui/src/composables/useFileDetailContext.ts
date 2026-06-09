import { inject, provide, type InjectionKey, type Ref } from "vue";
import type { AssemblyTreeNode, BomFields, BomPreview, FileDetailXrefsPayload } from "../api";
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
  /** 按 rel 缓存「引用」Tab 已拉取的 JSON（切换 Tab 不重复请求） */
  xrefCacheByRel: Ref<Record<string, FileDetailXrefsPayload>>;
  invalidateXrefCache: (relPath?: string) => void;
  /** 装配树缓存：key = ``${repo_rel}|first|full`` */
  assemblyCacheByKey: Ref<Record<string, AssemblyTreeNode[]>>;
  invalidateAssemblyCache: (relPath?: string) => void;
  /** 写入 Document.xml 不更名；缓存表单中的目标文件名，reload/F5 后仍显示 */
  rememberFilenameDraft: (filename: string, relPath?: string) => void;
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
