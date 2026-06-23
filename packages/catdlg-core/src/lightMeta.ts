import { parseCatDlg } from "./parseCatDlg.js";

/** 从 `.CATDlg` 文本提取根 `CATDlgDialog` 实例名；失败返回 null。 */
export function extractCatDlgDialogName(text: string): string | null {
  try {
    const nodes = parseCatDlg(text);
    const root = nodes.find((n) => n.type === "CATDlgDialog");
    return root?.id ?? null;
  } catch {
    return null;
  }
}
