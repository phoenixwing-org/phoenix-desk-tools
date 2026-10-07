import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { it, expect } from "vitest";
import { cadRoutes } from "./cad.js";

it("analyzes/repairs an explicit workspace and rejects unplanned writes through Hono", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cad-errors-route-"));
  const req = (action: string, body: unknown) => cadRoutes.request(`/error-fix/properties/${action}?workspace=${encodeURIComponent(root)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    fs.writeFileSync(path.join(root, "part.FCStd"), zipSync({ "Document.xml": strToU8('<Document><ObjectData><Object name="Body"><Properties Count="1"/></Object></ObjectData></Document>') }));
    expect((await req("apply", { plan_id: "unknown", files: ["part.FCStd"] })).status).toBe(400);
    const response = await req("analyze", { batch_dir: "." }); expect(response.status).toBe(200);
    const plan = await response.json(); expect(plan.files).toHaveLength(1);
    const result = await req("apply", { plan_id: plan.plan_id, files: ["part.FCStd"] });
    expect(result.status).toBe(200); expect((await result.json()).results[0].status).toBe("fixed");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
