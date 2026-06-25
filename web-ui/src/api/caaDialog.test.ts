import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCaaIndexGroups, scanCaaIndex } from "./caaDialog";

function mockJsonResponse(ok: boolean, status: number, data: unknown): Response {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(data),
  } as unknown as Response;
}

describe("CAA index API fallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to live dialog list when index groups route is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(false, 404, { detail: "Not Found" }))
      .mockResolvedValueOnce(
        mockJsonResponse(true, 200, {
          workspaceRoot: "D:/ws",
          count: 2,
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
                {
                  catDlgRel: "OtherUI.m/LocalInterfaces/OtherDlg.CATDlg",
                  dialogName: "OtherDlg",
                  fileName: "OtherDlg.CATDlg",
                  groupKey: "OtherUI.m",
                  groupLabel: "OtherUI.m",
                },
              ],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const data = await fetchCaaIndexGroups("bom", { fallbackWorkspaceRoot: "D:/ws" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/caa/index/groups?q=bom");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/caa/dialog/list",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(data.indexFallback).toBe(true);
    expect(data.indexed).toBe(true);
    expect(data.count).toBe(1);
    expect(data.groups[0]?.items[0]?.dialogName).toBe("BomDlg");
  });

  it("falls back to live dialog list when index scan route is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockJsonResponse(false, 404, { detail: "Not Found" }))
      .mockResolvedValueOnce(
        mockJsonResponse(true, 200, {
          workspaceRoot: "D:/ws",
          count: 0,
          groups: [],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const data = await scanCaaIndex({ fallbackWorkspaceRoot: "D:/ws" });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/caa/index/scan", { method: "POST" });
    expect(data.indexFallback).toBe(true);
    expect(data.indexed).toBe(true);
    expect(data.count).toBe(0);
  });
});
