import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_COMPONENT_IDS } from "./pageRegistry";

describe("page registry", () => {
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
