/** 解析 .CATNls：Key = "value"; */

export function parseCatNls(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lineRe = /^([A-Za-z0-9_.]+)\s*=\s*"(.*)"\s*;\s*$/;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) continue;
    const m = trimmed.match(lineRe);
    if (m) out[m[1].trim()] = m[2];
  }
  return out;
}
