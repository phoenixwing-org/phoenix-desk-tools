import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBom } from "../api";

vi.mock("../utils/runtimeBridge", () => ({ apiUrl: (url: string) => url, invokeTauri: vi.fn(), isTauriRuntime: () => false }));
afterEach(() => vi.unstubAllGlobals());
function mockFetch() {
  const fetch = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("File detail captured workspace request", () => {
  it("sends the captured workspace together with the selected relative path", async () => {
    const fetch = mockFetch();
    await fetchBom("Parts/Test panel.FCStd", "/synthetic/workspace A");
    expect(fetch.mock.calls[0][0]).toBe("/api/cad/bom/file?rel=Parts%2FTest%20panel.FCStd&workspace=%2Fsynthetic%2Fworkspace%20A");
  });
  it("keeps existing callers on the current-workspace route when no workspace is supplied", async () => {
    const fetch = mockFetch();
    await fetchBom("Parts/Test.FCStd");
    expect(fetch.mock.calls[0][0]).toBe("/api/cad/bom/file?rel=Parts%2FTest.FCStd");
  });
});
