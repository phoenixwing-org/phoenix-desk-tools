import {previewTitleblock, applyTitleblock} from './sync.js';
import { drawingDefaults, saveDrawingDefaults, startDrawing, drawingJob } from "./jobs.js";
import { Hono } from "hono";
import { inspectDrawing } from "./service.js";
export const drawingResearchRoutes = new Hono();
drawingResearchRoutes.onError((error, c) => c.json({ detail: error.message }, 400));
drawingResearchRoutes.get("/inspect", async c => c.json(await inspectDrawing(c.req.query("workspace") || "", c.req.query("rel") || "", c.req.query("template_root") || "")));

// Explicit generation and settings writes; inspection remains read-only.
drawingResearchRoutes.get("/defaults", c => c.json(drawingDefaults(c.req.query("workspace") || "")));
drawingResearchRoutes.put("/defaults", async c => { const b = await c.req.json(); return c.json(saveDrawingDefaults(b.workspace, b.scope, b.defaults)); });
drawingResearchRoutes.post("/jobs", async c => c.json(startDrawing(await c.req.json()), 202));
drawingResearchRoutes.get("/jobs/:id", c => c.json(drawingJob(c.req.query("workspace") || "", c.req.param("id"))));

drawingResearchRoutes.post("/titleblock/preview", async c => {const b=await c.req.json();return c.json(await previewTitleblock(b.workspace,b.rel));});
drawingResearchRoutes.post("/titleblock/apply", async c => {const b=await c.req.json();return c.json(await applyTitleblock(b.workspace,b.rel,b.id));});
