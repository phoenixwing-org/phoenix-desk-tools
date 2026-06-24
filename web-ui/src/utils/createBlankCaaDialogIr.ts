import type { CaaDialogIr } from "../types/caaDialogIr";

/** 生成空白对话框 IR（仅 Dialog 壳 + CATDlgWndBtn 按钮栏），用于「新建」功能 */
export function createBlankCaaDialogIr(dialogName = "NewDlg"): CaaDialogIr {
  return {
    schemaVersion: 1,
    dialogName,
    title: dialogName,
    root: {
      id: dialogName,
      type: "CATDlgDialog",
      style: ["CATDlgWndBtn"],
      children: [],
    },
    sources: { catDlg: "" },
  };
}
