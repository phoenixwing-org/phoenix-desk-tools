import { Hono } from "hono";
import { getAssemblyLabelJob, previewAssemblyLabels, startAssemblyLabelJob } from "./service.js";
export const assemblyLabelRoutes = new Hono();
assemblyLabelRoutes.post("/preview", async c => {
  try { return c.json(await previewAssemblyLabels(c.req.query("workspace") || "", await c.req.json())); }
  catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
});
assemblyLabelRoutes.post("/jobs", async c => {
  try { return c.json(startAssemblyLabelJob(c.req.query("workspace") || "", await c.req.json())); }
  catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 400); }
});
assemblyLabelRoutes.get("/jobs/:id", c => {
  try { return c.json(getAssemblyLabelJob(c.req.query("workspace") || "", c.req.param("id"))); }
  catch (error) { return c.json({ detail: error instanceof Error ? error.message : String(error) }, 404); }
});
