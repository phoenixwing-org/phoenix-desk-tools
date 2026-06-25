import { describe, expect, it } from "vitest";
import { caaGridEditRowTrackTemplate } from "./caaControlMetrics";

describe("caaGridEditRowTrackTemplate", () => {
  it("keeps empty edit rows visible with a minimum height", () => {
    expect(caaGridEditRowTrackTemplate(3, [], false)).toBe(
      "minmax(24px, auto) minmax(24px, auto) minmax(24px, auto)",
    );
  });

  it("preserves stretch rows while adding an edit minimum", () => {
    expect(caaGridEditRowTrackTemplate(3, [1], true)).toBe(
      "minmax(24px, auto) minmax(24px, 1fr) minmax(24px, auto)",
    );
  });
});
