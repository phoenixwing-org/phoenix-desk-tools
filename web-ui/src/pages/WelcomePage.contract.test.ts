import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pnwNormalizeWorkspaceTypes, pnwResolveWorkspaceGate } from "phoenix-wing";

const source = readFileSync(resolve(process.cwd(), "src/pages/WelcomePage.vue"), "utf8");
const ribbonWorkspaceSource = readFileSync(
  resolve(process.cwd(), "src/layout/ribbon/RibbonWorkspaceSwitcher.vue"),
  "utf8",
);
const closeConfirmSource = readFileSync(
  resolve(process.cwd(), "src/composables/tabCloseConfirm.ts"),
  "utf8",
);
const shellSource = readFileSync(resolve(process.cwd(), "src/layout/AppShell.vue"), "utf8");
const appShellSource = readFileSync(resolve(process.cwd(), "src/composables/useAppShell.ts"), "utf8");
const homeSource = readFileSync(resolve(process.cwd(), "src/pages/HomePage.vue"), "utf8");
const indexSource = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const brandSyncSource = readFileSync(resolve(process.cwd(), "../scripts/sync-phoenix-wing-brand-assets.mjs"), "utf8");
const informationJson = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/content/welcomeInformation.json"), "utf8"),
) as {
  project: {
    id: string;
    title: string;
    defaultExpanded: boolean;
    items: Array<{ id: string; label: string }>;
  };
  contribution: {
    block: {
      id: string;
      title: string;
      defaultExpanded: boolean;
      items: Array<{ id: string; label: string }>;
    };
    cardGroup: {
      id: string;
      ariaLabel: string;
      cards: Array<{
        id: string;
        title: string;
        items: Array<{ id: string; label: string }>;
      }>;
    };
  };
};

describe("Desk Workspace welcome consumer contract", () => {
  it("直接消费 Wing Workspace snapshot 并把动作交回 Desk 真源", () => {
    expect(source).toContain("PnwWorkspaceGate");
    expect(source).toContain(':state="shell.workspaceState.value"');
    expect(source).toContain(':color-scheme="props.colorScheme"');
    expect(source).toContain('policy="required"');
    expect(source).toContain('close-workspace-label="关闭工作空间"');
    expect(ribbonWorkspaceSource).toContain("关闭工作空间…");
    expect(ribbonWorkspaceSource).not.toContain("关闭当前工作空间");
    expect(closeConfirmSource).toContain("关闭工作空间？");
    expect(closeConfirmSource).not.toContain("关闭当前工作空间？");
    expect(source).toContain('@open-workspace="openWorkspacePicker"');
    expect(source).toContain('@open-recent="openWorkspace"');
    expect(source).toContain('@remove-recent="removeRecent"');
    expect(source).toContain('@close-workspace="closeWorkspace"');
    expect(source).toContain("shell.requestCloseWorkspace()");
    expect(source).toContain("shell.removeRecentWorkspace(entry.rootPath)");
    expect(source).toContain("pnwPromptChoice");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain(":action-placement");
    expect(source).not.toMatch(/<button[^>]*>\s*关闭工作空间/u);
    expect(source).not.toContain('from "../api"');
  });

  it("只在公共 slots 中保留品牌、产品动作、链接和工作空间类型", () => {
    for (const slot of ["#brand", "#secondary-actions", "#links", "#head-actions", "#entry-actions"]) {
      expect(source).toContain(slot);
    }
    expect(source).not.toContain("#rail-actions");
    expect(source).toContain("PnwWorkspaceRailAction");
    expect(source).toContain('label="界面巡游"');
    expect(source).toContain('icon="search"');
    expect(source).toContain("PnwColorSchemeToggle");
    expect(source).toContain('@update:model-value="emit(\'update:colorScheme\', $event)"');
    expect(shellSource).toContain('@update:color-scheme="updatePnwColorScheme"');
    expect(source).not.toContain("desk-welcome-rail-action");
    expect(source).toContain("PnwWorkspaceTypeSelect");
    expect(source).toContain(":model-value=\"entry.workspaceTypeId ?? 'mixed'\"");
    expect(source).not.toContain("entryWorkspaceType");
    expect(source).not.toContain("desk-welcome-type-select");
    expect(source).toContain("shell.setWorkspaceType");
    expect(source).toContain("shell.setWorkspaceModuleScope");
    expect(source).toContain("CaaUnsavedDraftsPanel");
    expect(source).toContain("PnwPhoenixWingMark");
    expect(source).toContain('<PnwPhoenixWingMark class="desk-welcome-brand-mark" decorative />');
    expect(source).not.toContain("phoenixWingMarkUrl");
    expect(source).not.toContain('aria-hidden="true">P</span>');
    expect(source).not.toContain(":deep(");
  });

  it("无工作空间时不提供依赖工作台目标的界面巡游", () => {
    expect(source).toMatch(/<PnwWorkspaceRailAction\s+v-if="workspacePath"/u);
    expect(source).toContain("if (!workspacePath.value || touring.value || picking.value) return;");
    expect(source).not.toContain('logSource: "welcome"');
  });

  it("欢迎页直接用 Wing 组件，favicon 从 Wing 权威 SVG 同步且可只读校验", () => {
    expect(indexSource).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(indexSource).not.toContain("data:image/svg+xml");
    expect(brandSyncSource).toContain('phoenix-wing/assets/phoenix-wing-mark.svg');
    expect(brandSyncSource).toContain('process.argv.includes("--check")');
    expect(brandSyncSource).toContain("pnwSourceBytes.equals(pnwTargetBytes)");
    expect(brandSyncSource).not.toContain("data:image");
  });

  it("用 Wing 的同级 Block 呈现信息，并在贡献 Block 内使用卡片组", () => {
    expect(source).toContain("PnwInformationBlock");
    expect(source).toContain("PnwInformationCardGroup");
    expect(source).toContain("recent-collapsible");
    expect(source).toContain(':recent-default-open="true"');
    expect(source).not.toContain("recentOpen");
    expect(source).toContain(':definition="projectInformation"');
    expect(source).toContain(':definition="contributionInformation"');
    expect(source).toContain(':definition="contributionCards"');
    expect(source).not.toContain('v-for="definition in informationDefinitions"');
    expect(source).not.toContain("informationExpanded");
    expect(source).toContain(".desk-welcome-information { margin-top: 8px; }");
    expect(source).not.toContain(".desk-welcome-information { display: grid");
    const definitions = [informationJson.project, informationJson.contribution.block];
    expect(definitions.every((definition) => definition.defaultExpanded === true)).toBe(true);
    expect(informationJson.project.items.length).toBeGreaterThan(0);
    expect(informationJson.contribution.block.items).toEqual([]);
    expect(informationJson.contribution.cardGroup.cards).toHaveLength(2);
    expect(informationJson.contribution.cardGroup.cards[0]?.items.length).toBeGreaterThan(0);
    for (const definition of definitions) {
      expect(source).not.toContain(`>${definition.title}<`);
    }
    for (const item of informationJson.project.items) expect(source).not.toContain(`>${item.label}<`);
    for (const card of informationJson.contribution.cardGroup.cards) {
      expect(source).not.toContain(`>${card.title}<`);
      for (const item of card.items) expect(source).not.toContain(`>${item.label}<`);
    }
  });

  it("让 Gate 包住完整工作台，品牌返回 Welcome 且最后一个 View 关闭后也回 Welcome", () => {
    expect(shellSource).toContain('<template #workbench="{ showWelcome }">');
    expect(shellSource).toContain('@click="showWelcome"');
    expect(shellSource).toContain(':color-scheme="pnwDisplayPreferences.colorScheme"');
    expect(shellSource).toContain('@update:color-scheme="updatePnwColorScheme"');
    expect(appShellSource).toMatch(/function stayInWorkbenchIdle\(\) \{\s*openWelcome\(\);/u);
    expect(appShellSource).toContain('wb.openTab({ pageId: "home" })');
  });

  it("主页消费 Wing 的普通 Home View 壳体与注册元数据", () => {
    expect(homeSource).toContain("PnwWorkbenchHome");
    expect(homeSource).toContain("pnwCreateWorkbenchHomeDefinition");
    expect(homeSource).toContain('viewId: "home"');
    expect(homeSource).toContain("<OnboardingChecklist />");
  });

  it("使用 Wing 内置工作空间类型的稳定顺序，并允许旧记录回退为 mixed", () => {
    expect(pnwNormalizeWorkspaceTypes().map((entry) => entry.typeId)).toEqual([
      "mixed",
      "code",
      "cad",
      "lighting",
    ]);
    expect(source).toContain(":model-value=\"entry.workspaceTypeId ?? 'mixed'\"");
  });

  it("required 强制无工作空间停留 Welcome，optional 才允许显式进入", () => {
    expect(pnwResolveWorkspaceGate({
      state: {},
      policy: "required",
      requestedMode: "workbench",
    })).toMatchObject({
      mode: "welcome",
      canEnterWorkbench: false,
      forcedWelcome: true,
    });
    expect(pnwResolveWorkspaceGate({
      state: {},
      policy: "optional",
      requestedMode: "workbench",
    })).toMatchObject({
      mode: "workbench",
      canEnterWorkbench: true,
      forcedWelcome: false,
    });
  });

  it("关闭和切换工作空间前等待会话落盘，空工作空间启动不恢复旧 View", () => {
    expect(appShellSource).toContain("async prepare()");
    expect(appShellSource).toContain("await flushWorkbenchSession()");
    expect(appShellSource).toContain(
      "const sessionRestored = workspacePath.value ? await restoreWorkbenchSession() : false",
    );
    expect(appShellSource).toMatch(/if \(!workspacePath\.value\) \{\s*wb\.discardAllToolTabs\(\);\s*openWelcome\(\);/u);
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
