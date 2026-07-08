import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCaaApp } from "./routes/dialog.js";
import { unitTestRoutes, refreshVitestCatalog } from "./routes/unit-tests.js";
import { cadRoutes } from "./routes/cad.js";
import { cadScanRoutes } from "./routes/cad-scan.js";
import { shellRoutes } from "./routes/shell.js";
import { checkPythonSidecar } from "./lib/pnwPythonSidecar.js";

const port = Number(process.env.CAA_SERVER_PORT || 5180);

const app = createCaaApp();
app.route("/api/caa/unit-tests", unitTestRoutes);
app.route("/api/cad", cadScanRoutes);
app.route("/api/cad", cadRoutes);
app.route("/", shellRoutes);  // 全路径路由（/api/config/app 等）

// 未迁移路由 — 返回明确提示
app.all("/api/*", (c) => {
  return c.json({
    error: "此功能暂未迁移到 Node.js",
    hint: "Python 后端已关闭。该 API 待迁移到 cad-rust。",
    path: c.req.path,
  }, 503);
});

// 启动检查
refreshVitestCatalog();
checkPythonSidecar().then((s) => {
  if (s.available) console.log(`[server] Python sidecar OK: ${s.path} (${s.version})`);
});

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Phoenix server http://127.0.0.1:${info.port}`);
  console.log(`  /api/caa/*  CAA 对话`);
  console.log(`  /api/cad/*  cad-rust`);
});
