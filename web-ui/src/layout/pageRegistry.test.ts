import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_COMPONENT_IDS, PAGE_CONTRIBUTIONS } from "./pageRegistry";
import { RIBBON_PAGE_ICONS, ribbonIconFor } from "./ribbon/ribbonIcons";
import { Coin, Upload } from "@element-plus/icons-vue";
import { pnwResolveIcon } from "phoenix-wing";
import { PAGE_HELP } from "../content/pageHelp";

describe("page registry", () => {
  it("registers one standalone recovery view with a real database icon, generic Primary and safe offline help", () => {
    expect(PAGE_COMPONENT_IDS.has("workspace_recovery")).toBe(true);
    expect(PAGE_CONTRIBUTIONS.workspace_recovery?.sideBlock).toBe(PAGE_CONTRIBUTIONS.cad_index?.sideBlock);
    expect(PAGE_CONTRIBUTIONS.workspace_recovery?.sideBlockLabel).toBe("备份与恢复 Primary");
    expect(PAGE_CONTRIBUTIONS.workspace_recovery?.view).not.toBe(PAGE_CONTRIBUTIONS.bom_delivery?.view);
    expect(RIBBON_PAGE_ICONS.workspace_recovery).toBe(Coin);
    expect(ribbonIconFor("workspace_recovery")).toBe(Coin);
    expect(pnwResolveIcon(ribbonIconFor("workspace_recovery"))).toMatchObject({ kind: "component", component: Coin, fallback: false });
    expect(PAGE_HELP.workspace_recovery?.title).toBe("备份与恢复");
    const help = PAGE_HELP.workspace_recovery?.bullets.join("\n") ?? "";
    for (const text of ["不自动备份", "不存在的新隔离目录", "不会覆盖", "不是来源签名", "结果未确认"]) expect(help).toContain(text);
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../phoenix/config/app_config.json"), "utf8"));
    expect(config.workbench.pages.workspace_recovery).toEqual({ max_tabs: 1 });
    const entries = config.navigation.filter((entry: { page: string }) => entry.page === "workspace_recovery");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "workspace_recovery", label: "备份与恢复", module: "cad", ribbonGroup: "索引" });
    const source = fs.readFileSync(new URL("./pageRegistry.ts", import.meta.url), "utf8");
    expect(source).toContain('import("../features/workspace-recovery/WorkspaceRecoveryPage.vue")');
  });
  it("registers the standalone CAD delivery view, explicit icon and offline help", () => {
    expect(PAGE_COMPONENT_IDS.has("bom_delivery")).toBe(true);
    expect(RIBBON_PAGE_ICONS.bom_delivery).toBe(Upload);
    expect(ribbonIconFor("bom_delivery")).toBe(Upload);
    expect(PAGE_HELP.bom_delivery?.bullets.join("\n")).toContain("不自动联网");
    const config = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../phoenix/config/app_config.json"), "utf8"));
    expect(config.workbench.pages.bom_delivery).toEqual({ max_tabs: 1 });
  });
  it("owns every configured navigation and workbench page", () => {
    const configPath = path.resolve(process.cwd(), "../phoenix/config/app_config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const configured = new Set<string>([
      ...(config.navigation || []).map((item: any) => String(item.page || item.id || "")),
      ...Object.keys(config.workbench?.pages || {}),
    ]);
    configured.delete("welcome");

    const missing = [...configured].filter((pageId) => !PAGE_COMPONENT_IDS.has(pageId)).sort();
    expect(missing).toEqual([]);
  });

  it("keeps navigation ids and page ids unambiguous", () => {
    const configPath = path.resolve(process.cwd(), "../phoenix/config/app_config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const ids = (config.navigation || []).map((item: any) => String(item.id || ""));
    const pages = (config.navigation || []).map((item: any) => String(item.page || item.id || ""));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(pages).size).toBe(pages.length);
  });
});
