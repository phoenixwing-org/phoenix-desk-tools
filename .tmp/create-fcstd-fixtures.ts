import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";

const workspace = path.resolve(".tmp/tauri-acceptance-workspace");
const root = path.join(workspace, "Cad");

function property(name: string, value: string): string {
  return `<Property name="${name}" type="App::PropertyString"><String value="${value}"/></Property>`;
}

type LinkSpec = {
  name: string;
  label: string;
  file: string;
};

function documentXml(
  name: string,
  type: string,
  properties: Record<string, string>,
  link?: LinkSpec,
): string {
  const body = Object.entries(properties).map(([key, value]) => property(key, value)).join("");
  const objectTypes = link
    ? `<Object type="${type}" name="${name}"/><Object type="App::Link" name="${link.name}"/>`
    : `<Object type="${type}" name="${name}"/>`;
  const group = link
    ? `<Property name="Group" type="App::PropertyLinkList"><Link value="${link.name}"/></Property>`
    : "";
  const linkObject = link
    ? `<Object name="${link.name}"><Properties>${property("Label", link.label)}</Properties><XLink file="${link.file}"/></Object>`
    : "";
  return `<?xml version="1.0"?><Document><Objects>${objectTypes}</Objects><ObjectData><Object name="${name}"><Properties>${body}${group}</Properties></Object>${linkObject}</ObjectData></Document>`;
}

const fixtures = [
  {
    rel: "asm/100001.001-A-Root.ASSY.FCStd",
    xml: documentXml("Root", "App::Part", {
      Label: "Root Assembly",
      PartNumber: "100001",
      PartVersion: "001",
      TypeCode: "A",
      ModelSeries: "ROOT",
      PartName: "Root Assembly",
    }, {
      name: "SubLink",
      label: "Stale Sub Label",
      file: "100002.001-A-Sub.ASSY.FCStd",
    }),
  },
  {
    rel: "asm/100002.001-A-Sub.ASSY.FCStd",
    xml: documentXml("Sub", "App::Part", {
      Label: "Sub Assembly",
      PartNumber: "100002",
      PartVersion: "001",
      TypeCode: "A",
      ModelSeries: "SUB",
      PartName: "Sub Assembly",
    }, {
      name: "BoltLink",
      label: "Stale Bolt Label",
      file: "../parts/100003.001-H-Bolt.FCStd",
    }),
  },
  {
    rel: "parts/100003.001-H-Bolt.FCStd",
    xml: documentXml("Bolt", "PartDesign::Body", {
      Label: "Bolt",
      PartNumber: "100003",
      PartVersion: "001",
      TypeCode: "H",
      ModelSeries: "",
      PartName: "Bolt",
    }),
  },
];

for (const fixture of fixtures) {
  const abs = path.join(root, fixture.rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, zipSync({
    "Document.xml": strToU8(fixture.xml),
    "GuiDocument.xml": strToU8(`keep ${fixture.rel}`),
  }));
}

console.log(JSON.stringify(fixtures.map((fixture) => `Cad/${fixture.rel}`), null, 2));
