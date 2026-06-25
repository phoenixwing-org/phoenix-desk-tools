const LINE_RE = /^([A-Za-z0-9_.]+)\s*=\s*"(.*)"\s*;\s*$/;

export function escapeCatNlsValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function formatCatNlsLine(key: string, value: string): string {
  return `${key} = "${escapeCatNlsValue(value)}";`;
}

const WIZARD_START = "// DO NOT EDIT :: THE CAA2 WIZARD WILL REPLACE ALL THE CODE HERE";
const WIZARD_END = "// END WIZARD REPLACEMENT ZONE";

/**
 * 用 model 树计算的有序 NLS 条目完整重写 WIZARD 区。
 *
 * - WIZARD 区外的行（header 注释等）原样保留
 * - WIZARD 区内的内容完全由 `entries` 决定（顺序、增减）
 * - 若源文件无 WIZARD 标记，在末尾追加完整 WIZARD 区
 */
export function patchCatNls(sourceText: string, entries: { key: string; value: string }[]): string {
  const lines = sourceText.split(/\r?\n/);
  const out: string[] = [];
  let inWizard = false;
  let wizardWritten = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === WIZARD_START) {
      // 输出 WIZARD 开始标记
      out.push(line);
      // 输出 model 计算的有序条目
      for (const e of entries) {
        out.push(formatCatNlsLine(e.key, e.value));
      }
      wizardWritten = true;
      inWizard = true;
      continue;
    }

    if (trimmed === WIZARD_END) {
      inWizard = false;
      out.push(line);
      continue;
    }

    // WIZARD 区内的旧行全部跳过（已由 entries 重写）
    if (inWizard) continue;

    // WIZARD 区外的行原样保留
    out.push(line);
  }

  // 如果源文件没有 WIZARD 标记，在末尾追加
  if (!wizardWritten) {
    if (out.length && out[out.length - 1] !== "") out.push("");
    out.push(WIZARD_START);
    for (const e of entries) {
      out.push(formatCatNlsLine(e.key, e.value));
    }
    out.push(WIZARD_END);
  }

  return out.join("\n");
}
