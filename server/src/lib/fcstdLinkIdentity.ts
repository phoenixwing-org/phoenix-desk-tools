/** Serialized object identity, shared by assembly preview and label writes.
 * Offsets always refer to the original XML; only Label values may be patched. */
/** FreeCAD's Base::Tools::getIdentifier accepts Unicode letters, not just
 * ASCII. Match its first/subsequent character categories without normalizing
 * the saved identity or accepting XML syntax, whitespace or path separators. */
export function isFcstdObjectName(value: string): boolean {
  return /^[_\p{L}\p{Nl}][_\p{L}\p{Nl}\p{Nd}\p{Mn}\p{Mc}\p{Pc}]*$/u.test(value);
}

export function xmlAttribute(tag: string, key: string): string {
  const raw = new RegExp(`(?:^|\\s)${key}\\s*=\\s*(["'])(.*?)\\1`, "s").exec(tag)?.[2] ?? "";
  return raw.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

export type FcstdXmlObject = {
  name: string;
  properties: Map<string, { type: string; content: string; start: number }>;
};

export function fcstdXmlObjects(xml: string): FcstdXmlObject[] {
  // Mask comments without moving offsets or accidentally matching fake objects.
  const semantic = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, text => " ".repeat(text.length));
  const dataStart = semantic.indexOf("<ObjectData");
  if (dataStart < 0) return [];
  const dataEnd = semantic.indexOf("</ObjectData>", dataStart);
  const stack: Array<{ name: string; start: number; children: [number, number][] }> = [];
  const objects: FcstdXmlObject[] = [];
  const tokens = /<Object\b[^>]*>|<\/Object>/g;
  tokens.lastIndex = dataStart;
  for (let match; (match = tokens.exec(semantic)) && (dataEnd < 0 || match.index < dataEnd);) {
    if (!match[0].startsWith("</")) {
      if (!match[0].endsWith("/>")) stack.push({ name: xmlAttribute(match[0], "name"), start: tokens.lastIndex, children: [] });
      continue;
    }
    const object = stack.pop();
    if (!object) continue;
    let own = semantic.slice(object.start, match.index);
    for (const [start, end] of object.children) {
      const from = start - object.start, to = end - object.start;
      own = own.slice(0, from) + " ".repeat(to - from) + own.slice(to);
    }
    const properties: FcstdXmlObject["properties"] = new Map();
    for (const prop of own.matchAll(/<Property\b([^>]*)>([\s\S]*?)<\/Property>/g)) {
      const start = object.start + prop.index! + prop[0].indexOf(">") + 1;
      properties.set(xmlAttribute(prop[1], "name"), { type: xmlAttribute(prop[1], "type"), content: prop[2], start });
    }
    // Older fixtures/serializers may put XLink directly in Object, without Property.
    const bare = own.replace(/<Property\b[^>]*>[\s\S]*?<\/Property>/g, text => " ".repeat(text.length));
    if (/<XLink\b/.test(bare)) properties.set("", { type: "", content: bare, start: object.start });
    objects.push({ name: object.name, properties });
    stack.at(-1)?.children.push([object.start, tokens.lastIndex]);
  }
  return objects;
}

export function objectString(object: FcstdXmlObject, key: string): string {
  const tag = object.properties.get(key)?.content.match(/<String\b[^>]*>/)?.[0] ?? "";
  return xmlAttribute(tag, "value");
}

export type FcstdLinkInstance = {
  host_object_name: string;
  target_object_name: string;
  xlink_file_attr: string;
  link_label: string;
  labelStart: number;
  labelLength: number;
};

export function fcstdLinkInstances(xml: string): FcstdLinkInstance[] {
  const instances: FcstdLinkInstance[] = [];
  for (const object of fcstdXmlObjects(xml)) {
    const label = object.properties.get("Label");
    const value = label?.content.match(/<String\b[^>]*?\bvalue\s*=\s*(["'])(.*?)\1/s);
    if (!label || !value || value.index == null) continue;
    const labelStart = label.start + value.index + value[0].length - value[2].length - 1;
    for (const name of ["LinkedObject", ""]) {
      const property = object.properties.get(name);
      if (!property || (name && property.type !== "App::PropertyXLink")) continue;
      for (const [tag] of property.content.matchAll(/<XLink\b[^>]*>/g)) {
        const file = xmlAttribute(tag, "file");
        if (!file) continue;
        instances.push({ host_object_name: object.name, target_object_name: xmlAttribute(tag, "name"),
          xlink_file_attr: file, link_label: objectString(object, "Label"), labelStart, labelLength: value[2].length });
      }
    }
  }
  return instances;
}
