import { beforeEach, expect, it, vi } from "vitest";
import { jsonFetch } from "../../api";
import { fetchCadObjectInfo } from "./api";
import { isCadObjectInfoResult, type CadObjectInfoResult } from "./types";
vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
const fixture: CadObjectInfoResult = { document: { objects: [], xlinks: [], root_names: [] }, source: { file_size: 100, mtime_ms: 1, document_xml_bytes: 11 }, warnings: [] };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(jsonFetch).mockResolvedValue({ success: true, data: fixture }); });
it("posts an explicit workspace/file snapshot request with the caller's cancellation signal", async () => {
  const abort = new AbortController();
  expect(await fetchCadObjectInfo("/synthetic-workspace", "parts/document.FCStd", abort.signal)).toEqual(fixture);
  expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/cad/object-info", {
    method: "POST", body: JSON.stringify({ workspacePath: "/synthetic-workspace", filePath: "parts/document.FCStd" }), signal: abort.signal,
  });
});
it.each([{}, { success: false, data: fixture }, { success: true, data: { ...fixture, document: {} } }])("refuses incomplete success payloads %j", async response => {
  vi.mocked(jsonFetch).mockResolvedValue(response);
  await expect(fetchCadObjectInfo("/synthetic-workspace", "document.FCStd")).rejects.toThrow("响应格式无效");
});
it.each([
  ["missing", undefined], ["negative", -1], ["fractional", 1.5], ["not-a-number", NaN],
  ["infinite", Infinity], ["string", "11"], ["unsafe-integer", Number.MAX_SAFE_INTEGER + 1],
])("refuses invalid original XML byte count: %s", async (_caseName, document_xml_bytes) => {
  const data = { ...fixture, source: { ...fixture.source, document_xml_bytes } };
  expect(isCadObjectInfoResult(data)).toBe(false);
  vi.mocked(jsonFetch).mockResolvedValue({ success: true, data });
  await expect(fetchCadObjectInfo("/synthetic-workspace", "document.FCStd")).rejects.toThrow("响应格式无效");
});
it("checks all snake-case object fields and rejects nonfinite values instead of inventing defaults", () => {
  const object = { name: "MetadataNode", label: "", type_id: "App::Part", children: ["ChildNode"], properties: { Text: "", Count: 0 },
    material: null, placement: { x: 1, y: 2, z: 3, q0: 0, q1: 0, q2: 0, q3: 1 }, is_valid_bom_item: true, level: 0 };
  const result = { ...fixture, document: { objects: [object], xlinks: [{ file: "relative.FCStd", label: null }], root_names: [object.name] } };
  expect(isCadObjectInfoResult(result)).toBe(true);
  expect(isCadObjectInfoResult({ ...result, document: { ...result.document, objects: [{ ...object, placement: { ...object.placement, x: Infinity } }] } })).toBe(false);
  expect(isCadObjectInfoResult({ ...result, document: { ...result.document, objects: [{ ...object, properties: { Count: NaN } }] } })).toBe(false);
  expect(isCadObjectInfoResult({ ...result, document: { ...result.document, objects: [{ ...object, level: -1 }] } })).toBe(false);
  expect(isCadObjectInfoResult({ ...fixture, source: { file_size: 1, mtime_ms: 1e20 } })).toBe(false);
});
