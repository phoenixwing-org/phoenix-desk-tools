/**
 * CAA vitest 单元测试端点。
 * 从共享 SQLite 读取（Node 启动时已写入 vitest 模块）。
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { caaLog } from "../caaLog.js";
import { readModulesByBackend, upsertVitestModules } from "../testCatalog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

export const unitTestRoutes = new Hono();

export { upsertVitestModules } from "../testCatalog.js";

// ═══════════════════════════════════════════════
// 纯函数（可单测）
// ═══════════════════════════════════════════════

export interface VitestModule {
  file: string;
  count: number;
  tests: string[];
}

export function parseVitestList(output: string): VitestModule[] {
  const modules: VitestModule[] = [];
  let current = "";
  for (const line of output.split("\n")) {
    const m = line.match(/^(.+?\.test\.\w+) > (.+)/);
    if (!m) continue;
    if (m[1] !== current) {
      current = m[1];
      modules.push({ file: current, count: 0, tests: [] });
    }
    modules[modules.length - 1].count++;
    modules[modules.length - 1].tests.push(m[2]);
  }
  return modules;
}

export function parseVitestResult(output: string): { passed: number; failed: number } {
  return {
    passed: (output.match(/✓/g) || []).length,
    failed: (output.match(/✗/g) || []).length,
  };
}

/** 扫描 vitest + 写入共享 SQLite（启动时调用） */
export function refreshVitestCatalog() {
  const pkgs = ["packages/catdlg-core", "web-ui"];
  const allModules: VitestModule[] = [];
  for (const pkg of pkgs) {
    try {
      const out = execSync(`cd "${pkg}" && pnpm vitest list`, {
        cwd: REPO_ROOT, encoding: "utf8", timeout: 60_000, shell: true,
        env: { ...process.env, CI: "true" },
      });
      allModules.push(...parseVitestList(out));
    } catch (err: any) {
      caaLog(`vitest-catalog: ${pkg} 扫描失败 — ${err.message || err}`);
    }
  }
  upsertVitestModules(allModules);
  caaLog(`vitest-catalog: ${allModules.length} files → SQLite`);
}

// ═══════════════════════════════════════════════
// 端点
// ═══════════════════════════════════════════════

unitTestRoutes.get("/ping", (c) => c.json({ ok: true }));

/** 返回所有模块（含 python + vitest，如果有 python 数据的话） */
unitTestRoutes.get("/suites", (c) => {
  const rows = readModulesByBackend("vitest");
  const modules = rows.map((r) => ({
    file: r.module,
    count: r.case_count,
    tests: JSON.parse(r.cases_json || "[]"),
    backend: r.backend,
  }));
  return c.json({ modules });
});

unitTestRoutes.post("/refresh", (c) => {
  refreshVitestCatalog();
  return c.json({ ok: true });
});

unitTestRoutes.post("/run", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { modules?: string[] };
  const mods = body.modules ?? [];
  caaLog(`unit-tests/run: ${mods.length} modules`);
  try {
    let allOut = "";
    for (const pkg of ["packages/catdlg-core", "web-ui"]) {
      const pkgMods = mods.filter((m) => m.startsWith(pkg));
      const args = pkgMods.length > 0 ? pkgMods.join(" ") : "";
      const out = execSync(`cd "${pkg}" && pnpm vitest run --reporter verbose ${args}`, {
        cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000, shell: true,
        env: { ...process.env, CI: "true" },
      });
      allOut += out + "\n";
    }
    const { passed, failed } = parseVitestResult(allOut);
    caaLog(`unit-tests/run: ${passed} passed ${failed} failed`);
    return c.json({ ok: failed === 0, passed, failed, output: allOut.slice(-2000) });
  } catch (err: any) {
    const out = err.stdout || err.message || "";
    const { passed, failed } = parseVitestResult(out);
    return c.json({ ok: false, passed, failed, output: out.slice(-2000) });
  }
});
