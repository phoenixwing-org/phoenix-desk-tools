import { readFileSync } from "node:fs";
import { parse } from "vue/compiler-sfc";
import { createSSRApp, defineComponent, effectScope, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";
import { syntheticStatus } from "./fixtures.test-support";
import type { FreecadMcpApi } from "./api";
import { useFreecadMcpManager } from "./useFreecadMcpManager";
vi.mock("phoenix-wing/components/PnwAppModalOverlay.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: ["open", "ariaLabel"], setup: (props, { slots }) => () => props.open ? h("section", { role: "dialog", "aria-label": props.ariaLabel }, slots.default?.()) : null }) };
});
import FreecadMcpManagerDialog from "./FreecadMcpManagerDialog.vue";
const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");
async function render(status = syntheticStatus()) {
  const scope = effectScope(), api = { status: vi.fn().mockResolvedValue(status) } as unknown as FreecadMcpApi;
  const manager = scope.run(() => useFreecadMcpManager(api))!; await manager.open();
  const app = createSSRApp(defineComponent({ setup: () => () => h(FreecadMcpManagerDialog, { manager }) }));
  app.component("ElButton", defineComponent({ props: { disabled: Boolean, loading: Boolean }, setup: (props, { slots }) => () => h("button", { disabled: props.disabled }, slots.default?.()) }));
  try { return await renderToString(app); } finally { scope.stop(); }
}
describe("FreeCAD MCP settings UI contract", () => {
  it("renders four independent states, safe ownership choices and explicit action labels", async () => {
    const html = await render();
    for (const label of ["FreeCAD · MCP 安装与连接", "FreeCAD 路径", "插件文件", "运行连接", "批处理能力", "工具专用批处理实例", "明确复用现有实例", "我已在 FreeCAD 中核对", "保存设置", "重新检测", "预览安装计划", "检查连接", "不需要 AI 或聊天登录", "不打开、关闭或保存 CAD", "启动独立worker（连接测试）", "停止自有worker"]) expect(html).toContain(label);
    expect(html).not.toContain("MCP 已验证"); expect(html).toContain("尚未开放"); expect(html).toContain("disabled");
    expect(html).toContain(".phoenix/thumbnail-cache"); expect(html).toContain("不默认写 assets"); expect(html).toContain("主动导出并另选目录");
    expect(html).toContain("本地固定资源"); expect(html).toContain("摘要核验不代表已发布"); expect(html).toContain("本地联调候选不因此成为正式发行版");
    expect(html).toContain("Tools 已提供类型化 worker 生命周期"); expect(html).toContain("批量队列接线尚未完成");
    expect(html).toContain("关闭面板仅停止 UI 轮询，不停止后台 worker"); expect(html).toContain("owned 仅表示当前 manager 负责"); expect(html).toContain("未启用宿主开发候选");
    expect(html).toContain("视觉与支持范围仍待验"); expect(html).not.toMatch(/当前插件尚缺|生产方尚缺|生命周期与类型化 worker 尚未验收/);
  });
  it("renders missing resource reasons and cannot claim the running addon is loaded", async () => {
    const status = syntheticStatus(); status.resource = { state: "missing", version: null, reason: "未配置受信任的兼容发行资源" }; status.installation = { state: "managed", version: "1.2.3", reason: "文件已安装，当前进程未确认加载" };
    const html = await render(status); expect(html).toContain("未配置受信任的兼容发行资源"); expect(html).toContain("当前进程未确认加载"); expect(html).not.toContain("MCP 已验证");
  });
  it("shows bridge observations separately from verified stdio MCP", async () => {
    const status = syntheticStatus(); status.connection = { state: "blocked", phase: "bridge", reason: "仅桥接已响应", bridge_version: "1.2.3", supported_methods: ["get_selection"], mcp_verified: false };
    const html = await render(status); expect(html).toContain("仅 JSON 桥接已响应，MCP 未验证"); expect(html).toContain("get_selection"); expect(html).not.toContain("MCP 已验证");
  });
  it("labels verified MCP as a previous check and makes independent port configuration explicit", async () => {
    const status = syntheticStatus(); status.settings.mode = "existing";
    status.connection = { state: "ready", phase: "mcp", reason: "checked once", bridge_version: "1.2.3", supported_methods: ["get_status"], mcp_verified: true };
    const html = await render(status); expect(html).toContain("上次 MCP 检查通过（非持续连接）"); expect(html).not.toContain("MCP 已验证");
    expect(html).toContain("不发现、猜测或接管其他实例"); expect(html).toContain("不会自动同步 FreeCAD 共享配置的 preferred_port"); expect(html).toContain("请人工核对实际运行端口一致"); expect(html).toContain("默认值不代表已发现实例");
  });
  it("uses a real Wing modal and responsive business content without private framework overrides", () => {
    const dialog = source("./FreecadMcpManagerDialog.vue"), parsed = parse(dialog); expect(parsed.errors).toEqual([]);
    expect(dialog).toContain('from "phoenix-wing/components/PnwAppModalOverlay.vue"'); expect(dialog).toContain(':close-on-backdrop="!m.writing.value"'); expect(dialog).toContain(':disabled="!m.canStartWorker.value"'); expect(dialog).toContain(':disabled="!m.canStopWorker.value"');
    expect(dialog).not.toMatch(/v-html|window\.confirm|:deep\(\.pnw|\.pnw-modal-panel\s*\{|execute_code|\/RPC2/);
  });
  it("shows responsibility during startup separately from readiness and locks configuration while owned", async () => {
    const status = syntheticStatus(); status.owned_worker = { enabled: false, reason: "候选关闭，但仍可停止原实例", observation: { schema_version: 1, id: "11111111-1111-4111-8111-111111111111", phase: "starting", reason_code: "launching", owned: true, configuration_revision: "combined-host-revision", message: "正在启动自有进程" } };
    const html = await render(status); expect(html).toContain("正在启动"); expect(html).toContain("先明确停止并确认退出"); expect(html).toMatch(/<fieldset[^>]*disabled/); expect(html).not.toContain("连接测试就绪（非批次授权）"); expect(html).not.toMatch(/PID：|http:\/\/127\.0\.0\.1:/);
  });
  it("connects Config Main, header and Primary to the same explicit manager and consumes only a typed settings intent", () => {
    const page = source("../../pages/ConfigPage.vue"); expect(parse(page).errors).toEqual([]);
    expect(page).toContain('id: "freecad-mcp-manage"'); expect(page).toContain('run: freecadMcp.open'); expect(page).toContain('kind: "readonly", label: "FreeCAD MCP", value: freecadMcp.summary');
    expect(page.match(/@click="freecadMcp.open"/g)).toHaveLength(2); expect(page).toContain("payload?.config?.manageFreecadMcp"); expect(page).toContain("shell.consumeTabPayload(props.workbenchTabId)");
    expect(page).not.toContain("freecad_ok ?");
  });
  it("uses the actual Wing shell Ribbon, not the old unused RibbonPanel", () => {
    const shell = source("../../layout/AppShell.vue"), ribbon = source("../../layout/ribbon/ribbonConfig.ts");
    expect(ribbon).toContain('id: "system-freecad", label: "FreeCAD"'); expect(ribbon).toContain("pageId: FREECAD_MCP_MANAGE_ACTION");
    expect(shell).toContain('if (pageId === FREECAD_MCP_MANAGE_ACTION)'); expect(shell).toContain('shell.openTab({ pageId: "config", payload: { config: { manageFreecadMcp: true } } })');
    expect(shell).toContain(':nodes="pnwNavigationNodes"');
  });
});
