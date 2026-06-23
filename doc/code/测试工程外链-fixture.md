# 测试工程外链

Phoenix 的部分 Code 回归（**成员排序**、**UUID 扫描**）依赖真实 C++/CAA 工程片段。完整工程体积大、含构建产物，**不提交进本仓库**；改为在本机 **clone 开源仓库** 后，用 **symlink** 挂到 `tests/fixtures/`。

## 两层配置

| 层级 | 文件 | 提交 Git | 内容 |
| --- | --- | --- | --- |
| **内置清单** | [`phoenix/config/test_fixture_catalog.json`](../phoenix/config/test_fixture_catalog.json) | 是 | 已编码的开源工程：名称、Gitee `clone_url`、fixture 路径、用途说明 |
| **本机偏好** | `launcher.json` → `test_fixtures` | 否 | 用户检出根目录、`enabled` 勾选列表 |

Web **系统 → 引用测试工程** 读取内置清单展示卡片；勾选与检出目录写入本机 `launcher.json`。

## 内置工程

配置见 [`phoenix/config/test_fixture_catalog.json`](../phoenix/config/test_fixture_catalog.json)。

| 目录名 | 开源仓库 | 用途 |
| --- | --- | --- |
| `KtAlarmClock/` | [KtAlarmClock](https://gitee.com/PhoenixWing321/KtAlarmClock) | Kevin CAA Wizard 段（`KtAlarmClockParam.h/.cpp`）；成员排序批量回归 |
| `PNXCaaStudy/` | [PNXCaaStudy](https://gitee.com/PhoenixWing321/PNXCaaStudy.git) | CAA2 Wizard 控件段、`GUID {…}` 字面量；排序 / UUID 扫描；**CAA 对话框**样例（见 [CAA模块-概览](../caa/CAA模块-概览.md)） |

## 推荐目录布局

与 `phoenix-desk-tools` **同级** clone（上一级 `Kt/` 目录）：

```
Kt/
├── phoenix-desk-tools/     ← 本仓库
├── PNXCaaStudy/            ← git clone …/PNXCaaStudy.git
└── KtAlarmClock/           ← 可选；也可放在其它路径并用环境变量指定
```

## 一键链接（Web 推荐）

**系统 → 引用测试工程**：勾选工程、确认检出根目录（默认同级源码目录），**勾选即自动初始化**（git clone + symlink）。本机偏好写入 `launcher.json` 的 `test_fixtures` 段。

命令行仍可用：

```bash
python scripts/link_test_fixtures.py
```

需先在 Web 勾选启用，或设置 launcher `test_fixtures.enabled`。

成功后应出现：

```
tests/fixtures/KtAlarmClock   → …/KtAlarmClock
tests/fixtures/PNXCaaStudy    → …/PNXCaaStudy
```

`--dry-run` 只预览，不写 symlink。

### 环境变量

| 变量 | 说明 |
| --- | --- |
| `PHOENIX_FIXTURE_KtAlarmClock` | 覆盖 manifest，指向本机 KtAlarmClock 根目录 |
| `PHOENIX_FIXTURE_PNXCaaStudy` | 覆盖 manifest，指向本机 PNXCaaStudy 根目录 |
| `PHOENIX_SKIP_FIXTURE_LINKS=1` | Web 启动 / 脚本均跳过自动链接（CI 可用） |

示例（KtAlarmClock 不在仓库同级时）：

```bash
export PHOENIX_FIXTURE_KtAlarmClock=/path/to/KtAlarmClock
python3 scripts/link_test_fixtures.py
```

## Web 启动时自动链接

FastAPI 启动时会调用 `phoenix.testing.fixture_links.ensure_fixture_links_logged()`（与 runtime catalog 同步类似）。**仅当本机已 clone 且路径可解析时才创建 symlink**；找不到仓库时静默跳过，不影响 Web 使用。

## 仓库内最小片段（无需外链）

下列文件**已提交**，CI 与不 clone 外链的开发者仍可跑核心单测：

| 路径 | 说明 |
| --- | --- |
| `tests/fixtures/reorder_members/*.h` | 锁定段最小 `.h` 片段 |
| `tests/fixtures/reorder_members/pnx_caa2_widget_decl.h` | 摘自 PNX `PNXCurveDivisionDlg.h` 的 CAA2 控件段 |
| `tests/fixtures/uuid/` | UUID / GUID 形态小样本（摘自 PNXCaaStudy） |

完整工程外链用例在缺失目录时 **`@unittest.skipUnless`**，不会导致 CI 失败。

## 相关单测

| 测试 | 依赖外链 |
| --- | --- |
| `tests/test_reorder_avoidance_rules.py` | `KtAlarmClock`（kt-param-*）；`PNXCaaStudy`（pnx-curve-dlg，可选） |
| `tests/test_reorder_members_service.py` | `KtAlarmClock` 批量 dry-run |
| `tests/test_code_rename_engine.py` | `tests/fixtures/uuid/`（仓库内）；`PNXCaaStudy` 全树扫描（可选） |

## 约定

- **不要**把 `build/`、`.git` 等构建/版本目录提交进 `tests/fixtures/`。
- 若 `tests/fixtures/<名>` 已是**真实目录**（非 symlink），链接脚本**不会覆盖**。
- 改内置清单后重新同步；错误 symlink 会被替换。

详见 [成员排序-锁定段与回归用例.md](成员排序-锁定段与回归用例.md)。
