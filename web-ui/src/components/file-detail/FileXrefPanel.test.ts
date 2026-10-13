import fs from "node:fs";
import { parse } from "vue/compiler-sfc";
import { describe, expect, it } from "vitest";

describe("file reference panel offline delivery scope notice", () => {
  it("describes the Desk offline entry without promising remote receiver compatibility or a legacy entry", () => {
    const source = fs.readFileSync(new URL("./FileXrefPanel.vue", import.meta.url), "utf8");
    const parsed = parse(source);
    expect(parsed.errors).toEqual([]);
    expect(parsed.descriptor.template?.content).toContain("离线导出入口已在 Desk；远程交付另行开发。");
    expect(parsed.descriptor.template?.content).not.toMatch(/正式 BOM 交付尚在迁移|旧扩展交付入口暂时保留/);
  });
});
