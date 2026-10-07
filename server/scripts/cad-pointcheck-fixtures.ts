import fs from "node:fs";
import path from "node:path";

export type CadPointcheckFixtures = {
  subdir: string;
  // Assembly, editable part, drawing, and two distinct conflict-test parts.
  files: [string, string, string, string, string];
};

export function parseCadPointcheckFixtures(value: unknown): CadPointcheckFixtures {
  if (!value || typeof value !== "object") throw new Error("Invalid fixture manifest");
  const { subdir, files } = value as Partial<CadPointcheckFixtures>;
  const safeSegment = (s: unknown): s is string => typeof s === "string" && s.trim() === s
    && s.length > 0 && s !== "." && s !== ".." && !/[\\/:\x00-\x1f]/.test(s);
  if (!safeSegment(subdir) || !Array.isArray(files) || files.length !== 5
    || !files.every(name => safeSegment(name) && /\.FCStd$/i.test(name))
    || new Set(files.map(name => name.normalize("NFC").toLowerCase())).size !== 5) {
    throw new Error("Fixture manifest requires a single relative subdir and five distinct FCStd basenames");
  }
  return { subdir, files: files as CadPointcheckFixtures["files"] };
}

export function readCadPointcheckFixtures(filename: string | undefined, repositoryRoot: string): CadPointcheckFixtures {
  if (!filename) throw new Error("Pass --fixture-manifest with a local JSON manifest outside the repository");
  const resolved = fs.realpathSync(filename);
  const relative = path.relative(fs.realpathSync(repositoryRoot), resolved);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
    throw new Error("Keep private fixture manifests outside the repository");
  }
  return parseCadPointcheckFixtures(JSON.parse(fs.readFileSync(resolved, "utf8")));
}
