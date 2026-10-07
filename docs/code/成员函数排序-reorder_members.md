# C++ 类成员排序（reorder_members）

> 已退役（2026-10-04）：Desk 成员排序入口和专属实现已移除，以 KT Auto Code 为主。见 [当前边界](Desk-Code功能退役.md)。下文保留历史。

> [文档索引](../文档索引.md) · Web：`/api/code/reorder-members/*` · 页面 **C++ 成员排序**<br>
> 算法唯一规范：[phoenix-wing · C++成员排序算法规范](../../../phoenix-wing/docs/C++成员排序算法规范.md)。本文件只维护 DeskTools 的 Web/CLI、工作集与历史 Python 兼容入口。

按 **cxx-code-style** 规则重排 `.h` / `.hpp` / `.cpp` 中类内成员声明与实现顺序，并规范化 `.cpp` 内分隔注释与初始化列表写法。

---

## 1. Web 用法

1. 侧栏打开 **C++ 成员排序**（`reorder_members`）。
2. 页面自动使用 **当前 Phoenix 工作空间根** 作为 C++ 源码树（换工程请在 **配置** 里切换工作空间）。
3. **选择工作集**：页头 combo 下拉选择一个已归集文件的工作集。工作集内的路径（目录 + 文件）由后端 `workset_resolve` 展开为文件列表——目录递归扫描 `.h` / `.hpp` / `.cpp`，文件按扩展名筛选（详见 [FileWorkset-规划](../platform/FileWorkset-规划.md)）。
4. 可点 **预检** 预览解析出的文件列表（不写盘），确认无误后点 **执行排序**。
5. 选项：`.cpp` / 头文件勾选、详细日志；**成员变量字母序** Web 暂禁用（见 [成员变量字母序-规则与待实现.md](成员变量字母序-规则与待实现.md)）。

**编码**：CAA 工程常见 GBK 源文件；读写与 Code 批量改名共用 `detect_and_read`（UTF-8 → GBK），写回时尽量保持原编码。

偏好保存在工作空间 `.phoenix/phoenix-workspace-prefs.json` 的 `code_reorder` 段（选项与上次选中工作集）。

### 忽略列表

- **内置**：`.phoenix`、`web-ui`、`build`、`node_modules`、`dist` 等（见 `phoenix/code/reorder_ignore.py`）。
- **可选文件**：`.phoenix/reorder-members.ignore`（每行一条名称或通配符，`#` 注释；示例见 `phoenix/config/reorder-members.ignore.example`）。
- 以 `.` 开头的隐藏项始终忽略。

---

## 2. CLI

```bash
python -m phoenix.code.reorder_members /path/to/module [options]
```

| 选项 | 含义 |
| --- | --- |
| `--dry-run` | 只报告将变更的文件 |
| `--cpp-only` | 只处理 `.cpp` |
| `--header-only` | 只处理 `.h` / `.hpp` |
| `--sort-members` | `.h` 成员变量按字母序（**实验性**，见 [成员变量字母序-规则与待实现.md](成员变量字母序-规则与待实现.md)） |
| `--verbose` | 每文件打印 processing |

---

## 3. 算法与兼容边界

排序语义、锁定段、特殊成员顺序、保守跳过边界与回归规则均以 [Wing 规范](../../../phoenix-wing/docs/C++成员排序算法规范.md) 为准；不得在 DeskTools 再维护一份规则摘要。

`phoenix/code/reorder_members.py` 是历史兼容入口，不再是新规则的权威来源。DeskTools 的 `server/src/lib/reorderCppEngine.ts`、`reorderHeaderEngine.ts` 已兼容转发到 `phoenix-wing/code-core`。

---

## 4. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/code/reorder-members/prefs` | 读偏好 |
| PUT | `/api/code/reorder-members/prefs` | 写偏好 |
| GET | `/api/code/reorder-members/top-level` | **保留但 Web 不再使用**：一级目录+文件；CLI 及其他场景可继续调用 |
| POST | `/api/code/reorder-members/resolve` | **新**：传入 `repo_rel_paths`（从工作集取），后端调 `workset_resolve` 展开为文件列表，供预检预览 |
| POST | `/api/code/reorder-members/run` | `{ targets?: string[], repo_rel_paths?: string[], dry_run?: bool, …options }`；`repo_rel_paths` 经 `workset_resolve` 展开后与 `targets` 合并去重 |

---

## 5. 后续可扩展

- [x] **锁定段（P0）**：clang-format off/on、CAA Wizard 段；规则见 [Wing 规范](../../../phoenix-wing/docs/C++成员排序算法规范.md)，fixture 见 [成员排序-锁定段与回归用例.md](成员排序-锁定段与回归用例.md)
- [x] **工作集驱动选择（当前）**：页头 combo 选工作集 → `workset_resolve` 展开目录+筛选文件 → 预检/执行；见 [FileWorkset-规划](../platform/FileWorkset-规划.md)
- [x] **`#pragma region VirtualFunction`**：当前按通用 `#pragma region` 锁定，不另行赋予特殊排序语义。
- [ ] **PNX Cmd `.cpp` Wizard 段**：fixture `pnx_bom_analysis_cmd_min.cpp` 已摘录，单测待补
- [x] 写盘后 Git 对比 / Revert（Web）：由 Git 工作区插件提供；页面只消费其能力。
- [ ] **成员变量字母序（完整）**：编号重编、`.h`/`.cpp` 构造析构序号一致等 — 见 [成员变量字母序-规则与待实现.md](成员变量字母序-规则与待实现.md)
- [ ] 与 Git 状态联动（仅排序已修改文件）
- [ ] `code/` 模块配置：`app_config.modules` 切换 CAD / Code 导航集
- [ ] 批量任务队列 + 取消（统一运行日志）
- [ ] **算法语言评估**：`workset_resolve` 当前为 Python；后续可考虑 TS/Node.js 轻量版做纯路径计算（归一化、去嵌套），权衡见 [FileWorkset-规划](../platform/FileWorkset-规划.md)

---

*2026-06*
