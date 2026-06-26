import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAA_CONTROL_CATALOG, isKnownCaaControlType } from "./controlCatalog.js";

const P2_TYPES = [
  "CATDlgContainer",
  "CATDlgSplitter",
  "CATDlgIconBox",
  "CATDlgProgress",
  "CATDlgSlider",
  "CATDlgScrollbar",
];

const READONLY_SHELL_TYPES = [
  "CATDlgMenuBar",
  "CATDlgToolBar",
  "CATDlgStatusBar",
  "CATDlgSubMenu",
  "CATDlgPushItem",
  "CATDlgCheckItem",
  "CATDlgRadioItem",
  "CATDlgSeparatorItem",
];

describe("control catalog", () => {
  it("keeps the JSON artifact and TS query layer in sync", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const jsonPath = path.resolve(here, "../control_catalog.json");
    const json = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
      controls: Array<{ type: string }>;
    };

    expect(json.controls.map((c) => c.type).sort()).toEqual(
      CAA_CONTROL_CATALOG.map((c) => c.type).sort(),
    );
  });

  it("registers the planned P2 controls", () => {
    for (const type of P2_TYPES) {
      expect(isKnownCaaControlType(type)).toBe(true);
    }
  });

  it("registers menu, toolbar, and status bar types as read-only shell controls", () => {
    for (const type of READONLY_SHELL_TYPES) {
      expect(isKnownCaaControlType(type)).toBe(true);
    }
  });
});
