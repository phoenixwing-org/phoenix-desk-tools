import { readFileSync } from "node:fs";
import { parse } from "vue/compiler-sfc";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticInspection } from "./fixtures.test-support";
const inspect = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ assemblyMaintenanceApi: { inspect } }));
vi.mock("phoenix-wing/components/PnwAppModalOverlay.vue", async () => {
  const { defineComponent, h } = await import("vue");
  return { default: defineComponent({ props: ["open", "ariaLabel"], setup: (props, { slots }) => () => props.open ? h("section", { role: "dialog", "aria-label": props.ariaLabel }, slots.default?.()) : null }) };
});
import AssemblyMaintenanceDialog from "./AssemblyMaintenanceDialog.vue";
beforeEach(() => { vi.resetAllMocks(); inspect.mockResolvedValue(syntheticInspection()); });

describe("assembly maintenance dialog UI", () => {
  it("uses the Wing modal, header actions and conservative scope language without native writes", async () => {
    const app = createSSRApp({ render: () => h(AssemblyMaintenanceDialog, { open: true, workspacePath: "/synthetic/workspace", filePath: "examples/SampleAssembly.FCStd" }) });
    const html = await renderToString(app);
    for (const text of ["装配检查与修正", "检查中…", "生成更新预览", "生成验证副本（默认）", "写回原文件", "关闭", "仅只读磁盘中的当前文件", "不读取目标文件内容", "不重算或保存"]) expect(html).toContain(text);
    expect(html).toMatch(/<button[^>]+disabled[^>]*>生成更新预览<\/button>/);
    expect(html).toMatch(/<button[^>]+disabled[^>]*>生成验证副本（默认）<\/button>/);
    expect(html).toContain("更新历史与只读核对"); expect(html).toContain("查看有限历史（只读）"); expect(html).toContain("按编号只读核对");
    expect(html).toContain("只读核对的任务 UUID"); expect(html).toContain("这些记录不恢复旧预览或发布权限");
    const file = readFileSync(new URL("./AssemblyMaintenanceDialog.vue", import.meta.url), "utf8"); expect(parse(file).errors).toEqual([]);
    expect(file).toContain('from "phoenix-wing/components/PnwAppModalOverlay.vue"');
    expect(file).toContain("重新检查");
    expect(file).toContain("当前同步状态：未验证"); expect(file).toContain("不代表关节求解正常");
    expect(file).toContain("请明确勾选"); expect(file).toContain("进程快照，不是万能锁"); expect(file).not.toContain("待接通");
    expect(file).toContain("历史已截断，不是完整列表，也不保证包含最新任务");
    expect(file).not.toMatch(/window\.confirm|v-html|execute_code|\.pnw-modal-panel|update\.available\s*\?/);
  });
});
