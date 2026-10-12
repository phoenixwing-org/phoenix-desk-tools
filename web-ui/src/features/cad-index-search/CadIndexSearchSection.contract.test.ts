import fs from "node:fs";
import { expect, it } from "vitest";

it("offers bounded asset metadata, source/empty/error feedback and explicit safe navigation/update actions", () => {
  const source = fs.readFileSync(new URL("./CadIndexSearchSection.vue", import.meta.url), "utf8");
  for (const field of ["filename", "repo_rel_path", "part_number", "part_version", "part_name", "label"]) expect(source).toContain(`prop="${field}"`);
  expect(source).toContain("六字段 OR"); expect(source).toContain("多词 AND 路径筛选");
  expect(source).toContain("SQLite LIKE"); expect(source).toContain("source");
  expect(source).toContain("索引没有匹配项"); expect(source).toContain("已达到 200 项上限");
  expect(source).toContain('v-if="error"'); expect(source).toContain("打开详情");
  expect(source).toContain("emit('open', row.repo_rel_path)"); expect(source).toContain("emit('update')");
  expect(source).toContain('useCadIndexSearch(toRef(props, "workspace"), toRef(props, "refreshToken"))');
});
it("uses the existing CAD index page and file-detail navigation rather than a second scanner", () => {
  const source = fs.readFileSync(new URL("../../pages/CadIndexPage.vue", import.meta.url), "utf8");
  expect(source).toContain("<CadIndexSearchSection"); expect(source).toContain('@open="shell.openFileDetailForRel"'); expect(source).toContain('@update="scan"');
  expect(source).toContain("computed(() => cadIndexSearchRefreshToken(data.value))");
  expect(source).toContain(':refresh-token="searchRefreshToken"');
  expect(source).not.toContain(':refresh-token="data?.lastScanAt"');
});
