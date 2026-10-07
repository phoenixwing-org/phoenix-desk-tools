import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { cadRoutes } from "./cad.js";

describe("CAD native-only route invariant", () => {
  it("contains no Python API proxy or stub marker in the CAD route modules", () => {
    const cadSource = fs.readFileSync(path.resolve("src/routes/cad.ts"), "utf8");
    const serverSource = fs.readFileSync(path.resolve("src/server.ts"), "utf8");

    for (const marker of ["PYTHON_API", "proxyToPython", "_proxy", "_stub", "checkPythonSidecar"]) {
      expect(cadSource, `cad.ts must not contain ${marker}`).not.toContain(marker);
      expect(serverSource, `server.ts must not contain ${marker}`).not.toContain(marker);
    }
  });

  it("does not register invented legacy aliases that have canonical native APIs", async () => {
    for (const route of ["/scan/progress", "/scan/recent", "/worksets", "/bom/batch"]) {
      expect((await cadRoutes.request(route)).status, route).toBe(404);
    }
    expect((await cadRoutes.request("/fcstd-map/scan/start", { method: "POST" })).status).toBe(404);
  });

  it("reports only the active native CAD backend", async () => {
    // Never let a health test inspect the developer's currently selected CAD DB.
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "desk-health-test-"));
    try {
      const response = await cadRoutes.request(`/health?workspace=${encodeURIComponent(workspace)}`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload).toMatchObject({
        ok: true,
        module: "cad-native",
        native: { engine: "node-sqlite" },
      });
      expect(payload).not.toHaveProperty("python");
      expect(fs.readdirSync(workspace)).toEqual([]);
    } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
  });
});
