import { Hono } from "hono";
import { cors } from "hono/cors";
import { createCaaApp } from "./routes/dialog.js";
import { unitTestRoutes } from "./routes/unit-tests.js";
import { cadRoutes } from "./routes/cad.js";
import { shellRoutes } from "./routes/shell.js";
import { documentSyncRoutes } from "./features/document-sync/routes.js";
import { drawingResearchRoutes } from "./features/drawing-research/routes.js";
import { renameTaskRoutes } from "./features/batch-rename/routes.js";
import { isAllowedPhoenixUiOrigin } from "./lib/localApiOrigin.js";

export function createPhoenixServerApp(): Hono {
  const app = new Hono();

  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("Origin") || "";
    if (origin && !isAllowedPhoenixUiOrigin(origin)) {
      return c.json({ detail: "Origin is not allowed for the local Phoenix API" }, 403);
    }
    await next();
  });
  app.use("/api/*", cors({
    origin: (origin) => isAllowedPhoenixUiOrigin(origin) ? origin : null,
    allowHeaders: ["Content-Type"],
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
    maxAge: 600,
  }));

  app.route("/", createCaaApp());
  app.route("/api/caa/unit-tests", unitTestRoutes);
  app.route("/api/cad", cadRoutes);
  app.route("/api/document-sync", documentSyncRoutes);
  app.route("/api/rename-tasks", renameTaskRoutes);
  app.route("/api/drawing-research", drawingResearchRoutes);
  app.route("/", shellRoutes);

  app.all("/api/*", (c) => c.json({
    error: "未找到 API 路由",
    hint: "请检查请求路径与当前 Phoenix Node 服务版本。",
    path: c.req.path,
  }, 404));

  return app;
}
