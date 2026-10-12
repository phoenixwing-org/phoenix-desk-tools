import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import CadLightSummary from "./CadLightSummary.vue";
import { syntheticLightInfo } from "./fixtures.test-support";
const render = (result = syntheticLightInfo()) => renderToString(createSSRApp(CadLightSummary, { result }));
it("shows original XML bytes separately from archive size and object count", async () => {
  const html = await render();
  for (const text of ["Document.xml 原始 240 字节", "2 个对象", "源文件快照：120 字节", "BOM 若有则计入", "不是 FreeCAD 运行态"]) expect(html).toContain(text);
});
it("shows embedded fields, retained empty values and deduplicated source labels", async () => {
  const html = await render();
  for (const text of ["embeddedFields", "PartName", "Synthetic metadata", "generic", "（空值）", "去重源 XLink：1 条", "components/child.FCStd", "Saved instance", "已解析", "不表示引用实例数或 BOM 数量"]) expect(html).toContain(text);
});
it("labels an ambiguous suggested target as unresolved, not as an accepted match", async () => {
  const data = syntheticLightInfo(); data.diagnostics.items[0].status = "ambiguous";
  data.diagnostics.items[0].candidates = ["components/child.FCStd", "other/child.FCStd"];
  const html = await render(data); expect(html).toContain("建议匹配（未解析）"); expect(html).toContain("多个候选"); expect(html).not.toContain("已解析");
});
it("renders unresolved candidates and saved content as escaped text", async () => {
  const data = syntheticLightInfo(); data.analysis.embeddedFields.PartName = "<script>not executable</script>";
  data.diagnostics.items[0] = { ...data.diagnostics.items[0], status: "ambiguous", targetRelativePath: null, candidates: ["first/child.FCStd", "second/child.FCStd"], message: "Review candidates" };
  const html = await render(data); expect(html).toContain("多个候选"); expect(html).toContain("first/child.FCStd"); expect(html).toContain("second/child.FCStd"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
});
it("distinguishes absent fields and absent saved XLinks", async () => {
  const data = syntheticLightInfo(); data.analysis.embeddedFields = {}; data.analysis.xlinks = []; data.diagnostics.items = [];
  const html = await render(data); expect(html).toContain("未发现内嵌字段"); expect(html).toContain("没有保存的源 XLink");
});
it("pages source references without discarding the full total", async () => {
  const data = syntheticLightInfo();
  data.analysis.xlinks = Array.from({ length: 51 }, (_, index) => ({ file: `synthetic-${index}.FCStd`, label: "" }));
  data.diagnostics.items = data.analysis.xlinks.map(link => ({ ...link, status: "missing", targetRelativePath: null, candidates: [], message: "Not found" }));
  const html = await render(data); expect(html).toContain("去重源 XLink：51 条"); expect(html).toContain("synthetic-49.FCStd"); expect(html).not.toContain("synthetic-50.FCStd"); expect(html).toContain("第 1 / 2 页"); expect(html).toContain("下一页");
});
