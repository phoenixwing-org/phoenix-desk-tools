import type { CaaDialogIr } from "./caaDialogIr";

export interface CaaDialogDraft {
  id: string; // crypto.randomUUID()
  dialogName: string; // 默认 "NewDlg"
  ir: CaaDialogIr; // 完整 IR 树（初始仅 Dialog 壳）
  nlsFlat: Record<string, string>; // NLS key-value
  createdAt: string; // ISO timestamp
  updatedAt: string; // 每次编辑更新
}
