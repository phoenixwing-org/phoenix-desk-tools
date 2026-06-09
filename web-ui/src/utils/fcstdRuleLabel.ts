/** 与后端 ``compose_fcstd_body_label_display`` 对齐的规则显示名。 */

/** 比较链接标签时归一化空白与常见连字符变体，避免肉眼相同却判为已改。 */
export function normalizeLinkLabel(s: string): string {
  return s
    .trim()
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212\uFF0D]/g, "-");
}

export function linkLabelsEqual(a: string, b: string): boolean {
  return normalizeLinkLabel(a) === normalizeLinkLabel(b);
}

export function composeFcstdBodyLabelDisplay(
  partNumber: string,
  partVersion: string,
  partName: string,
  labelFallback = "",
): string {
  const pn = partNumber.trim();
  const pv = partVersion.trim();
  const pname = (partName.trim() || labelFallback.trim());
  if (!pn || !pv) return "";
  if (!pname) return `${pn}.${pv}`;
  return `${pn}.${pv}-${pname}`;
}

export type RuleLabelNodeFields = {
  rule_label?: string;
  part_number?: string;
  part_version?: string;
  part_key?: string;
  PartName?: string;
  label?: string;
  basename?: string;
};

function partKeyFields(node: RuleLabelNodeFields) {
  let pn = node.part_number?.trim() ?? "";
  let pv = node.part_version?.trim() ?? "";
  if ((!pn || !pv) && node.part_key?.trim()) {
    const m = /^(\d+(?:\.\d+)?)\.(\d{1,3})$/.exec(node.part_key.trim());
    if (m) {
      pn = m[1];
      pv = m[2].length < 3 ? m[2].padStart(3, "0") : m[2];
    }
  }
  return { pn, pv };
}

/**
 * 装配树节点规则显示名。
 * 优先读 ``bom_xref`` 冗余列 ``rule_label``；无索引字段时再前端组合。
 */
export function resolveRuleLabelForNode(node: RuleLabelNodeFields): string {
  const fromApi = node.rule_label?.trim();
  if (fromApi) return fromApi;

  const { pn, pv } = partKeyFields(node);
  const composed = composeFcstdBodyLabelDisplay(
    pn,
    pv,
    node.PartName ?? "",
    node.label ?? "",
  );
  if (composed) return composed;

  return (node.basename ?? "").trim();
}
