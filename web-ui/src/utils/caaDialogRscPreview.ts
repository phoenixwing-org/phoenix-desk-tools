import type { CaaDialogIr, CaaDialogBitmapFile } from "../types/caaDialogIr";

export type CaaDialogRscPreviewRow = {
  id: string;
  key: string;
  resourceName: string;
  bitmapRel?: string;
  bitmapFilename?: string;
};

function norm(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function lower(value: string): string {
  return norm(value).toLowerCase();
}

function basename(value: string): string {
  const n = norm(value);
  return n.split("/").pop() ?? n;
}

function stripExt(value: string): string {
  return value.replace(/\.[^.]+$/, "");
}

function bitmapMatchesResource(bitmap: CaaDialogBitmapFile, resourceName: string): boolean {
  const resource = lower(resourceName);
  const resourceBase = lower(basename(resourceName));
  const resourceNoExt = stripExt(resourceBase);
  const filename = lower(bitmap.filename);
  const filenameNoExt = stripExt(filename);
  const rel = lower(bitmap.repoRelPath);
  return (
    resource === filename ||
    resourceBase === filename ||
    resourceNoExt === filenameNoExt ||
    rel.endsWith(`/${resource}`) ||
    rel.endsWith(`/${resourceBase}`)
  );
}

function findBitmapForResource(
  bitmaps: CaaDialogBitmapFile[],
  resourceName: string,
): CaaDialogBitmapFile | undefined {
  return bitmaps.find((bitmap) => bitmapMatchesResource(bitmap, resourceName));
}

export function buildCaaDialogRscPreviewRows(ir: CaaDialogIr): CaaDialogRscPreviewRow[] {
  const rsc = ir.rsc ?? {};
  const bitmaps = ir.parseMeta?.bitmapFiles ?? [];
  return Object.entries(rsc)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map(([key, rawValue]) => {
      const resourceName = String(rawValue ?? "").trim();
      const bitmap = resourceName ? findBitmapForResource(bitmaps, resourceName) : undefined;
      return {
        id: `rsc:${key}`,
        key,
        resourceName,
        bitmapRel: bitmap?.repoRelPath,
        bitmapFilename: bitmap?.filename,
      };
    });
}
