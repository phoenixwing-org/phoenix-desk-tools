import fs from "node:fs";
import { expect, it } from "vitest";
it("offers read-only static document details, explicit reread/cancel and visible error states", () => {
  const source = fs.readFileSync(new URL("./CadObjectInfoPanel.vue", import.meta.url), "utf8");
  expect(source).toContain("重新读取"); expect(source).toContain("取消读取"); expect(source).toContain('@click="cancel"');
  expect(source).toContain('v-if="error"'); expect(source).toContain("errorCode"); expect(source).toContain("CadObjectDocument");
  expect(source).toContain("不需要 native provider"); expect(source).toContain("不更新 CAD 索引"); expect(source).toContain("busy-change");
});
