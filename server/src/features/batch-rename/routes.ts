import { Hono } from "hono";
import { listRenameTasks, saveRenameTask } from "./tasks.js";
import { applyRenameTask, previewRenameTask } from "./service.js";
export const renameTaskRoutes = new Hono();
renameTaskRoutes.get("/tasks", c => {
  try { return c.json({ tasks: listRenameTasks(c.req.query("workspace") || "") }); }
  catch (error) { return c.json({ detail: String(error) }, 400); }
});
for (const [endpoint, action] of Object.entries({ save: saveRenameTask, preview: previewRenameTask, apply: applyRenameTask })) {
  renameTaskRoutes.post(`/${endpoint}`, async c => {
    try {
      const body = await c.req.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("无效的请求");
      if (endpoint !== "save" && (!Number.isSafeInteger(body.revision) || body.revision <= 0 || typeof body.task_id !== "string")) throw new Error("任务标识或版本无效");
      return c.json(await action(c.req.query("workspace") || "", body));
    } catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
  });
}
