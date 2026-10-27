import fs from "node:fs";
import {describe, expect, it} from "vitest";

describe("standalone browser profile boundaries", () => {
  it("starts the existing app once with owned registration and no legacy or Native bootstrap", () => {
    const source=fs.readFileSync(new URL("../../browserServer.ts",import.meta.url),"utf8");
    expect(source.match(/createPhoenixServerApp\(/g)).toHaveLength(1);
    expect(source).toContain("acquireDeskToolsInstanceLease()");
    expect(source).toContain("registerDeskToolsRuntime(");
    expect(source).toContain('server.listen(requestedPort, "127.0.0.1"');
    expect(source).toContain("assetDigests");
    expect(source).not.toMatch(/from\s+["'][^"']*\/server(?:\.js|\.ts)["']|migrateLegacyRuntimeUserData|configureDrawingExecutionBarrier|\.kill\(/);
  });
  it("keeps browser artifacts apart from the default sidecar and does not enable inherited API origins", () => {
    const bundle=fs.readFileSync(new URL("../../../scripts/build-server-bundle.mjs",import.meta.url),"utf8");
    expect(bundle).toContain('process.argv[2] !== "--browser"');
    expect(bundle).toContain('browserProfile ? "dist-browser" : "dist-sidecar"');
    const build=fs.readFileSync(new URL("../../../../scripts/build-desk-web.mjs",import.meta.url),"utf8");
    expect(build).toContain('VITE_API_ORIGIN:""');
    expect(build).toContain('status:"not-published"');
    expect(build).toContain("assets:[]");
  });
});
