import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deskApiRegistrationDirectory,
  discoverDeskApi,
} from "./desk-api-discovery.mjs";

test("resolves the same platform registration directory as Desk and Auto Code", () => {
  assert.equal(
    deskApiRegistrationDirectory({}, "darwin", "/Users/test"),
    "/Users/test/Library/Application Support/phoenix-wing/phoenix/services/desk-tools",
  );
});

test("discovers and validates an already-running compatible API", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desk-api-discovery-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "service.v1.json"), JSON.stringify({
    schema_version: 1,
    service: "phoenix-desk-tools",
    protocol_version: 1,
    host: "127.0.0.1",
    port: 48_381,
  }));
  const fetchImpl = async () => ({
    ok: true,
    async json() { return { service: "phoenix-node", protocol_version: 1, app_version: "0.3.0" }; },
  });
  assert.deepEqual(
    await discoverDeskApi({ PHOENIX_DESK_TOOLS_REGISTRY_DIR: directory }, fetchImpl),
    {
      origin: "http://127.0.0.1:48381",
      port: 48_381,
      protocolVersion: 1,
      appVersion: "0.3.0",
      servicePath: path.join(directory, "service.v1.json"),
    },
  );
});

test("rejects a live incompatible protocol instead of starting a second API", async (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desk-api-discovery-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, "service.v1.json"), JSON.stringify({
    schema_version: 1,
    service: "phoenix-desk-tools",
    protocol_version: 99,
    host: "127.0.0.1",
    port: 48_381,
  }));
  const fetchImpl = async () => ({
    ok: true,
    async json() { return { service: "phoenix-node", protocol_version: 99 }; },
  });
  await assert.rejects(
    discoverDeskApi({ PHOENIX_DESK_TOOLS_REGISTRY_DIR: directory }, fetchImpl),
    /协议版本/,
  );
});
