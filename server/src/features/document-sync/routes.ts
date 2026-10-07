import { Hono } from "hono";
import { applyDocumentSync, documentSyncHistory, previewDocumentSync, resolveDocumentSync } from "./service.js";
export const documentSyncRoutes = new Hono();
documentSyncRoutes.get("/history", c => {
  try { return c.json(documentSyncHistory(c.req.query("workspace") || "")); }
  catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
});
for (const [endpoint, action] of Object.entries({ resolve: resolveDocumentSync, preview: previewDocumentSync, apply: applyDocumentSync })) {
  documentSyncRoutes.post(`/${endpoint}`, async c => {
    try { return c.json(await action(c.req.query("workspace") || "", await c.req.json())); }
    catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
  });
}
