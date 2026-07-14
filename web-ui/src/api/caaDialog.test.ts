import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCaaIndexGroups, scanCaaIndex } from "./caaDialog";

function mockJsonResponse(ok: boolean, status: number, data: unknown): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe("CAA index API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads persisted index groups for the selected workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse(true, 200, {
        workspaceRoot: "D:/ws",
        count: 1,
        indexed: true,
        last_scan_at: "2026-07-10T08:00:00.000Z",
        groups: [
          {
            groupKey: "DemoUI.m",
            label: "DemoUI.m",
            items: [
              {
                catDlgRel: "DemoUI.m/LocalInterfaces/BomDlg.CATDlg",
                dialogName: "BomDlg",
                fileName: "BomDlg.CATDlg",
                groupKey: "DemoUI.m",
                groupLabel: "DemoUI.m",
              },
            ],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await fetchCaaIndexGroups("bom", { workspaceRoot: "D:/ws" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/caa/index/groups?q=bom&workspaceRoot=D%3A%2Fws");
    expect(data).toMatchObject({ indexed: true, count: 1, workspaceRoot: "D:/ws" });
  });

  it("surfaces a missing index route instead of hiding it with a live scan", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse(false, 404, { error: "未找到 API 路由" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCaaIndexGroups(undefined, { workspaceRoot: "D:/ws" }))
      .rejects.toThrow("未找到 API 路由");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("scans the persisted index for the selected workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockJsonResponse(true, 200, {
        workspaceRoot: "D:/ws",
        count: 0,
        groups: [],
        indexed: true,
        summary: "扫描完成",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await scanCaaIndex({ workspaceRoot: "D:/ws" });

    expect(fetchMock).toHaveBeenCalledWith("/api/caa/index/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceRoot: "D:/ws" }),
    });
    expect(data).toMatchObject({ indexed: true, count: 0, summary: "扫描完成" });
  });
});
