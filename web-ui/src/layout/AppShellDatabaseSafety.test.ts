import { readFileSync } from "node:fs";
import { parse } from "vue/compiler-sfc";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppShell.vue", import.meta.url), "utf8");
const { descriptor, errors } = parse(source);

describe("AppShell database compatibility safety", () => {
  it("keeps the compatibility banner read-only with no destructive API or browser confirmation", () => {
    expect(errors).toEqual([]);
    const script = descriptor.scriptSetup?.content ?? "";
    expect(script).toContain('import { fetchPhoenixDatabaseStatus } from "../api";');
    expect(script).toContain("await fetchPhoenixDatabaseStatus()");
    expect(script).not.toMatch(/recreatePhoenixDatabase|confirmRecreateLegacyDatabase|window\.confirm|window\.location\.reload/u);
    expect(script).not.toContain("legacyDbRecreating");
  });

  it("renders only a disabled rebuild affordance without an action handler", () => {
    const template = descriptor.template?.content ?? "";
    const button = template.match(/<button\b[^>]*class="legacy-db-action"[^>]*>[\s\S]*?<\/button>/u)?.[0];
    expect(button).toBeDefined();
    expect(button).toMatch(/\sdisabled\s/u);
    expect(button).toContain("原位重建已禁用");
    expect(button).not.toMatch(/@|v-on|:disabled/u);
    expect(template).toContain("工作空间数据库兼容需核对");
    expect(template).toContain("原数据保持不变。先备份并在新目录恢复验证；当前禁止原位重建。");
    expect(template).not.toContain("重建后才能继续使用");
  });

  it("retains reasons and displays a status-read failure even without a legacy flag", () => {
    const template = descriptor.template?.content ?? "";
    expect(template).toContain('v-if="legacyDbBanner || legacyDbError"');
    expect(template).toContain('v-if="legacyDbReasons.length"');
    expect(template).toContain('legacyDbReasons.join(" · ")');
    expect(template).toContain('v-if="legacyDbError"');
    expect(template).toContain("{{ legacyDbError }}");
    expect(descriptor.scriptSetup?.content).toContain("legacyDbError.value = String(e)");
  });

  it("offers only a normal authorized navigation to recovery without running recovery actions", () => {
    const template = descriptor.template?.content ?? "";
    const button = template.match(/<button\b[^>]*class="legacy-db-recovery-action"[^>]*>[\s\S]*?<\/button>/u)?.[0];
    expect(button).toBeDefined();
    expect(button).toContain("打开备份与恢复");
    expect(button).toContain('@click="onPnwActivate(\'workspace_recovery\')"');
    const script = descriptor.scriptSetup?.content ?? "";
    expect(script).toContain("if (!navigation.value.some((item) => item.page === pageId)) return;");
    expect(script).toContain("shell.goToPage(pageId);");
    expect(script).not.toMatch(/workspace-recovery\/(?:backup|inspect|restore)|createWorkspaceRecoveryBackup|restoreWorkspaceRecoveryBackup/u);
  });
});
