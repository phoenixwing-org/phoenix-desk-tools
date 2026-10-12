/** Native-open dependency preflight, not extension-filtered CAD discovery.
 * Quoted `>` characters must not truncate paths, and non-FCStd dependencies
 * must remain visible so the caller can reject them before starting FreeCAD. */
export function fcstdNativeXlinkFiles(xml: string): string[] {
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>/g, "");
  if (/<!DOCTYPE|<!ENTITY/i.test(semantic)) throw new Error("不读取带外部实体的模型");
  const files: string[] = [];
  for (const start of semantic.matchAll(/<XLink\b/gi)) {
    const match = /^<XLink\b((?:"[^"]*"|'[^']*'|[^'">])*)>/i.exec(semantic.slice(start.index));
    if (!match) throw new Error("模型引用结构无效");
    let rest = match[1].trim().replace(/\/$/, "").trim();
    const attributes = new Map<string, string>();
    while (rest) {
      const attr = /^([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*/.exec(rest);
      if (!attr || attributes.has(attr[1])) throw new Error("模型引用属性无效");
      attributes.set(attr[1], attr[2] ?? attr[3]); rest = rest.slice(attr[0].length);
    }
    const raw = attributes.get("file"); if (!raw) continue;
    if (raw.includes("<") || /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)/.test(raw)) throw new Error("模型引用转义无效");
    const file = raw.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);/g, (_, entity: string) => {
      if (!entity.startsWith("#")) return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity];
      const point = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) throw new Error("模型引用字符无效");
      return String.fromCodePoint(point);
    });
    if (file.length > 4096 || /[\x00-\x1f]/.test(file)) throw new Error("模型引用路径无效");
    files.push(file);
  }
  return files;
}
