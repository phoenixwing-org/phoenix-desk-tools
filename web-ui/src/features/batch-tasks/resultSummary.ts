import type { BatchStep } from "../../../../shared/batch-tasks/contracts";

export interface BatchResultFact { label: string; value: string; mono?: boolean }
export interface BatchResultTable { title: string; columns: string[]; rows: string[][] }
export interface BatchResultSummary {
  title: string;
  facts: BatchResultFact[];
  tables: BatchResultTable[];
  notices: string[];
  raw: string | null;
}
type Data = Record<string, unknown>;
const record = (value: unknown): Data => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const rows = (value: unknown): Data[] => Array.isArray(value) ? value.map(record) : [];
const text = (value: unknown): string => typeof value === "string" ? value || "（空）" : "未知";
const count = (value: unknown): string => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? String(value) : "未知";
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
const hash = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value) ? value : "未取得有效 SHA-256";

export function formatBatchResultBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return "大小未知";
  if (value < 1024) return `${value} bytes`;
  const unit = value < 1024 ** 2 ? "KiB" : value < 1024 ** 3 ? "MiB" : "GiB";
  const divisor = unit === "KiB" ? 1024 : unit === "MiB" ? 1024 ** 2 : 1024 ** 3;
  return `${value} bytes（${(value / divisor).toFixed(2)} ${unit}）`;
}
function raw(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? "未取得原始结果"; }
  catch { return "原始结果无法序列化"; }
}
function cachedBox(value: unknown): string {
  const box = record(value), dimensions = [box.x_mm, box.y_mm, box.z_mm];
  if (!dimensions.every((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0) || !dimensions.some(n => n > 0)) return "未取得可解释的缓存尺寸";
  return `${dimensions.map(n => Number(n.toFixed(3))).join(" × ")} mm`;
}
const reasonLabels: Record<string, string> = {
  database_missing: "尚无尺寸缓存数据库", table_missing: "尚无尺寸缓存表", row_missing: "当前文件没有尺寸缓存",
  unsupported_schema: "缓存结构不受支持", unsupported_algorithm: "缓存算法版本不受支持",
  invalid_record: "缓存记录无效", record_too_large: "缓存记录超过读取上限",
};
const ownLabel = (labels: Record<string, string>, value: unknown): string | undefined => typeof value === "string" && Object.hasOwn(labels, value) ? labels[value] : undefined;

/** Presentation only: no domain inference, runtime API or authority is derived from an observation. */
export function summarizeBatchStepResult(step: BatchStep): BatchResultSummary {
  const summary: BatchResultSummary = { title: "观察结果", facts: [], tables: [], notices: [], raw: step.result === undefined ? null : raw(step.result) };
  if (step.result === undefined) {
    summary.notices.push(step.message || (step.status === "pending" ? "步骤尚未开始，暂无结果" : step.status === "running" ? "正在采集，结果尚未返回" : "本步骤未返回观察结果"));
    return summary;
  }
  const result = record(step.result);
  const fact = (label: string, value: string, mono = false) => summary.facts.push({ label, value, ...(mono ? { mono: true } : {}) });
  const table = (title: string, columns: string[], values: string[][]) => { if (values.length) summary.tables.push({ title, columns, rows: values }); };
  switch (step.action_key) {
    case "file.metadata":
      summary.title = "文件基本信息";
      fact("文件大小", formatBatchResultBytes(result.bytes)); fact("后缀", text(result.extension)); fact("SHA-256", hash(result.sha256), true);
      break;
    case "file.text-stats":
      summary.title = "文本统计";
      fact("编码", text(result.encoding)); fact("行数", count(result.lines)); fact("字符数", count(result.characters)); fact("词数", count(result.words));
      summary.notices.push("只统计文本，不保存或显示文件原文。");
      break;
    case "cad.saved-properties": {
      summary.title = "CAD 已保存属性";
      fact("来源", result.source === "saved_document_xml" ? "已保存 Document.xml（未打开 FreeCAD）" : "来源未知");
      fact("对象数", Array.isArray(result.objects) ? String(result.objects.length) : "未知");
      table("对象属性", ["节点", "类型", "标签", "零件号", "版本", "零件名称", "类型码", "系列", "材料文字"], rows(result.objects).map(object => {
        const properties = record(object.properties);
        return [text(object.name), text(object.type), text(object.label), text(properties.PartNumber), text(properties.PartVersion), text(properties.PartName), text(properties.PartType), text(properties.ModelSeries), text(object.material ?? properties.PartMaterial)];
      }));
      summary.notices.push("材料仅为保存的文字，不代表物性、密度或重量；没有计算质量。");
      break;
    }
    case "cad.saved-links":
      summary.title = "CAD 已保存链接";
      fact("保存的链接条目", count(result.link_count));
      table("保存的引用（保留重复）", ["引用文件", "显示标签"], rows(result.links).map(link => [text(link.file), text(link.label)]));
      summary.notices.push("未读取或解析目标。显示标签可能回退宿主 Label；条目数不等于 BOM 或采购数量。");
      break;
    case "cad.saved-drawing": {
      summary.title = "CAD 已保存图纸摘要";
      const counts = record(result.counts), structure = record(result.structured_fields);
      fact("TechDraw 对象", count(counts.techdraw_objects)); fact("页面", count(counts.pages)); fact("已知类型视图", count(counts.views)); fact("尺寸对象", count(counts.dimensions));
      table("类型统计", ["类型", "数量"], rows(result.types).map(type => [text(type.type), count(type.count)]));
      table("图纸对象", ["节点", "类型", "标签"], rows(result.objects).map(object => [text(object.name), text(object.type), text(object.label)]));
      table("结构信息", ["项目", "结果"], [["页面与视图", structure.page_view_links], ["模板链接", structure.template_links], ["图框文字", structure.editable_texts], ["尺寸引用", structure.dimension_references]].map(([label, value]) => [String(label), value === "unknown" ? "未知（未投影）" : "未知（未核验）"]));
      summary.notices.push("仅统计已保存的对象类型，不验证页面、投影或尺寸有效性；未归类类型不表示没有视图。");
      break;
    }
    case "cad.geometry-cache": {
      summary.title = "现有尺寸缓存";
      const status = ownLabel({ missing: "缺失", unknown: "未知", invalid: "无效", record: "已有记录" }, result.status);
      fact("缓存状态", status || "未知"); fact("新鲜度", "未验证（unverified）");
      if (result.reason !== undefined) fact("原因", ownLabel(reasonLabels, result.reason) || text(result.reason));
      if (result.status === "record") { fact("缓存 XYZ", cachedBox(result.cached_box)); fact("缓存更新时间", text(result.updated_at)); fact("缓存算法版本", count(result.algorithm_version)); }
      summary.notices.push("现有缓存不是本次新测尺寸；未核验依赖，不刷新业务缓存，不写 CAD。");
      break;
    }
    case "cad.name-audit": {
      summary.title = "所选整批名称查重";
      fact("选中文件", count(result.selected)); fact("可解析名称", count(result.inspected));
      fact("完整性", result.complete === true ? "已比较完整冻结选择集" : result.complete === false ? "部分名称需人工确认" : "未知");
      const groups = [["完全同名", result.exact_filename_duplicates], ["跨平台名称冲突", result.portable_filename_collisions], ["名称身份重复", result.identity_duplicates]] as const;
      for (const [label, values] of groups) {
        fact(`${label}组数`, Array.isArray(values) ? String(values.length) : "未知");
        table(label, ["分组标识", "文件"], rows(values).map(group => [text(group.key), Array.isArray(group.paths) ? stringList(group.paths).join("\n") || "未知" : "未知"]));
      }
      table("需人工确认", ["文件", "原因"], rows(result.manual).map(item => [text(item.rel), text(item.reason)]));
      summary.notices.push("仅比较所选冻结文件；文件名身份不是已保存的零件号/版本、几何或装配实例，不会合并、删除或改名。");
      if (result.schema_version === 1 && result.scope === "explicit_selection" && result.source === "display_filename" && result.complete === true && groups.every(([, values]) => Array.isArray(values) && values.length === 0)) summary.notices.push("所选冻结范围未发现上述重复，不代表整个工作空间没有重复。");
      break;
    }
    default:
      summary.title = "未识别的观察结果";
      summary.notices.push("此动作尚无专用摘要，请展开原始结果核对；不会由展示推断执行权限。");
  }
  summary.notices.push(...stringList(result.warnings));
  summary.notices = [...new Set(summary.notices)];
  return summary;
}
