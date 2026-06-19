# C++ 类成员排序（reorder_members）

> [文档索引](../文档索引.md) · 实现：`phoenix/code/reorder_members.py` · Web：`/api/code/reorder-members/*` · 页面 **C++ 成员排序**

按 **cxx-code-style** 规则重排 `.h` / `.hpp` / `.cpp` 中类内成员声明与实现顺序，并规范化 `.cpp` 内分隔注释与初始化列表写法。

---

## 1. Web 用法

1. 侧栏打开 **C++ 成员排序**（`reorder_members`）。
2. 页面自动使用 **当前 Phoenix 工作空间根** 作为 C++ 源码树（换工程请在 **配置** 里切换工作空间）。
3. **刷新列表**：列出工作空间下 **一级目录** 与 **一级** `.h` / `.hpp` / `.cpp` 文件（带「目录 / 文件」类型）；其余项按忽略规则隐藏。
4. **勾选**要处理的条目（至少一项）。
5. 选项：`.cpp` / 头文件勾选、详细日志；**成员变量字母序** Web 暂禁用（见 [成员变量字母序-规则与待实现.md](成员变量字母序-规则与待实现.md)）。
6. **预检**（不写盘）或 **执行排序**（直接写盘，无需先预检）。

偏好保存在工作空间 `.phoenix/phoenix-workspace-prefs.json` 的 `code_reorder` 段（选项与上次勾选）。

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

## 3. 排序规则（摘要）

### `.cpp`

- 特殊成员顺序：默认构造 → 其它构造 → 析构 → 拷贝/移动构造 → `operator=`；
- 其余按函数名 **不区分大小写字母序**；同名 overload 保持源码相对顺序；
- 去掉函数间空行；缺少 `//---` 分隔符时补上；
- Leading 注释随函数移动；
- 成员初始化列表使用 `()` 而非 `{}`（如 `build_(100101)`）。

### `.h`

- 每个 `public:` / `protected:` / `private:`（及 `slots`）段内：特殊成员同上，再按字母序；
- 成员变量默认 **保持源码顺序与位置**；完整字母序 + 编号联动见 [成员变量字母序-规则与待实现.md](成员变量字母序-规则与待实现.md)（Web 未开放）。
- 支持 `class ExportedByModule ClassName` 等导出宏。

完整规则见脚本顶部 docstring 与 cxx-code-style skill。

---

## 4. API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/code/reorder-members/prefs` | 读偏好 |
| PUT | `/api/code/reorder-members/prefs` | 写偏好 |
| GET | `/api/code/reorder-members/top-level` | 一级目录+文件；含 `entries[]`（`kind`: dir/file）、`ignored`、`ignore_patterns` |
| POST | `/api/code/reorder-members/run` | `{ targets: string[], dry_run?: bool, …options }` |

---

## 5. 后续可扩展

- [ ] **保护区**：clang-format off/on、CAA Wizard 段 — 见 [成员排序-保护区与回归用例.md](成员排序-保护区与回归用例.md)
- [ ] 单文件 / 单类预览 diff（Web）
- [ ] **成员变量字母序（完整）**：编号重编、`.h`/`.cpp` 构造析构序号一致等 — 见 [成员变量字母序-规则与待实现.md](成员变量字母序-规则与待实现.md)
- [ ] 与 Git 状态联动（仅排序已修改文件）
- [ ] `code/` 模块配置：`app_config.modules` 切换 CAD / Code 导航集
- [ ] 批量任务队列 + 取消（统一运行日志）

---

*2026-06*
