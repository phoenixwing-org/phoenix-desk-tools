# 测试工程外链（fixture symlink）

Phoenix 的部分 Code 回归（**成员排序**、**UUID 扫描**）依赖真实 C++/CAA 工程片段。完整工程体积大、含构建产物，**不提交进本仓库**；改为在本机 **clone 开源仓库** 后，用 **symlink** 挂到 `tests/fixtures/`。

## 外链清单

配置见 [`tests/fixtures/external-links.manifest.json`](../tests/fixtures/external-links.manifest.json)。

| 目录名 | 开源仓库 | 用途 |
| --- | --- | --- |
| `KtAlarmClock/` | [KtAlarmClock](https://gitee.com/PhoenixWing321/KtAlarmClock) | Kevin CAA Wizard 段（`KtAlarmClockParam.h/.cpp`）；成员排序批量回归 |
| `PNXCaaStudy/` | [PNXCaaStudy](https://gitee.com/PhoenixWing321/PNXCaaStudy.git) | CAA2 Wizard 控件段、`GUID {…}` 字面量；排序 / UUID 扫描 |

## 推荐目录布局

与 `phoenix-desk-tools` **同级** clone（上一级 `Kt/` 目录）：

```
Kt/
├── phoenix-desk-tools/     ← 本仓库
├── PNXCaaStudy/            ← git clone …/PNXCaaStudy.git
└── KtAlarmClock/           ← 可选；也可放在其它路径并用环境变量指定
```

## 一键链接

在仓库根执行：

```bash
python3 scripts/link_test_fixtures.py
# 或
./scripts/link_test_fixtures.sh
```

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
export PHOENIX_FIXTURE_KtAlarmClock=/Users/kathy/sam/KtAlarmClock
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
- 改 manifest 后重新跑 `link_test_fixtures.py`；错误 symlink 会被替换。

详见 [成员排序-锁定段与回归用例.md](成员排序-锁定段与回归用例.md)。
