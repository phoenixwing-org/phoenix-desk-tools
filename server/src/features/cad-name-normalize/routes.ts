import { Hono } from "hono";
import { analyzeNames, previewNames, renameNames, writeNames } from "./service.js";
import { getRenameJob, startRenameJob } from "./renameJobs.js";

export const nameNormalizeRoutes = new Hono();
for (const [endpoint, action] of Object.entries({ preview: previewNames, attributes: writeNames, analyze: analyzeNames, rename: renameNames, "rename-jobs": startRenameJob })) {
  nameNormalizeRoutes.post(`/${endpoint}`, async c => {
    try { return c.json(await action(c.req.query("workspace") || "", await c.req.json())); }
    catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
  });
}
nameNormalizeRoutes.get("/rename-jobs/:id", c => {
  try { return c.json(getRenameJob(c.req.query("workspace") || "", c.req.param("id"))); }
  catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
});
