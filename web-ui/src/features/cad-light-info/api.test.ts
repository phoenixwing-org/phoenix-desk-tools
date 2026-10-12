import { beforeEach, expect, it, vi } from "vitest";
import { jsonFetch } from "../../api";
import { fetchCadLightInfo } from "./api";
import { isCadLightInfoResult } from "./types";
import { syntheticLightInfo } from "./fixtures.test-support";
vi.mock("../../api", () => ({ jsonFetch: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(jsonFetch).mockResolvedValue({ success: true, data: syntheticLightInfo() }); });
it("posts only an explicit workspace/file and preserves the caller's cancellation signal", async () => {
  const abort = new AbortController();
  expect(await fetchCadLightInfo("/synthetic-workspace", "components/model.FCStd", abort.signal)).toEqual(syntheticLightInfo());
  expect(jsonFetch).toHaveBeenCalledExactlyOnceWith("/api/cad/light-info", { method: "POST", body: JSON.stringify({ workspacePath: "/synthetic-workspace", filePath: "components/model.FCStd" }), signal: abort.signal });
});
it.each([
  ["missing-success", {}], ["failed", { success: false, data: syntheticLightInfo() }], ["nonboolean", { success: "true", data: syntheticLightInfo() }], ["missing-data", { success: true }],
])("refuses incomplete light transport: %s", async (_name, response) => {
  vi.mocked(jsonFetch).mockResolvedValue(response);
  await expect(fetchCadLightInfo("/synthetic-workspace", "model.FCStd")).rejects.toThrow("响应格式无效");
});
it.each([
  ["missing", undefined], ["negative", -1], ["fractional", 1.5], ["nan", NaN], ["infinity", Infinity], ["string", "240"], ["unsafe", Number.MAX_SAFE_INTEGER + 1],
])("rejects invalid raw XML bytes: %s", (_name, bytes) => {
  const data = syntheticLightInfo(); expect(isCadLightInfoResult({ ...data, analysis: { ...data.analysis, documentXmlBytes: bytes } })).toBe(false);
});
it("accepts empty fields/documents and retained empty embedded values without inventing data", () => {
  const data = syntheticLightInfo();
  expect(isCadLightInfoResult(data)).toBe(true);
  expect(isCadLightInfoResult({ ...data, analysis: { documentXmlBytes: 0, objectCount: 0, xlinks: [], embeddedFields: {} }, diagnostics: { items: [], counts: { resolved: 0, ambiguous: 0, missing: 0, self: 0, non_fcstd: 0 } } })).toBe(true);
});
it.each(["resolved", "ambiguous", "missing", "self", "non_fcstd"] as const)("accepts server classification %s without frontend re-resolution", status => {
  const data = syntheticLightInfo();
  data.diagnostics.items[0] = { ...data.diagnostics.items[0], status, targetRelativePath: status === "resolved" || status === "self" ? "components/child.FCStd" : null, candidates: status === "ambiguous" ? ["first/child.FCStd", "second/child.FCStd"] : [] };
  data.diagnostics.counts.resolved = 0; data.diagnostics.counts[status] = 1;
  expect(isCadLightInfoResult(data)).toBe(true);
});
it.each(["../escape.FCStd", "./child.FCStd", "/absolute.FCStd", "C:/absolute.FCStd", "child\\file.FCStd", "a\nchild.FCStd", "a\u007fchild.FCStd", "a//child.FCStd"])("rejects non-normalized target candidate %j", candidate => {
  const data = syntheticLightInfo(); data.diagnostics.items[0].candidates = [candidate]; expect(isCadLightInfoResult(data)).toBe(false);
});
it.each(["missing-count", "wrong-count", "missing-item", "unknown-status", "non-string-field", "unknown-field", "nonfinite-mtime", "negative-size", "fractional-object-count"])("rejects malformed summary field %s", name => {
  const data = syntheticLightInfo() as unknown as Record<string, any>;
  if (name === "missing-count") delete data.diagnostics.counts.self;
  if (name === "wrong-count") data.diagnostics.counts.resolved = 2;
  if (name === "missing-item") data.diagnostics.items = [];
  if (name === "unknown-status") data.diagnostics.items[0].status = "partial";
  if (name === "non-string-field") data.analysis.embeddedFields.PartName = 2;
  if (name === "unknown-field") data.analysis.embeddedFields.Extra = "unexpected";
  if (name === "nonfinite-mtime") data.source.mtime_ms = Infinity;
  if (name === "negative-size") data.source.file_size = -1;
  if (name === "fractional-object-count") data.analysis.objectCount = 1.5;
  expect(isCadLightInfoResult(data)).toBe(false);
});
it("requires resolved target identity but never accepts a missing target identity", () => {
  const data = syntheticLightInfo(); data.diagnostics.items[0].targetRelativePath = null; expect(isCadLightInfoResult(data)).toBe(false);
  data.diagnostics.items[0].targetRelativePath = "components/child.FCStd"; data.diagnostics.items[0].status = "missing"; data.diagnostics.counts = { resolved: 0, ambiguous: 0, missing: 1, self: 0, non_fcstd: 0 }; expect(isCadLightInfoResult(data)).toBe(false);
});
it("retains a self target but does not treat it as resolved", () => {
  const data = syntheticLightInfo(); data.diagnostics.items[0].status = "self"; data.diagnostics.counts = { resolved: 0, ambiguous: 0, missing: 0, self: 1, non_fcstd: 0 };
  expect(isCadLightInfoResult(data)).toBe(true); data.diagnostics.items[0].targetRelativePath = null; expect(isCadLightInfoResult(data)).toBe(false);
});
it("accepts an ambiguous suggested target only among the candidates without reclassifying it", () => {
  const data = syntheticLightInfo(); data.diagnostics.items[0].status = "ambiguous"; data.diagnostics.items[0].candidates = ["components/child.FCStd", "other/child.FCStd"]; data.diagnostics.counts = { resolved: 0, ambiguous: 1, missing: 0, self: 0, non_fcstd: 0 };
  expect(isCadLightInfoResult(data)).toBe(true); data.diagnostics.items[0].targetRelativePath = "unknown/child.FCStd"; expect(isCadLightInfoResult(data)).toBe(false);
});
it("preserves raw Windows XLinks and accepts ordinary POSIX colons in relative candidate filenames", () => {
  const data = syntheticLightInfo(); data.analysis.xlinks[0].file = "Z:\\synthetic\\child.FCStd"; data.diagnostics.items[0].file = "Z:/synthetic/child.FCStd"; data.diagnostics.items[0].targetRelativePath = "components/child:variant.FCStd"; data.diagnostics.items[0].candidates = ["components/child:variant.FCStd"];
  expect(isCadLightInfoResult(data)).toBe(true);
});
it("rejects a classification row attached to a different source XLink", () => {
  const data = syntheticLightInfo(); data.diagnostics.items[0].file = "different/child.FCStd";
  expect(isCadLightInfoResult(data)).toBe(false);
});
it("rejects reordered classifications even when row totals and all per-status counts remain valid", () => {
  const data = syntheticLightInfo(); data.analysis.xlinks.push({ file: "other/child.FCStd", label: "Other source" });
  data.diagnostics.items.push({ ...data.diagnostics.items[0], file: "other/child.FCStd", label: "Other source", targetRelativePath: "other/child.FCStd", candidates: ["other/child.FCStd"] });
  data.diagnostics.counts.resolved = 2; expect(isCadLightInfoResult(data)).toBe(true);
  data.diagnostics.items.reverse(); expect(isCadLightInfoResult(data)).toBe(false);
});
