import { expect, it } from "vitest";
import { attributeDraftKey, readAttributeDrafts, validDraftName } from "./batchAttributeDraftCache";
it.each(["", "  ", "S", " s ", "A", "z", "Ｓ", "x.ASSY", "x.fcstd", "x.Drawing", "a/b", "..", "x".repeat(256), "中".repeat(86)])("rejects unsafe or non-plain manual name [case %#] %s", value => expect(validDraftName(value)).toBe(false));
it.each([" 支架 ", "轴", "S型支架", "S-夹具", "M6螺栓", "AB", "框架-顶板", "部件.ASSY.Detail", "中".repeat(85)])("accepts a plain manual name %s", value => expect(validDraftName(value)).toBe(true));
it("treats malformed or partial browser data as untrusted and clears execution authority", () => {
  const preview = { plan_id: "forged", batch_dir: ".", scanned: 0, overwrite: false, rows: [], errors: [], skipped: [] };
  const read = (data: unknown) => readAttributeDrafts({ getItem: () => JSON.stringify(data), setItem: () => {}, removeItem: () => {} }, "key");
  expect(read({ version: 1, names: {}, preview })?.preview.plan_id).toBe("");
  for (const bad of [null, {}, { version: 2, names: {}, preview }, { version: 1, names: [], preview }, { version: 1, names: {}, preview: { ...preview, rows: [null] } }, { version: 1, names: {}, preview: { ...preview, errors: [{}] } }]) expect(read(bad)).toBeNull();
});
it("keys drafts by workspace, scope and all preview-affecting options", () => {
  expect(attributeDraftKey("/ws", " ", false, "label")).toBe(attributeDraftKey("/ws", ".", false, "label", false));
  const keys = [["/ws", ".", false, "label", false], ["/other", ".", false, "label", false], ["/ws", "parts", false, "label", false], ["/ws", ".", true, "label", false], ["/ws", ".", false, "filename", false], ["/ws", ".", false, "label", true]] as const;
  expect(new Set(keys.map(([workspace, directory, overwrite, source, drawings]) => attributeDraftKey(workspace, directory, overwrite, source, drawings))).size).toBe(keys.length);
});
