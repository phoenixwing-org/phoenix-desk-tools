export type FcstdPropertyCountIssue = {
  object_name: string;
  declared_count: string | null;
  actual_count: number;
};

/** Count-only compatibility for FCStd serialization; no BOM values or XLinks are changed. */
export function reconcileFcstdPropertyCounts(xml: string, onlyObjectName?: string) {
  type Container = { start: number; opening: string; object: string; count: number };
  const stack: Array<{ tag: string; object?: string; properties?: Container }> = [];
  const containers: Container[] = [];
  // Tokenize quoted attributes as a whole (values may contain '>'); ignore
  // comments/CDATA rather than counting their example Property text.
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?[A-Za-z_][\w:.-]*(?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"<]*"|'[^'<]*'))*\s*\/?>/g;
  const invalid = () => { throw new Error("Document.xml 结构不受支持或不完整，未修正"); };
  let end = 0;
  let roots = 0;
  for (const match of xml.matchAll(tokens)) {
    const token = match[0];
    if (xml.slice(end, match.index).includes("<")) invalid();
    if (!stack.length && xml.slice(end, match.index).trim()) invalid();
    end = match.index + token.length;
    if (token.startsWith("<!") || token.startsWith("<?")) continue;
    const tag = /^<\/?([\w:.-]+)/.exec(token)![1];
    if (token.startsWith("</")) {
      if (!/^<\/[\w:.-]+\s*>$/.test(token)) invalid();
      if (stack.pop()?.tag !== tag) invalid();
      continue;
    }
    const attrs = new Map<string, string>();
    for (const attr of token.matchAll(/\s([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      if (attrs.has(attr[1])) invalid();
      attrs.set(attr[1], attr[3]);
    }
    const parent = stack.at(-1);
    if (!parent && (++roots !== 1 || tag !== "Document")) invalid();
    const entry: (typeof stack)[number] = { tag };
    if (tag === "Object" && (parent?.tag === "ObjectData" || parent?.tag === "Objects")) {
      entry.object = attrs.get("name");
    }
    if (tag === "Properties" && parent?.object && (!onlyObjectName || onlyObjectName === parent.object)) {
      entry.properties = { start: match.index, opening: token, object: parent.object, count: 0 };
      containers.push(entry.properties);
    }
    if (tag === "Property" && parent?.properties) parent.properties.count += 1;
    if (!token.endsWith("/>")) stack.push(entry);
  }
  if (stack.length || roots !== 1 || xml.slice(end).trim()) invalid();

  const issues: FcstdPropertyCountIssue[] = [];
  let patched = xml;
  for (const container of containers.reverse()) {
    const attr = /(\sCount\s*=\s*)(["'])([^"']*)\2/.exec(container.opening);
    if (attr && /^\d+$/.test(attr[3]) && Number(attr[3]) === container.count) continue;
    issues.unshift({ object_name: container.object, declared_count: attr?.[3] ?? null, actual_count: container.count });
    const opening = attr
      ? container.opening.replace(attr[0], `${attr[1]}${attr[2]}${container.count}${attr[2]}`)
      : container.opening.replace(/(\/?>)$/, ` Count="${container.count}"$1`);
    patched = patched.slice(0, container.start) + opening + patched.slice(container.start + container.opening.length);
  }
  return { xml: patched, issues };
}
