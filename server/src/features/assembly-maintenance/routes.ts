import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { CadObjectInfoBudget, type CadObjectInfoBudgetOptions } from "../cad-object-info/budget.js";
import { CadObjectInfoError } from "../cad-object-info/error.js";
import { readCadObjectInfoRequest } from "../cad-object-info/request.js";
import { ASSEMBLY_INSPECTION_RESPONSE_BYTES, inspectSavedAssembly } from "./service.js";
import { assemblyUpdateService } from "./runtime.js";
import type { AssemblyUpdateService } from "./updates.js";
import { isFcstdObjectName } from "../../lib/fcstdLinkIdentity.js";

const messages: Record<string, string> = {
  invalid_arguments: "装配检查只接受工作空间和 FCStd 文件路径，不能提交写入参数",
  path_escape: "文件必须位于工作空间内，且不能经过符号链接",
  io_error: "工作空间或总成文件不可读", not_assembly: "当前保存文件未包含可识别的原生装配对象",
  source_changed: "模型在检查期间已变化，请重新检查", cancelled: "装配检查已取消",
  resource_limit: "装配检查超过安全上限（请求 64 KiB、响应 1 MiB）", timeout: "装配检查超时，请缩小文件后重试",
  invalid_fcstd_archive: "FCStd 压缩包损坏或格式无效", missing_document_xml: "FCStd 缺少 Document.xml",
  invalid_document_xml: "Document.xml 不完整或格式无效", invalid_numeric_value: "保存属性含有无效数值，未使用默认值替代",
};
const requestPath = (value: unknown): value is string => typeof value === "string" && !!value.trim()
  && value.length <= 4096 && !/[\x00-\x1f]/.test(value);
/** Internal budget/reader seams cannot be configured by request data. */
export function createAssemblyMaintenanceRoutes(options?: CadObjectInfoBudgetOptions, read = inspectSavedAssembly, updates: AssemblyUpdateService = assemblyUpdateService) {
  const routes = new Hono<{ Bindings: Partial<HttpBindings> }>();
  routes.post("/inspect", async c => {
    try {
      const budget = new CadObjectInfoBudget(c.req.raw.signal, { ...options, bytes: Math.min(options?.bytes ?? ASSEMBLY_INSPECTION_RESPONSE_BYTES, ASSEMBLY_INSPECTION_RESPONSE_BYTES) });
      const body = await readCadObjectInfoRequest(c.req.raw, budget); budget.check();
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 2 || !("workspacePath" in body) || !("filePath" in body)
        || typeof body.workspacePath !== "string" || typeof body.filePath !== "string") {
        throw new CadObjectInfoError("invalid_arguments", messages.invalid_arguments);
      }
      const data = await read(body.workspacePath, body.filePath, c.req.raw.signal, budget); budget.check();
      const response = c.json({ success: true, data }); budget.check(); return response;
    } catch (error) {
      if (c.req.raw.signal.aborted && c.env?.outgoing?.destroyed === true) return RESPONSE_ALREADY_SENT.clone();
      const known = error instanceof CadObjectInfoError && Object.hasOwn(messages, error.code);
      const code = known ? error.code : "invalid_arguments", message = messages[code];
      return c.json({ success: false, code, error: message, detail: message }, code === "resource_limit" ? 413 : code === "timeout" ? 408 : 400);
    }
  });
  const updateCommands = ["start", "status", "cancel", "publish", "reconcile", "history"] as const;
  for (const command of updateCommands) routes.post(`/update/${command}`, async c => {
    try {
      const budget = new CadObjectInfoBudget(c.req.raw.signal, { ...options, bytes: Math.min(options?.bytes ?? ASSEMBLY_INSPECTION_RESPONSE_BYTES, ASSEMBLY_INSPECTION_RESPONSE_BYTES) });
      const parsed = await readCadObjectInfoRequest(c.req.raw, budget); budget.check();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("arguments");
      const body = parsed as Record<string, unknown>;
      const fields = command === "start" ? ["workspacePath", "filePath", "selectedObjects"]
        : command === "publish" ? ["workspacePath", "id", "mode", "confirmedClosed", "confirmedNotReopened"]
          : command === "history" ? ["workspacePath", ...(Object.hasOwn(body, "limit") ? ["limit"] : [])] : ["workspacePath", "id"];
      if (Object.keys(body).sort().join(",") !== fields.sort().join(",") || !requestPath(body.workspacePath)
        || (command !== "start" && command !== "history" && (typeof body.id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.id)))) throw new Error("arguments");
      let data: unknown;
      if (command === "start") {
        if (!requestPath(body.filePath) || !/\.fcstd$/i.test(body.filePath) || !Array.isArray(body.selectedObjects)
          || !body.selectedObjects.length || body.selectedObjects.length > 50 || new Set(body.selectedObjects).size !== body.selectedObjects.length
          || body.selectedObjects.some(name => typeof name !== "string" || !isFcstdObjectName(name))) throw new Error("arguments");
        data = updates.start(body.workspacePath, body.filePath, body.selectedObjects);
      } else if (command === "status") data = updates.get(body.workspacePath, String(body.id));
      else if (command === "cancel") data = updates.cancel(body.workspacePath, String(body.id));
      else if (command === "publish") {
        if ((body.mode !== "verified_copy" && body.mode !== "replace_source") || typeof body.confirmedClosed !== "boolean" || typeof body.confirmedNotReopened !== "boolean"
          || (body.mode === "replace_source" && (!body.confirmedClosed || !body.confirmedNotReopened))) throw new Error("arguments");
        data = await updates.publish(body.workspacePath, String(body.id), body.mode, { closed: body.confirmedClosed, notReopened: body.confirmedNotReopened });
      } else if (command === "reconcile") data = updates.reconcile(body.workspacePath, String(body.id));
      else {
        if (body.limit !== undefined && (typeof body.limit !== "number" || !Number.isSafeInteger(body.limit) || body.limit < 1 || body.limit > 50)) throw new Error("arguments");
        data = updates.history(body.workspacePath, body.limit as number | undefined);
      }
      // The background preview owns its cancellation. A disconnected status or
      // publish response cannot authorize a retry or signal another Native job.
      const encoded = JSON.stringify({ success: true, data });
      if (Buffer.byteLength(encoded) > ASSEMBLY_INSPECTION_RESPONSE_BYTES) throw new CadObjectInfoError("resource_limit", "response");
      return c.json({ success: true, data }, command === "start" ? 202 : 200);
    } catch (error) {
      if (c.req.raw.signal.aborted && c.env?.outgoing?.destroyed === true) return RESPONSE_ALREADY_SENT.clone();
      const tooLarge = error instanceof CadObjectInfoError && error.code === "resource_limit";
      const message = tooLarge ? command === "publish" ? "装配更新请求或响应超过安全上限；请先核对发布记录，不要重复写入" : "装配更新请求或响应超过安全上限" : command === "publish"
        ? "未取得可确认的发布响应，请先核对更新记录，不要重复写入"
        : command === "status" ? "当前服务会话中没有该预览，请核对本地历史记录；不会恢复写入权限"
          : "装配更新请求无效或未满足安全条件，请重新检查文件和明确选择；原件不会因查询而改写";
      return c.json({ success: false, code: tooLarge ? "resource_limit" : "assembly_update_request_failed", error: message, detail: message }, tooLarge ? 413 : 400);
    }
  });
  return routes;
}
export const assemblyMaintenanceRoutes = createAssemblyMaintenanceRoutes();
