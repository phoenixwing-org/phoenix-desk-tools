/** 文件改名 — 纯函数（校验 / 格式化 / FCStd 选项解析）。 */

// ---------- 校验 ----------

export interface RenameValidation {
  valid: boolean;
  error?: string;
}

const ILLEGAL_CHARS_RE = /[<>:"/\\|?*\x00-\x1f]/;

/** 校验改名目标：非空、不与当前名相同、无非法字符、无路径穿越、≤255 字符 */
export function validateRenameTarget(
  currentName: string,
  newName: string,
): RenameValidation {
  const cur = currentName.trim();
  const next = newName.trim();

  if (!next) return { valid: false, error: "目标文件名不能为空" };
  if (next === cur) return { valid: false, error: "目标文件名与当前名相同" };
  if (next.includes(".."))
    return { valid: false, error: "目标文件名不能包含路径穿越" };
  if (ILLEGAL_CHARS_RE.test(next))
    return { valid: false, error: "目标文件名包含非法字符" };
  if (next.length > 255)
    return { valid: false, error: "目标文件名不能超过 255 个字符" };

  return { valid: true };
}

// ---------- 文件类型 ----------

/** 检查仓库相对路径是否指向 FCStd 文件（不区分大小写） */
export function isFcstdFile(rel: string): boolean {
  return /\.fcstd$/i.test(rel.trim());
}

// ---------- 改名选项 ----------

export interface RenameOption {
  id: string;
  label: string;
  default: boolean;
  hint?: string;
}

/** 根据文件类型返回改名弹窗中可用的勾选项列表 */
export function resolveRenameOptions(fcstd: boolean): RenameOption[] {
  if (!fcstd) return [];
  return [
    {
      id: "fixXref",
      label: "修改引用 (XLink path)",
      default: true,
      hint: "扫描并修正宿主文档中的 XLink 文件路径",
    },
    {
      id: "syncLabels",
      label: "同步引用标签 (Label)",
      default: false,
      hint: "同步宿主文档中引用实例的显示标签为 CAD 索引规则名",
    },
    {
      id: "fixBasename",
      label: "引用名字 (basename)",
      default: false,
      hint: "修正仅按 basename 匹配的引用",
    },
  ];
}

// ---------- 显示 ----------

/** 格式化 ISO 时间戳为本地字符串，解析失败时返回原值 */
export function formatLogTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

/** 判断两次路径是否属于同一目录下的改名（目录部分相同） */
export function isSameDirPathRename(prev: string, next: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").trim();
  const a = norm(prev);
  const b = norm(next);
  if (a === b) return true;
  const slash = (s: string) => (s.includes("/") ? s.lastIndexOf("/") : -1);
  const ai = slash(a);
  const bi = slash(b);
  const ad = ai >= 0 ? a.slice(0, ai) : "";
  const bd = bi >= 0 ? b.slice(0, bi) : "";
  return ad === bd;
}
