import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESK_TOOLS_PREFERRED_PORT,
  deskToolsPortCandidates,
  deskToolsRegistrationDirectory,
  registerDeskToolsRuntime,
} from "./deskToolsRegistration.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "phoenix-desk-registration-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("Desk Tools registration", () => {
  it("uses platform-standard user configuration directories", () => {
    expect(deskToolsRegistrationDirectory({}, "darwin", "/Users/test"))
      .toBe("/Users/test/Library/Application Support/phoenix-wing/phoenix/services/desk-tools");
    expect(deskToolsRegistrationDirectory({ LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local" }, "win32", "C:\\Users\\test"))
      .toBe(path.join("C:\\Users\\test\\AppData\\Local", "phoenix-wing", "phoenix", "services", "desk-tools"));
  });

  it("uses a 32-port dynamic range unless an explicit strict port is configured", () => {
    const automatic = deskToolsPortCandidates({});
    expect(automatic.strict).toBe(false);
    expect(automatic.ports).toHaveLength(32);
    expect(automatic.ports[0]).toBe(DESK_TOOLS_PREFERRED_PORT);
    expect(automatic.ports.at(-1)).toBe(DESK_TOOLS_PREFERRED_PORT + 31);
    expect(deskToolsPortCandidates({ CAA_SERVER_PORT: "5199" })).toEqual({ ports: [5199], strict: true });
    expect(() => deskToolsPortCandidates({ CAA_SERVER_PORT: "invalid" })).toThrow("CAA_SERVER_PORT");
  });

  it("atomically publishes and owner-safely removes the live service", () => {
    const directory = temporaryDirectory();
    const handle = registerDeskToolsRuntime(48_377, { PHOENIX_DESK_TOOLS_REGISTRY_DIR: directory }, new Date("2026-07-20T12:00:00.000Z"));
    expect(JSON.parse(fs.readFileSync(handle.servicePath, "utf8"))).toMatchObject({
      schema_version: 1,
      service: "phoenix-desk-tools",
      protocol_version: 1,
      host: "127.0.0.1",
      port: 48_377,
      started_at: "2026-07-20T12:00:00.000Z",
    });
    expect(fs.readdirSync(directory).filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
    handle.dispose();
    expect(fs.existsSync(handle.servicePath)).toBe(false);
  });

  it("does not delete a registration replaced by a newer instance", () => {
    const directory = temporaryDirectory();
    const first = registerDeskToolsRuntime(48_375, { PHOENIX_DESK_TOOLS_REGISTRY_DIR: directory });
    const second = registerDeskToolsRuntime(48_376, { PHOENIX_DESK_TOOLS_REGISTRY_DIR: directory });
    first.dispose();
    expect(JSON.parse(fs.readFileSync(second.servicePath, "utf8"))).toMatchObject({ port: 48_376 });
    second.dispose();
  });
});
