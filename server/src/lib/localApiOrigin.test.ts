import { describe, expect, it } from "vitest";
import { isAllowedPhoenixUiOrigin } from "./localApiOrigin.js";

describe("local API origin policy", () => {
  it.each([
    "",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:49373",
    "http://127.0.0.1:49374",
    "http://[::1]:49404",
  ])("allows the managed UI origin %s", (origin) => {
    expect(isAllowedPhoenixUiOrigin(origin)).toBe(true);
  });

  it.each([
    "https://example.com",
    "http://localhost:5173",
    "http://localhost:49405",
    "http://127.0.0.1:5180",
    "file://local/index.html",
    "not a url",
  ])("rejects an unrelated webpage origin %s", (origin) => {
    expect(isAllowedPhoenixUiOrigin(origin)).toBe(false);
  });

  it("allows one explicit UI port outside the automatic range", () => {
    expect(isAllowedPhoenixUiOrigin("http://localhost:50000", { WEB_UI_PORT: "50000" })).toBe(true);
    expect(isAllowedPhoenixUiOrigin("http://localhost:50001", { WEB_UI_PORT: "50000" })).toBe(false);
  });
});
