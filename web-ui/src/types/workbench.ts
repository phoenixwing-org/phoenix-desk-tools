import type { BomFields } from "../api";

export type WorkbenchTabPayload = {
  bomRel?: string;
  partKey?: {
    partNumber: string;
    partVersion: string;
  };
  fileRename?: {
    rel: string;
    form: Partial<BomFields>;
    baseline: Partial<BomFields>;
  };
  renameAnalysis?: {
    renameLogId?: number;
    oldBasename?: string;
    newBasename?: string;
    excludeRepoRel?: string;
    autoAnalyze?: boolean;
  };
};

export type WorkbenchTab = {
  id: string;
  pageId: string;
  title: string;
  subtitle?: string;
  contextKey?: string;
  dirty: boolean;
  payload?: WorkbenchTabPayload;
  payloadConsumed: boolean;
  /** 从 DB / sessionStorage 恢复的页内快照，hydrate 后清除 */
  pageState?: Record<string, unknown>;
};

export type WorkbenchSessionTab = {
  id: string;
  pageId: string;
  title: string;
  subtitle?: string;
  contextKey?: string;
  pageState?: Record<string, unknown>;
};

export type WorkbenchSessionSnapshot = {
  version: number;
  activeTabId: string;
  tabs: WorkbenchSessionTab[];
};

export type OpenTabOptions = {
  pageId: string;
  title?: string;
  subtitle?: string;
  contextKey?: string;
  payload?: WorkbenchTabPayload;
  /** 强制新建（如从树打开第二个同名文件 Tab） */
  forceNew?: boolean;
};

export type PageTabPolicy = {
  maxTabs: number;
  tabEnabled: boolean;
};
