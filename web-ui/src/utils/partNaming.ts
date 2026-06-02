/** 与后端 ``PartNamingParser.parse_part_key_text`` 对齐的 Part Key 解析。 */

export type ParsedPartKey = {
  part_number: string;
  part_version: string;
  part_key: string;
};

const PART_KEY_TEXT = /^(\d+(?:\.\d+)?)\.(\d{1,3})$/;

function normalizePartVersion(pv: string): string {
  const s = pv.trim();
  if (!s) return "";
  return s.length < 3 ? s.padStart(3, "0") : s;
}

/** 解析用户输入的 Part Key（如 ``8001.001``）。 */
export function parsePartKeyText(raw: string): ParsedPartKey | null {
  const s = raw.trim();
  if (!s) return null;
  const m = PART_KEY_TEXT.exec(s);
  if (!m) return null;
  const pn = m[1];
  const pv = normalizePartVersion(m[2]);
  return { part_number: pn, part_version: pv, part_key: `${pn}.${pv}` };
}
