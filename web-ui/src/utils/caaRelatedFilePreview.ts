const IMAGE_EXTS = new Set([".png", ".bmp", ".gif", ".jpg", ".jpeg", ".ico", ".svg", ".webp"]);

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export function isCaaPreviewImagePath(repoRelPath: string): boolean {
  const lower = repoRelPath.replace(/\\/g, "/").toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(lower.slice(dot));
}

export function caaPreviewMimeForPath(repoRelPath: string): string {
  const lower = repoRelPath.replace(/\\/g, "/").toLowerCase();
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot) : "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export type CaaFilePreviewPayload =
  | {
      kind: "text";
      repoRelPath: string;
      filename: string;
      sizeBytes: number;
      text: string;
    }
  | {
      kind: "image";
      repoRelPath: string;
      filename: string;
      sizeBytes: number;
      mime: string;
      base64: string;
    };

export function caaImageDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`;
}
