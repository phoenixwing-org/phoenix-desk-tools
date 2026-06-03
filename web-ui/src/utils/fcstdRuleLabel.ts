/** 与后端 ``compose_fcstd_body_label_display`` 对齐的规则显示名。 */

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
 * 有零件号/版本时优先用 PartName 组合（与后端 compose 一致），避免索引里截断的 label/rule_label 盖掉全名。
 */
export function resolveRuleLabelForNode(node: RuleLabelNodeFields): string {
  const { pn, pv } = partKeyFields(node);
  const composed = composeFcstdBodyLabelDisplay(
    pn,
    pv,
    node.PartName ?? "",
    node.label ?? "",
  );
  if (composed) return composed;

  const fromApi = node.rule_label?.trim();
  if (fromApi) return fromApi;

  return (node.basename ?? "").trim();
}
