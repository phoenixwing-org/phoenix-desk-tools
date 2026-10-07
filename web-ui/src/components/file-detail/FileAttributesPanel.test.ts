import { createSSRApp, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { ID_INJECTION_KEY } from "element-plus";
import { expect, it, vi } from "vitest";
import type { BomPreview } from "../../api";
import FileAttributesPanel from "./FileAttributesPanel.vue";

let context: Record<string, unknown>;
vi.mock("../../composables/useFileDetailContext", () => ({ useFileDetailContext: () => context }));
vi.mock("../../composables/useAppShell", () => ({ useAppShell: () => ({ openFileDetailForRel: vi.fn() }) }));

async function render(readonly: boolean, source: string | null = "parts/Model.FCStd") {
  const fields = { filename: "Sheet.Drawing.FCStd", PartNumber: "720421", PartVersion: "003", TypeCode: "H", ModelSeries: "DEMO", PartName: "测试面板", label: "测试面板" };
  context = {
    rel: ref("sheets/Sheet.Drawing.FCStd"),
    preview: ref({ is_fcstd: true, bom_readonly: readonly, bom_source_rel: source, fields, document_kinds: { drawing: readonly, part: !readonly, display: readonly ? "图纸" : "零件", recommended_suffix: readonly ? ".Drawing.FCStd" : ".FCStd" } } as BomPreview),
    form: ref({ ...fields }), baseline: ref({ ...fields }), pageError: ref(""), reloadFile: vi.fn(), rememberFilenameDraft: vi.fn(),
  };
  const app = createSSRApp(FileAttributesPanel);
  app.provide(ID_INJECTION_KEY, { prefix: 1, current: 0 });
  return renderToString(app);
}

it("hides all model attribute inputs/actions for a separate drawing, retaining filename and source navigation", async () => {
  const html = await render(true);
  expect(html).toContain('aria-label="文件名"');
  for (const name of ["零件号", "版本", "类型码", "型号系列", "零件名称", "标签"]) expect(html).not.toContain(`aria-label="${name}"`);
  for (const text of ["写入文件", "全部推荐", "名称补全来源", "工作空间记忆"]) expect(html).not.toContain(text);
  expect(html).toContain("打开模型"); expect(html).toContain("独立图纸不编辑 BOM 属性");
});
it("keeps attribute inputs for a model containing internal TechDraw pages", async () => {
  const html = await render(false);
  expect(html).toContain('aria-label="零件名称"'); expect(html).toContain('aria-label="标签"');
  expect(html).toContain("写入文件"); expect(html).toContain("全部推荐");
});
it("shows a source-not-found result without a broken source-model button", async () => {
  const html = await render(true, null);
  expect(html).toContain("未找到唯一源模型"); expect(html).not.toContain("打开模型");
});
