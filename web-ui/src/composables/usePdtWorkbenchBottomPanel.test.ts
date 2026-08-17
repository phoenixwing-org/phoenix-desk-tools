import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { AppShellContext } from "./useAppShell";

const pdtAppShellMock = vi.hoisted(() => ({
  useAppShell: vi.fn(),
}));

vi.mock("./useAppShell", () => ({
  useAppShell: pdtAppShellMock.useAppShell,
}));

import { usePdtWorkbenchBottomPanel } from "./usePdtWorkbenchBottomPanel";

function pdtShellWithLog(text: string): AppShellContext {
  return { logText: ref(text) } as AppShellContext;
}

describe("usePdtWorkbenchBottomPanel", () => {
  it("AppShell 自身传入 host 时不读取当前实例的 inject", () => {
    const shell = pdtShellWithLog("one\ntwo");
    pdtAppShellMock.useAppShell.mockImplementation(() => {
      throw new Error("不应读取 inject fallback");
    });

    const panel = usePdtWorkbenchBottomPanel(shell);

    expect(pdtAppShellMock.useAppShell).not.toHaveBeenCalled();
    expect(panel.tabs.value).toEqual([{ id: "output", label: "运行日志", count: 2 }]);
  });

  it("后代组件无参时仍使用 AppShell inject fallback", () => {
    const shell = pdtShellWithLog("line");
    pdtAppShellMock.useAppShell.mockReturnValue(shell);

    const panel = usePdtWorkbenchBottomPanel();

    expect(pdtAppShellMock.useAppShell).toHaveBeenCalledTimes(1);
    expect(panel.shell).toBe(shell);
  });
});
