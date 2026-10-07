import { expect, it } from "vitest";
import { isBlankThumbnail } from "./thumbnailPixels";
it("distinguishes a saved blank image from visible model content", () => {
  expect(isBlankThumbnail(new Uint8ClampedArray([247,247,247,255,247,247,247,255]))).toBe(true);
  expect(isBlankThumbnail(new Uint8ClampedArray([1,2,3,0,40,50,60,0]))).toBe(true);
  expect(isBlankThumbnail(new Uint8ClampedArray([247,247,247,255,246,247,247,255]))).toBe(false);
});
