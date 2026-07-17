import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  KtCodegenController,
  KtCodegenItem,
  KtCodegenParam,
} from "@phoenix-wing/kt-codegen";

const tempRoots: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

function makeTempRoot(name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
  tempRoots.push(root);
  return root;
}

async function importShellRoutes(home: string, workspace: string) {
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  const prefsDir = path.join(home, ".phoenix");
  fs.mkdirSync(prefsDir, { recursive: true });
  fs.writeFileSync(
    path.join(prefsDir, "launcher-prefs.json"),
    JSON.stringify({ recent_workspaces: [workspace], freecad_dir: "", workspace }, null, 2),
    "utf8",
  );
  vi.resetModules();
  return import("./shell.js");
}

function writeCodegenConfig(workspace: string): void {
  const controller = new KtCodegenController({
    param: new KtCodegenParam({
      namePrefix: "Kt",
      nameMiddle: "Route",
      items: [new KtCodegenItem({
        nameSuffix: "Base",
        id: 1,
        name: "Value",
        paramString: "value",
        dataType: "int",
        defaultValue: "1",
      })],
    }),
  });
  const result = controller.writeJson();
  if (!result.ok || result.value === null) throw new Error("fixture generation failed");
  fs.writeFileSync(path.join(workspace, "route.codegen.json"), result.value, "utf8");
  fs.writeFileSync(path.join(workspace, "Route.h"), [
    "// START KEVIN CAA WIZARD SECTION KtRouteBase PARAM DECLARATION",
    "int oldValue;",
    "// END KEVIN CAA WIZARD SECTION KtRouteBase PARAM DECLARATION",
    "",
  ].join("\n"), "utf8");
}

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.resetModules();
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("shell KT Codegen routes", () => {
  it("discovers, opens, preflights, saves, applies source, and rejects stale writes", async () => {
    const home = makeTempRoot("shell-codegen-home-");
    const workspace = makeTempRoot("shell-codegen-ws-");
    writeCodegenConfig(workspace);
    const { shellRoutes } = await importShellRoutes(home, workspace);

    const oversizedResponse = await shellRoutes.request("/api/code/codegen/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(16 * 1024 * 1024 + 1),
      },
      body: "{}",
    });
    expect(oversizedResponse.status).toBe(413);
    await expect(oversizedResponse.json()).resolves.toMatchObject({ detail: expect.stringMatching(/16 MiB/) });

    const documentsResponse = await shellRoutes.request("/api/code/codegen/documents");
    expect(documentsResponse.status).toBe(200);
    const documents = await documentsResponse.json();
    expect(documents.documents).toHaveLength(1);

    const openResponse = await shellRoutes.request("/api/code/codegen/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "route.codegen.json" }),
    });
    expect(openResponse.status).toBe(200);
    const opened = await openResponse.json();

    const stateResponse = await shellRoutes.request("/api/code/codegen/document-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: opened.path,
        expected_file_signature: opened.file_signature,
        expected_fingerprint: opened.fingerprint,
      }),
    });
    expect(stateResponse.status).toBe(200);
    await expect(stateResponse.json()).resolves.toMatchObject({ exists: true, changed: false });

    const preflightResponse = await shellRoutes.request("/api/code/codegen/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        param: opened.param,
        table: opened.table,
        block_keys: ["PARAM DECLARATION"],
      }),
    });
    expect(preflightResponse.status).toBe(200);
    const preflight = await preflightResponse.json();
    expect(preflight.plan).toMatchObject({ canApply: true, hasChanges: true });
    expect(preflight.safe_to_apply).toBe(true);
    expect(preflight.reused).toBe(false);
    expect(preflight.source_scan_truncated).toBe(false);
    expect(preflight.source_candidates).toEqual([expect.objectContaining({
      path: "Route.h",
      marker_line: 0,
    })]);

    const region = preflight.plan.markerRegions[0];
    const previewResponse = await shellRoutes.request("/api/code/codegen/source-preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: region.path,
        start_line: region.start.line,
        end_line: region.end.line,
        expected_fingerprint: region.sourceFingerprint,
      }),
    });
    expect(previewResponse.status).toBe(200);
    const sourcePreview = await previewResponse.json();
    expect(sourcePreview).toMatchObject({ stale: false, path: "Route.h" });

    const sourceStatesResponse = await shellRoutes.request("/api/code/codegen/source-states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: [{
          path: sourcePreview.path,
          expected_file_signature: sourcePreview.file_signature,
          expected_fingerprint: sourcePreview.fingerprint,
        }],
      }),
    });
    expect(sourceStatesResponse.status).toBe(200);
    await expect(sourceStatesResponse.json()).resolves.toMatchObject({ changed_count: 0 });

    const invalidSourceStatesResponse = await shellRoutes.request("/api/code/codegen/source-states", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(invalidSourceStatesResponse.status).toBe(400);

    const applyResponse = await shellRoutes.request("/api/code/codegen/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        param: opened.param,
        table: opened.table,
        block_keys: ["PARAM DECLARATION"],
        expected_plan_fingerprint: preflight.plan_fingerprint,
      }),
    });
    expect(applyResponse.status).toBe(200);
    await expect(applyResponse.json()).resolves.toMatchObject({
      kind: "kt.codegen.apply-result",
      region_count: 1,
      verified: true,
      files: [{ path: "Route.h", region_count: 1 }],
    });
    expect(fs.readFileSync(path.join(workspace, "Route.h"), "utf8"))
      .toContain(preflight.plan.artifacts[0].content.trim());

    const staleApplyResponse = await shellRoutes.request("/api/code/codegen/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        param: opened.param,
        table: opened.table,
        block_keys: ["PARAM DECLARATION"],
        expected_plan_fingerprint: preflight.plan_fingerprint,
      }),
    });
    expect(staleApplyResponse.status).toBe(409);

    opened.table.items[0].defaultValue = "2";
    const saveResponse = await shellRoutes.request("/api/code/codegen/document", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: opened.path,
        fingerprint: opened.fingerprint,
        param: opened.param,
        table: opened.table,
      }),
    });
    expect(saveResponse.status).toBe(200);
    await expect(saveResponse.json()).resolves.toMatchObject({ item_count: 1 });

    const changedStateResponse = await shellRoutes.request("/api/code/codegen/document-state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: opened.path,
        expected_file_signature: opened.file_signature,
        expected_fingerprint: opened.fingerprint,
      }),
    });
    expect(changedStateResponse.status).toBe(200);
    await expect(changedStateResponse.json()).resolves.toMatchObject({ exists: true, changed: true });

    const staleResponse = await shellRoutes.request("/api/code/codegen/document", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: opened.path,
        fingerprint: opened.fingerprint,
        param: opened.param,
        table: opened.table,
      }),
    });
    expect(staleResponse.status).toBe(409);

    const raceFilename = path.join(workspace, "race.codegen.json");
    fs.copyFileSync(path.join(workspace, "route.codegen.json"), raceFilename);
    const raceOpenResponse = await shellRoutes.request("/api/code/codegen/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "race.codegen.json" }),
    });
    const raceOpened = await raceOpenResponse.json();
    const originalOpen = fs.openSync.bind(fs);
    let raceTargetOpens = 0;
    const openSpy = vi.spyOn(fs, "openSync").mockImplementation(((target: fs.PathLike, ...args: unknown[]) => {
      const handle = originalOpen(target, ...(args as Parameters<typeof fs.openSync> extends [unknown, ...infer Rest] ? Rest : never));
      if (String(target) === raceFilename && ++raceTargetOpens === 2) {
        fs.writeFileSync(raceFilename, "external change\n", "utf8");
      }
      return handle;
    }) as typeof fs.openSync);
    try {
      const raceResponse = await shellRoutes.request("/api/code/codegen/document", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: raceOpened.path,
          fingerprint: raceOpened.fingerprint,
          param: raceOpened.param,
          table: raceOpened.table,
        }),
      });
      expect(raceResponse.status).toBe(409);
      await expect(raceResponse.json()).resolves.toMatchObject({
        detail: expect.stringMatching(/保存过程中已再次变化/),
      });
    } finally {
      openSpy.mockRestore();
    }
  }, 20_000);
});
