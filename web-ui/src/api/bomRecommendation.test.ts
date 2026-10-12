import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendBomField, recommendBomFieldsAll } from "../api";

vi.mock("../utils/runtimeBridge", () => ({ apiUrl: (url: string) => url, invokeTauri: vi.fn(), isTauriRuntime: () => false }));
afterEach(() => vi.unstubAllGlobals());

const fields = { PartName: "Synthetic existing name", label: "Synthetic node label" };
const kinds = { part: true, assembly: true, drawing: true };
function mockFetch() {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ field: "PartName", value: "Synthetic proposal", source_note: "Synthetic", filled: true })));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("BOM recommendation source request contract", () => {
  it.each(["filename", "label"] as const)("sends the explicit %s source flag for the row action", async source => {
    const fetch = mockFetch();
    await recommendBomField("synthetic/Example.FCStd", "PartName", fields, kinds, source, true);
    expect(fetch.mock.calls[0][0]).toBe("/api/cad/bom/recommend-field?rel=synthetic%2FExample.FCStd&field=PartName");
    const init = fetch.mock.calls[0][1];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ ...fields, kind_filters: kinds, name_source: source, explicit_name_source: true });
  });
  it("retains default PartName-first policy for an ordinary row recommendation", async () => {
    const fetch = mockFetch();
    await recommendBomField("synthetic/Example.FCStd", "PartName", fields, kinds);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ name_source: "label", explicit_name_source: false });
  });
  it("does not propagate an explicit override into recommend-all", async () => {
    const fetch = mockFetch();
    await recommendBomFieldsAll("synthetic/Example.FCStd", fields, kinds, "filename");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.name_source).toBe("filename");
    expect(body).not.toHaveProperty("explicit_name_source");
  });
});
