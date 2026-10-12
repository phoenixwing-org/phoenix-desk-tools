import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { CadObjectInfoBudget, type CadObjectInfoBudgetOptions } from "../cad-object-info/budget.js";
import { readCadObjectInfoRequest } from "../cad-object-info/request.js";
import { CadObjectInfoError } from "../cad-object-info/error.js";
import { cadLightInfoFailure, readCadLightInfo } from "./service.js";

/** Request/deadline/output/HTTP-disconnect primitives are shared with full read.
 * Limits, hooks and projection choices are server-owned, never JSON options. */
export function createCadLightInfoRoutes(options?: CadObjectInfoBudgetOptions, read = readCadLightInfo) {
  const routes = new Hono<{ Bindings: Partial<HttpBindings> }>();
  routes.post("/", async c => {
    try {
      const budget = new CadObjectInfoBudget(c.req.raw.signal, options); budget.check();
      const body = await readCadObjectInfoRequest(c.req.raw, budget); budget.check();
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2
        || !("workspacePath" in body) || !("filePath" in body) || typeof body.workspacePath !== "string" || typeof body.filePath !== "string") {
        throw new CadObjectInfoError("invalid_arguments", "轻量读取只接受工作空间和 FCStd 文件路径");
      }
      const data = await read(body.workspacePath, body.filePath, c.req.raw.signal, budget); budget.check();
      const response = c.json({ success: true, data }); budget.check(); return response;
    } catch (error) {
      if (c.req.raw.signal.aborted && c.env?.outgoing?.destroyed === true) return RESPONSE_ALREADY_SENT.clone();
      const primary = cadLightInfoFailure(error);
      const code = primary?.code || "invalid_arguments";
      const message = primary ? primary.message.replaceAll("对象信息", "轻量读取") : "轻量读取请求无效";
      return c.json({ success: false, code, error: message, detail: message }, code === "resource_limit" ? 413 : code === "timeout" ? 408 : 400);
    }
  });
  return routes;
}
export const cadLightInfoRoutes = createCadLightInfoRoutes();
