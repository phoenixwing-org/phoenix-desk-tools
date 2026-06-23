const LINE_RE = /^([A-Za-z0-9_.]+)\s*=\s*"(.*)"\s*;\s*$/;

export function escapeCatNlsValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function formatCatNlsLine(key: string, value: string): string {
  return `${key} = "${escapeCatNlsValue(value)}";`;
}

/**
 * 在保留注释与 WIZARD 区结构的前提下，用扁平键表更新 `.CATNls` 文本。
 * `keys` 应包含需要保留的全部键（含未改动的项）。
 */
export function patchCatNls(sourceText: string, keys: Record<string, string>): string {
  const seen = new Set<string>();
  const lines = sourceText.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const m = trimmed.match(LINE_RE);
    if (m) {
      const key = m[1].trim();
      if (keys[key] !== undefined) {
        out.push(formatCatNlsLine(key, keys[key]));
        seen.add(key);
        continue;
      }
    }
    out.push(line);
  }

  const missing = Object.keys(keys)
    .filter((k) => !seen.has(k))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  if (missing.length) {
    const endIdx = out.findIndex((l) => l.includes("END WIZARD"));
    const newLines = missing.map((k) => formatCatNlsLine(k, keys[k]));
    if (endIdx >= 0) {
      out.splice(endIdx, 0, ...newLines);
    } else {
      if (out.length && out[out.length - 1] !== "") out.push("");
      out.push(...newLines);
    }
  }

  return out.join("\n");
}
