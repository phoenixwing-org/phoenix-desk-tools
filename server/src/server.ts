import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCaaApp } from "./routes/dialog.js";
import { unitTestRoutes, refreshVitestCatalog } from "./routes/unit-tests.js";

const port = Number(process.env.CAA_SERVER_PORT || 5180);

const app = createCaaApp();
app.route("/api/caa/unit-tests", unitTestRoutes);

// 启动时扫描 vitest 用例写入 catalog
refreshVitestCatalog();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CAA server http://127.0.0.1:${info.port}`);
});
