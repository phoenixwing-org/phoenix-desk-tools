import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { zipSync, strToU8 } from "fflate";
import { cadRoutes } from "./cad.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Mounted CAD light-info route", () => {
  it("reads a synthetic summary without initializing a workspace database", async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "desk-light-mounted-")));
    roots.push(root);
    const bytes = zipSync({ "Document.xml": strToU8('<Document><Objects><Object name="Body" type="PartDesign::Body"/></Objects><ObjectData><Object name="Body"><Properties><Property name="PartName" type="App::PropertyString"><String value="Synthetic panel"/></Property></Properties></Object></ObjectData></Document>') });
    fs.writeFileSync(path.join(root, "Panel.FCStd"), bytes);
    const app = new Hono(); app.route("/api/cad", cadRoutes);
    const response = await app.request("/api/cad/light-info", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspacePath: root, filePath: "Panel.FCStd" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { analysis: {
      objectCount: 1, embeddedFields: { PartName: "Synthetic panel" }, xlinks: [],
    } } });
    expect(fs.readFileSync(path.join(root, "Panel.FCStd"))).toEqual(Buffer.from(bytes));
    expect(fs.readdirSync(root)).toEqual(["Panel.FCStd"]);
  });

  it("rejects a client-supplied budget on the mounted endpoint", async () => {
    const app = new Hono(); app.route("/api/cad", cadRoutes);
    const response = await app.request("/api/cad/light-info", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspacePath: "not-opened", filePath: "Panel.FCStd", xmlBytes: 64 * 1024 * 1024 }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, code: "invalid_arguments" });
  });
});
