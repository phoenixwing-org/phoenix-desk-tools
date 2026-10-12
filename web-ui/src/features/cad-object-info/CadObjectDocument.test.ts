import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { expect, it } from "vitest";
import CadObjectDocument from "./CadObjectDocument.vue";
import type { CadDocumentObject, CadObjectInfoResult } from "./types";
const object = (name: string): CadDocumentObject => ({ name, label: "", type_id: "App::Part", children: ["ChildNode"], properties: { Empty: "", Zero: 0, Note: "<script>unsafe()</script>" },
  material: "synthetic material", placement: { x: 1, y: 2, z: 3, q0: 0, q1: 0, q2: 0, q3: 1 }, is_valid_bom_item: true, level: 0 });
const fixture: CadObjectInfoResult = { document: { objects: [object("RootNode"), { ...object("ChildNode"), label: "Saved label", children: [], material: null, placement: null, level: 1, is_valid_bom_item: false }],
  root_names: ["RootNode"], xlinks: [{ file: "relative.FCStd", label: null }, { file: "another-relative.FCStd", label: "" }] }, source: { file_size: 120, mtime_ms: 1, document_xml_bytes: 240 }, warnings: ["synthetic unsupported complex property"] };
const render = (result = fixture) => renderToString(createSSRApp(CadObjectDocument, { result }));
it("shows the full snake-case document, roots, children, properties, material and local placement", async () => {
  const html = await render();
  for (const text of ["RootNode", "ChildNode", "Saved label", "App::Part", "内部名称 name", "标签 label", "类型 type_id", "有效 BOM 类型", "层级 level", "Material", "synthetic material", "子对象 children", "root_names", "relative.FCStd", "全部标量属性 properties", "Empty", "Zero", "局部 Placement", "q0", "q1", "q2", "q3"]) expect(html).toContain(text);
  expect(html).toContain("未保存"); expect(html).toContain("（空值）"); expect(html).toContain("不是世界坐标");
  expect(html).toContain("synthetic unsupported complex property"); expect(html).toContain("120 字节");
});
it("distinguishes original XML bytes from the archive snapshot size", async () => {
  const html = await render();
  expect(html).toContain("源文件快照：120 字节");
  expect(html).toContain("Document.xml 原始 240 字节（UTF-8，BOM 若有则计入）");
});
it("renders saved property text safely without executing HTML", async () => {
  const html = await render(); expect(html).toContain("&lt;script&gt;unsafe()&lt;/script&gt;"); expect(html).not.toContain("<script>unsafe()");
});
it("distinguishes an empty document, absent roots and absent XLinks", async () => {
  const html = await render({ ...fixture, document: { objects: [], root_names: [], xlinks: [] }, warnings: [] });
  expect(html).toContain("文档没有对象"); expect(html).toContain("没有符合 BOM 类型"); expect(html).toContain("没有保存的 XLink 引用");
});
it("pages a large saved object list without discarding its total or silently hiding later rows", async () => {
  const html = await render({ ...fixture, document: { ...fixture.document, objects: Array.from({ length: 51 }, (_, i) => object(`MetadataNode${i}`)) } });
  expect(html).toContain("51 个对象"); expect(html).toContain("MetadataNode49"); expect(html).not.toContain("MetadataNode50");
  expect(html).toContain("第 1 / 2 页"); expect(html).toContain("下一页");
});
