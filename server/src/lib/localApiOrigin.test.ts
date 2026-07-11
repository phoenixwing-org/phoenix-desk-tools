import { describe, expect, it } from "vitest";
import { isAllowedPhoenixUiOrigin } from "./localApiOrigin.js";

describe("local API origin policy", () => {
  it.each([
    "",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://[::1]:5173",
  ])("allows the managed UI origin %s", (origin) => {
    expect(isAllowedPhoenixUiOrigin(origin)).toBe(true);
  });

  it.each([
    "https://example.com",
    "http://localhost:5174",
    "http://127.0.0.1:5180",
    "file://local/index.html",
    "not a url",
  ])("rejects an unrelated webpage origin %s", (origin) => {
    expect(isAllowedPhoenixUiOrigin(origin)).toBe(false);
  });
});
