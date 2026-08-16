import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/WelcomePage.vue"), "utf8");

describe("Desk Workspace welcome consumer contract", () => {
  it("直接消费 Wing Workspace snapshot 并把动作交回 Desk 真源", () => {
    expect(source).toContain("PnwWorkspaceWelcome");
    expect(source).toContain(':state="shell.workspaceState.value"');
    expect(source).toContain('@open-workspace="openWorkspacePicker"');
    expect(source).toContain('@open-recent="openWorkspace"');
    expect(source).toContain('@remove-recent="removeRecent"');
    expect(source).toContain("shell.removeRecentWorkspace(entry.rootPath)");
    expect(source).not.toContain('from "../api"');
  });

  it("只在公共 slots 中保留品牌、产品动作、链接和模块范围", () => {
    for (const slot of ["#brand", "#rail-actions", "#links", "#head-actions", "#entry-actions"]) {
      expect(source).toContain(slot);
    }
    expect(source).toContain("PnwSelect");
    expect(source).toContain("shell.setWorkspaceModuleScope");
    expect(source).toContain("CaaUnsavedDraftsPanel");
  });

  it("不再复制 Wing 的两栏、最近列表、主题与响应式结构 CSS", () => {
    expect(source).not.toMatch(/class="welcome-(?:shell|rail|main|head)"/u);
    expect(source).not.toMatch(/class="recent-(?:list|item|open|remove)"/u);
    expect(source).not.toContain("<aside");
    expect(source).not.toContain("<main");
    expect(source).not.toContain("<ul");
    expect(source).not.toContain("@media");
    expect(source).not.toContain("--phoenix-bg-welcome");
  });
});
