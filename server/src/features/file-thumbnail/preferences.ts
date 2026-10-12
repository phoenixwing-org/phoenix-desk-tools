/** Fixed, local-only preference operation; no document or geometry commands. */
const MARKER = "DESK_SAVE_THUMBNAIL_PERSISTED";
const PYTHON = [
  "import FreeCAD as App",
  "_desk_thumbnail_preferences = App.ParamGet('User parameter:BaseApp/Preferences/Document')",
  "_desk_thumbnail_preferences.SetBool('SaveThumbnail', True)",
  "if App.saveParameter() is False:",
  "    raise RuntimeError('SaveThumbnail preferences were not persisted')",
  "if App.ParamGet('User parameter:BaseApp/Preferences/Document').GetBool('SaveThumbnail', False) is not True:",
  "    raise RuntimeError('SaveThumbnail was not enabled')",
  `print('${MARKER}')`,
].join("\n");
const RPC_TIMEOUT_SECONDS = 10;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const GUIDANCE = "请打开 FreeCAD 并开启 MCP 本地 RPC 服务，确认端口与授权配置后重试";

class PreferenceFailure extends Error {}
function failure(reason: string): never { throw new PreferenceFailure(reason); }
function xmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

type XmlNode = { name: string; text: string; children: XmlNode[] };
type RpcValue = string | boolean | number | null | RpcValue[] | { [key: string]: RpcValue };
function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return value.replace(/&([^;]*);|&/g, (_entity: string, name: string | undefined) => {
    if (name && Object.hasOwn(named, name)) return named[name];
    const numeric = name?.match(/^#(?:(\d+)|x([0-9a-f]+))$/i);
    const point = numeric ? parseInt(numeric[1] || numeric[2], numeric[1] ? 10 : 16) : NaN;
    if (!Number.isInteger(point) || !(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff)) failure("RPC 返回无效 XML 实体");
    return String.fromCodePoint(point);
  });
}

/** Bounded XML-RPC grammar, with no DTD, external entities or tag attributes. */
function parseXml(xml: string): XmlNode {
  const roots: XmlNode[] = [], stack: XmlNode[] = [];
  let cursor = 0, count = 0, declaration = false;
  function addText(text: string, decode = true) {
    const value = decode ? decodeEntities(text) : text;
    if (stack.length) stack.at(-1)!.text += value;
    else if (value.trim()) failure("RPC 返回不是有效 XML");
  }
  while (cursor < xml.length) {
    if (xml[cursor] !== "<") {
      const end = xml.indexOf("<", cursor);
      const next = end < 0 ? xml.length : end;
      addText(xml.slice(cursor, next)); cursor = next; continue;
    }
    if (xml.startsWith("<!--", cursor)) {
      const end = xml.indexOf("-->", cursor + 4);
      if (end < 0 || xml.slice(cursor + 4, end).includes("--")) failure("RPC 返回无效 XML 注释");
      cursor = end + 3; continue;
    }
    if (xml.startsWith("<![CDATA[", cursor)) {
      const end = xml.indexOf("]]>", cursor + 9);
      if (end < 0 || !stack.length) failure("RPC 返回无效 XML 字符串");
      addText(xml.slice(cursor + 9, end), false); cursor = end + 3; continue;
    }
    if (xml.startsWith("<?xml", cursor)) {
      const end = xml.indexOf("?>", cursor + 5);
      const valid = /^<\?xml\s+version\s*=\s*(["'])1\.0\1(?:\s+encoding\s*=\s*(["'])(?:UTF-8|utf-8)\2)?(?:\s+standalone\s*=\s*(["'])(?:yes|no)\3)?\s*\?>$/;
      if (end < 0 || declaration || roots.length || stack.length || !valid.test(xml.slice(cursor, end + 2))) failure("RPC 返回无效 XML 声明");
      declaration = true; cursor = end + 2; continue;
    }
    const end = xml.indexOf(">", cursor + 1);
    if (end < 0) failure("RPC 返回不完整 XML");
    const tag = xml.slice(cursor, end + 1);
    const closing = /^<\/([A-Za-z][A-Za-z0-9_.:-]*)\s*>$/.exec(tag);
    if (closing) {
      if (stack.pop()?.name !== closing[1]) failure("RPC 返回 XML 层级错误");
    } else {
      const opening = /^<([A-Za-z][A-Za-z0-9_.:-]*)\s*(\/?)>$/.exec(tag);
      if (!opening || ++count > 2048 || stack.length >= 32) failure("RPC 返回不支持或过深的 XML");
      const node: XmlNode = { name: opening[1], text: "", children: [] };
      if (stack.length) stack.at(-1)!.children.push(node); else roots.push(node);
      if (!opening[2]) stack.push(node);
    }
    cursor = end + 1;
  }
  if (stack.length || roots.length !== 1) failure("RPC 返回 XML 根节点错误");
  return roots[0];
}
function children(node: XmlNode, expected: string[]) {
  if (node.text.trim() || node.children.length !== expected.length || node.children.some((child, index) => child.name !== expected[index])) failure("RPC 返回结构不兼容");
  return node.children;
}
function scalar(node: XmlNode) {
  if (node.children.length) failure("RPC 返回标量结构错误");
  return node.text;
}
function rpcValue(node: XmlNode): RpcValue {
  if (node.name !== "value") failure("RPC 返回值结构错误");
  if (!node.children.length) return scalar(node); // XML-RPC implicit string.
  if (node.children.length !== 1 || node.text.trim()) failure("RPC 返回值结构错误");
  const typed = node.children[0];
  if (typed.name === "string") return scalar(typed);
  if (typed.name === "boolean") {
    const value = scalar(typed).trim();
    if (value !== "0" && value !== "1") failure("RPC 返回布尔值无效");
    return value === "1";
  }
  if (["int", "i4", "i8", "double"].includes(typed.name)) {
    const text = scalar(typed).trim(), value = Number(text);
    if (!text || !Number.isFinite(value) || typed.name !== "double" && (!/^-?\d+$/.test(text) || !Number.isSafeInteger(value))) failure("RPC 返回数值无效");
    return value;
  }
  if (typed.name === "nil") { if (scalar(typed).trim()) failure("RPC 返回空值无效"); return null; }
  if (typed.name === "array") {
    const [data] = children(typed, ["data"]);
    if (data.text.trim() || data.children.some(child => child.name !== "value")) failure("RPC 返回数组结构错误");
    return data.children.map(rpcValue);
  }
  if (typed.name === "struct") {
    if (typed.text.trim() || typed.children.some(child => child.name !== "member")) failure("RPC 返回对象结构错误");
    const result: { [key: string]: RpcValue } = Object.create(null);
    for (const member of typed.children) {
      const [name, value] = children(member, ["name", "value"]), key = scalar(name);
      if (Object.hasOwn(result, key)) failure("RPC 返回重复字段");
      result[key] = rpcValue(value);
    }
    return result;
  }
  return failure("RPC 返回值类型不兼容");
}
function confirmResponse(xml: string) {
  const root = parseXml(xml);
  if (root.name !== "methodResponse") failure("RPC 返回不是 XML-RPC 响应");
  if (root.children.some(child => child.name === "fault")) failure("FreeCAD RPC 返回执行故障");
  const [params] = children(root, ["params"]), [param] = children(params, ["param"]), [value] = children(param, ["value"]);
  const result = rpcValue(value);
  if (!result || typeof result !== "object" || Array.isArray(result) || result.success !== true
    || typeof result.output !== "string" || result.output.trim() !== MARKER
    || Object.hasOwn(result, "error") && result.error !== "") failure("FreeCAD 未确认缩略图偏好已持久化");
}

async function responseXml(response: Response, signal: AbortSignal): Promise<string> {
  if (signal.aborted) failure("连接 FreeCAD RPC 超时");
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) failure("RPC 返回内容超过安全上限");
  if (!response.body) failure("RPC 返回内容为空");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { cancel(); failure("RPC 返回内容超过安全上限"); }
      chunks.push(value);
    }
    try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
    catch { return failure("RPC 返回不是有效 UTF-8 XML"); }
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

/** Persist only SaveThumbnail in the connected GUI process; fail closed. */
export async function ensureSaveThumbnail(): Promise<void> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; let expired = false;
  try {
    const rawPort = process.env.PHOENIX_FREECAD_RPC_PORT ?? "9875";
    if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) failure("FreeCAD RPC 端口必须为 1–65535 的整数");
    const token = process.env.PHOENIX_FREECAD_RPC_TOKEN;
    if (token && (token.length > 8192 || /[\x00-\x20\x7f]/.test(token))) failure("FreeCAD RPC 授权配置格式无效");
    const headers: Record<string, string> = { "Content-Type": "text/xml; charset=utf-8" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const body = `<?xml version="1.0"?><methodCall><methodName>execute_code</methodName><params><param><value><string>${xmlEscape(PYTHON)}</string></value></param><param><value><int>${RPC_TIMEOUT_SECONDS}</int></value></param></params></methodCall>`;
    const operation = (async () => {
      const response = await fetch(`http://127.0.0.1:${Number(rawPort)}/RPC2`, { method: "POST", headers, body, signal: controller.signal, redirect: "error" });
      if (!response.ok) failure(`FreeCAD RPC HTTP 请求失败（${response.status}）`);
      confirmResponse(await responseXml(response, controller.signal));
    })();
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; controller.abort(); reject(new PreferenceFailure("连接 FreeCAD RPC 超时")); }, REQUEST_TIMEOUT_MS); });
    await Promise.race([operation, timeout]);
  } catch (error) {
    const reason = expired ? "连接 FreeCAD RPC 超时" : error instanceof PreferenceFailure ? error.message : "无法连接或读取 FreeCAD RPC";
    // Never include external responses, URLs, headers or exception messages.
    throw new Error(`${reason}；${GUIDANCE}`);
  } finally { if (timer) clearTimeout(timer); controller.abort(); }
}
