import { expect, it } from "vitest";
import { drawingLinkLabelAttributes, isStandaloneDrawing } from "./fcstdDrawing.js";

const page = '<Object type="TechDraw::DrawPage" name="Page"/>';
it("recognizes separate drawings by suffix or actual objects, not comments or object names", () => {
  expect(isStandaloneDrawing("Sheet.Drawing.FCStd")).toBe(true);
  expect(isStandaloneDrawing("Sheet.FCStd", `<Document><Objects>${page}<Object type='App::Link' name='Model'/></Objects></Document>`)).toBe(true);
  expect(isStandaloneDrawing("Part.FCStd", `<Document><!-- ${page} --><Objects><Object type="PartDesign::Body" name="TechDraw"/></Objects></Document>`)).toBe(false);
});
it.each(["PartDesign::Body", "App::Part", "Assembly::AssemblyObject", "Part::Feature", "Part::FeaturePython"])("does not make a %s model read-only because it contains a TechDraw page", type => {
  expect(isStandaloneDrawing("Model.FCStd", `<Document><Objects>${page}<Object name="Model" type="${type}"/></Objects></Document>`)).toBe(false);
});
it("distinguishes drawing Source references from actual App::Link instance labels", () => {
  const source = '<Object name="View"><Properties><Property name="Label"><String value="Front view"/></Property><Property name="Source" type="App::PropertyXLink"><XLink file="Part.FCStd"/></Property></Properties></Object>';
  expect(drawingLinkLabelAttributes("Sheet.Drawing.FCStd", `<ObjectData>${source}</ObjectData>`)).toEqual(new Set());
  const instance = source.replace('name="Source"', 'name="LinkedObject"');
  expect(drawingLinkLabelAttributes("Sheet.Drawing.FCStd", `<ObjectData>${instance}</ObjectData>`)).toEqual(new Set(["Part.FCStd"]));
  expect(drawingLinkLabelAttributes("Model.FCStd", `<ObjectData>${source}</ObjectData>`)).toBeNull();
});
