import {randomUUID} from 'node:crypto';
import {planMaintenance,applyMaintenance,type MaintenancePlan} from './maintenance.js';
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

// Preview owns the exact inputs; apply cannot silently widen or change the plan.
const maintenanceTickets=new Map<string,{plan:MaintenancePlan;created:number}>();
drawingResearchRoutes.post('/maintenance/preview',async c=>{
 const b=await c.req.json();const plan=planMaintenance({workspace:b.workspace,rel:b.rel,destination:b.destination});
 for(const [id,ticket] of maintenanceTickets)if(Date.now()-ticket.created>1800000)maintenanceTickets.delete(id);
 if(maintenanceTickets.size>=100)maintenanceTickets.delete(maintenanceTickets.keys().next().value!);
 const id=randomUUID();maintenanceTickets.set(id,{plan,created:Date.now()});
 return c.json({id,outputs:plan.outputs,material:plan.input.material||'',dependencies:Object.keys(plan.fingerprints).length});
});
drawingResearchRoutes.post('/maintenance/apply',async c=>{
 const b=await c.req.json();const ticket=maintenanceTickets.get(b.id);
 if(!ticket||ticket.plan.input.workspace!==b.workspace||ticket.plan.input.rel!==b.rel||Date.now()-ticket.created>1800000)throw new Error('整理预览已失效，请重新预览');
 maintenanceTickets.delete(b.id);return c.json(await applyMaintenance(ticket.plan));
});
