import { Hono } from "hono";
import { archiveGallery, printGallery } from "./archive.js";
import { cancelGalleryJob, galleryJob, galleryOptions, loadGallery, startGalleryJob, thumbnailBytes } from "./service.js";
import { geometryJob, startGeometryJob } from "./geometryService.js";

export const partGalleryRoutes = new Hono();
partGalleryRoutes.onError((error, c) => c.json({ detail: error.message.replaceAll(c.req.query("workspace") || "\0", "[工作空间]") }, 400));
partGalleryRoutes.get("/options", c => c.json(galleryOptions(c.req.query("workspace") || "")));
partGalleryRoutes.get("/catalog", c => c.json(loadGallery(c.req.query("workspace") || "", c.req.query("product") || "")));
partGalleryRoutes.get("/thumbnail", c => {
  const bytes = thumbnailBytes(c.req.query("workspace") || "", c.req.query("rel") || "");
  c.header("Content-Type", "image/png"); c.header("X-Content-Type-Options", "nosniff"); c.header("Cache-Control", "no-store");
  return c.body(new Uint8Array(bytes));
});
partGalleryRoutes.post("/jobs", async c => {
  const body = await c.req.json();
  if (typeof body.product !== "string") throw new Error("请选择产品或全库");
  return c.json(startGalleryJob(c.req.query("workspace") || "", body.product));
});
partGalleryRoutes.post("/geometry-jobs", async c => {
  const body = await c.req.json();
  if (typeof body.product !== "string") throw new Error("请选择产品或全库");
  return c.json(startGeometryJob(c.req.query("workspace") || "", body.product));
});
partGalleryRoutes.get("/jobs/:id", c => {
  // Both explicit operations use the existing job polling contract.
  const workspace = c.req.query("workspace") || "", id = c.req.param("id");
  return c.json(geometryJob(workspace, id) || galleryJob(workspace, id));
});
partGalleryRoutes.post("/jobs/:id/cancel", c => c.json(cancelGalleryJob(c.req.query("workspace") || "", c.req.param("id"))));
partGalleryRoutes.post("/document", async c => c.json(printGallery(c.req.query("workspace") || "", await c.req.json())));
partGalleryRoutes.post("/archive", async c => c.json(archiveGallery(c.req.query("workspace") || "", await c.req.json())));
