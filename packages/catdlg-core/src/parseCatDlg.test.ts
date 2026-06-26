import { describe, expect, it } from "vitest";
import { parseCatDlg } from "./parseCatDlg.js";

describe("parseCatDlg declaration order", () => {
  it("parses CAA declaration order: type followed by instance name", () => {
    const nodes = parseCatDlg(`
CATDlgDialog MyDlg
{
  STYLE = CATDlgWndBtn;
}
`);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: "CATDlgDialog",
      id: "MyDlg",
    });
  });

  it("does not treat reversed instance/type order as a valid CAA node", () => {
    const nodes = parseCatDlg(`
MyDlg CATDlgDialog
{
  STYLE = CATDlgWndBtn;
}
`);

    expect(nodes).toHaveLength(0);
  });
});
