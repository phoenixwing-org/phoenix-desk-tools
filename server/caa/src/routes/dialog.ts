import fs from "node:fs/promises";
import path from "node:path";
import {
  findRepoRoot,
  mergeDialogIr,
  PNX_BOM_ANALYSIS_DEMO,
  type CaaDialogIr,
} from "@phoenix/catdlg-core";
import { Hono } from "hono";
import { cors } from "hono/cors";

export const dialogRoutes = new Hono();

async function readUtf8(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function resolveUnderRoot(root: string, rel: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error("path escapes workspace root");
  }
  return full;
}

dialogRoutes.post("/parse", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    demo?: boolean;
    workspaceRoot?: string;
    catDlgRel?: string;
    catNlsRel?: string;
  };

  let catDlgPath: string;
  let catNlsPath: string | undefined;
  let sources: CaaDialogIr["sources"];

  if (body.demo) {
    const repo = findRepoRoot();
    if (!repo) {
      return c.json({ error: "无法定位仓库根（需要 phoenix/config/app_config.json）" }, 500);
    }
    catDlgPath = path.join(repo, PNX_BOM_ANALYSIS_DEMO.catDlg);
    catNlsPath = path.join(repo, PNX_BOM_ANALYSIS_DEMO.catNls);
    sources = {
      catDlg: PNX_BOM_ANALYSIS_DEMO.catDlg,
      catNls: PNX_BOM_ANALYSIS_DEMO.catNls,
    };
  } else {
    const root = body.workspaceRoot?.trim();
    const catDlgRel = body.catDlgRel?.trim();
    if (!root || !catDlgRel) {
      return c.json({ error: "workspaceRoot 与 catDlgRel 必填，或传 demo: true" }, 400);
    }
    catDlgPath = resolveUnderRoot(root, catDlgRel);
    sources = { catDlg: catDlgRel };
    if (body.catNlsRel?.trim()) {
      catNlsPath = resolveUnderRoot(root, body.catNlsRel.trim());
      sources.catNls = body.catNlsRel.trim();
    }
  }

  try {
    const catDlgText = await readUtf8(catDlgPath);
    const catNlsText = catNlsPath ? await readUtf8(catNlsPath) : undefined;
    const ir = mergeDialogIr({ catDlgText, catNlsText, sources });
    return c.json(ir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: msg }, 500);
  }
});

export function createCaaApp() {
  const app = new Hono();
  app.use("*", cors());
  app.get("/api/caa/health", (c) => c.json({ ok: true, service: "caa" }));
  app.route("/api/caa/dialog", dialogRoutes);
  return app;
}
