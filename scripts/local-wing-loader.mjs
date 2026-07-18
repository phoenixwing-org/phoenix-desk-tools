import { pathToFileURL } from "node:url";
import { resolveLocalWingExport } from "./phoenix-wing-mode.mjs";

let wingRoot = null;

export function initialize(data) {
  wingRoot = data.wingRoot;
}

export async function resolve(specifier, context, nextResolve) {
  const localPath = resolveLocalWingExport(wingRoot, specifier);
  if (!localPath) return nextResolve(specifier, context);
  return nextResolve(pathToFileURL(localPath).href, context);
}
