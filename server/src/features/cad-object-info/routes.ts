import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { CadObjectInfoError } from "./document.js";
import { readCadObjectInfo } from "./service.js";
import { CadObjectInfoBudget, type CadObjectInfoBudgetOptions } from "./budget.js";
import { readCadObjectInfoRequest } from "./request.js";

/** Budget and reader injection are internal test seams, never request-configurable. */
export function createCadObjectInfoRoutes(options?: CadObjectInfoBudgetOptions, read = readCadObjectInfo) {
  const routes = new Hono<{ Bindings: Partial<HttpBindings> }>();
  routes.post("/", async c => {
    try {
      const budget = new CadObjectInfoBudget(c.req.raw.signal, options);
      budget.check();
      const body = await readCadObjectInfoRequest(c.req.raw, budget);
      budget.check();
      if (!body || typeof body !== "object" || !("workspacePath" in body) || !("filePath" in body)
        || typeof body.workspacePath !== "string" || typeof body.filePath !== "string") {
        throw new CadObjectInfoError("invalid_arguments", "请选择工作空间和 FCStd 文件");
      }
      const data = await read(body.workspacePath, body.filePath, c.req.raw.signal, budget);
      budget.check();
      const response = c.json({ success: true, data });
      budget.check();
      return response;
    } catch (error) {
      // The Node adapter aborts Request.signal on a premature response close.
      // Do not serialize or attempt to send an error to an already-gone socket.
      // In-memory requests (no Node bindings) retain the normal cancelled JSON.
      if (c.req.raw.signal.aborted && c.env?.outgoing?.destroyed === true) return RESPONSE_ALREADY_SENT.clone();
      const code = error instanceof CadObjectInfoError ? error.code : "invalid_arguments";
      const message = error instanceof CadObjectInfoError ? error.message : "对象信息请求无效";
      return c.json({ success: false, code, error: message, detail: message }, code === "resource_limit" ? 413 : code === "timeout" ? 408 : 400);
    }
  });
  return routes;
}
export const cadObjectInfoRoutes = createCadObjectInfoRoutes();
