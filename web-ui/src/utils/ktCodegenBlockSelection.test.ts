import { describe, expect, it } from "vitest";
import {
  enterKtCodegenSingleMode,
  toggleKtCodegenBlockSelection,
} from "./ktCodegenBlockSelection";

describe("KT Codegen Block selection", () => {
  it("replaces the selection when single mode checks a Block", () => {
    expect(toggleKtCodegenBlockSelection(
      ["PARAM CONSTRUCTOR", "PARAM DECLARATION"],
      "PARAM DESTRUCTOR",
      true,
      true,
    )).toEqual(["PARAM DESTRUCTOR"]);
  });

  it("keeps only the first selected Block when entering single mode", () => {
    expect(enterKtCodegenSingleMode([
      "PARAM CONSTRUCTOR",
      "PARAM DECLARATION",
    ])).toEqual(["PARAM CONSTRUCTOR"]);
  });
});
