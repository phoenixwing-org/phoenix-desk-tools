# Git 插件 · isomorphic-git 介绍与选型对比

> **主规划**：[Web壳层-Git工作区插件-规划.md](Web壳层-Git工作区插件-规划.md)  
> 类型：**技术选型说明**（非立项编码任务）  
> 结论：**Phoenix 壳层 Git 插件不采用 isomorphic-git**；采用 **本机 Git CLI + `phoenix/shell/git`**。  
> 最后更新：2026-06-23

---

## 1. isomorphic-git 是什么

[isomorphic-git](https://isomorphic-git.org/) 是 **纯 JavaScript 实现的 Git**，同一套 API 可在 **浏览器** 与 **Node.js** 中运行。在浏览器里通常配合 **内存文件系统** 使用，**不需要**用户安装 Git 可执行文件，适合在 Web 应用内「自带 Git 能力」。

| 项 | 说明 |
| --- | --- |
| **许可** | [MIT](https://github.com/isomorphic-git/isomorphic-git/blob/main/LICENSE.md) |
| **典型场景** | 在线 IDE、Git 教程、离线优先 Web 应用、无后端时的 clone/status/commit |
| **官方文档** | https://isomorphic-git.org/docs/en/

---

## 2. 核心依赖（使用前必须理解）

isomorphic-git **不**直接读写浏览器磁盘或用户 CAD 工作空间目录，而是依赖可注入的 **`fs`** 与 **`http`**：

| 依赖 | 作用 | 常见实现 |
| --- | --- | --- |
| **`fs`** | 模拟 POSIX 文件系统接口 | 浏览器：**[LightningFS](https://github.com/isomorphic-git/lightning-fs)**（内存盘）；Node：原生 `fs` |
| **`http`** | 与远程 Git HTTP 服务通信 | `/http/web`（Fetch）、`/http/node` |

浏览器中 **clone 远程仓** 往往还需 **CORS 代理**（如 `https://cors.isomorphic-git.org`），因 GitHub 等默认不允许浏览器直连 Git HTTP。

```text
浏览器典型数据流：

  GitHub / 远程 URL
        │  http (+ corsProxy)
        ▼
  isomorphic-git（内存中的 .git + 工作树）
        │  fs = LightningFS
        ▼
  与用户本机 CAD/Code 工作空间 **无直接对应**
```

---

## 3. 常用 API（与原生 Git 的对应关系）

| 操作 | isomorphic-git API | 说明 |
| --- | --- | --- |
| 状态 / 暂存 | `status`, `add` | 针对 **注入的 `dir` + `fs`** |
| 提交 | `commit` | 需 `author` 等对象字段 |
| 分支 / 引用 | `checkout`, `writeRef` | 在内存或 Node 目录仓内 |
| 历史 | `log` | 可浏览提交链 |
| 远程 | `clone`, `push`, `pull`（及 `fastForward` 等） | 依赖 `http`；浏览器受 CORS 限制 |

此外还有 CLI **`isogit`**，便于在 Node 环境脚本化测试。

---

## 4. 与 Phoenix 壳层 Git 插件的对比

| 维度 | isomorphic-git | Phoenix 规划（[主文档](Web壳层-Git工作区插件-规划.md)） |
| --- | --- | --- |
| **操作对象** | 注入 `fs` 下的虚拟目录（浏览器 多为 **内存**） | **`get_workspace()` 本机工作空间根** 真实文件 |
| **与业务写盘** | 业务工具写盘后，须 **再同步** 到 isomorphic-git 的 `fs` 才有 status/diff | 成员排序 / 改名等 **直接改磁盘** → `git status` 即见 |
| **Git 安装** | 浏览器侧 **不需要** 本机 `git` | 用户本机安装 Git；后端 **`subprocess git -C <工作空间根>`** |
| **远程** | clone / push / pull 是核心能力之一 | **明确不做** remote |
| **实现位置** | 前端 bundle（或 Node 侧库） | **`phoenix/shell/git/`** + `/api/git/*` 薄 HTTP |
| **与 Cursor SCM** | 语义不同（内存仓 vs 磁盘仓） | 与 IDE **同源**：本机仓 + CLI |
| **子模块 / 父仓** | 需自行建模 | **仅工作空间根 `.git`**；不操 submodule / 父仓（§2.3） |
| **许可与 AGPL** | MIT，**可**与 AGPL 项目组合 | **未引入**；否决理由为 **架构域**，非许可冲突 |

**一句话**：isomorphic-git 适合 **在 Web 里造一个 Git 仓**；Phoenix 需要 **在 Web 里管理用户盘上已有 Git 仓的改动**。

---

## 5. Phoenix 为何不采用（已定）

1. **真相源在磁盘**：CAD/Code 工具写盘路径即用户工程；引入 LightningFS 会形成 **第二套文件树**，同步成本高、易与真实工作空间不一致。  
2. **产品边界**：壳层 Git 插件不做 clone/push/CORS 远程；isomorphic-git 的优势区域与规划 **重叠少、耦合成本高**。  
3. **架构一致**：后台 Git 已在 `phoenix/shell/git` 独立包；前端只做 Git 页 / Tab，**不**嵌入完整 Git 引擎。  
4. **许可不是障碍**：MIT 与 AGPL-3.0 **可共存**；若仅因许可而排除需单独论证——本项 **不成立**。

---

## 6. 何时值得重新评估（低优先级）

仅当出现 **明确新产品** 且与当前规划 **不可兼得** 时，再开选型评审，例如：

- 必须在 **无 Python 后端、无本机 Git** 的纯静态页里完成 status/commit；  
- 需要 **内置 clone 公开教程仓** 的在线沙箱（与真实工作空间无关）；  
- 嵌入式环境 **无法** `subprocess git`，且无法要求用户安装 Git。

否则默认维持：**本机 Git CLI + 壳层 API**。

---

## 7. 相关链接

| 资源 | URL |
| --- | --- |
| isomorphic-git 官网 | https://isomorphic-git.org/ |
| API 索引 | https://isomorphic-git.org/docs/en/ |
| GitHub | https://github.com/isomorphic-git/isomorphic-git |
| LightningFS | https://github.com/isomorphic-git/lightning-fs |
| Phoenix Git 插件主规划 | [Web壳层-Git工作区插件-规划.md](Web壳层-Git工作区插件-规划.md) |
| 第三方许可表（§12） | 主规划 · [§12 第三方组件与许可](Web壳层-Git工作区插件-规划.md#12-第三方组件与许可) |

---

## 历史

- 2026-06-23：初稿（介绍 + 与 Phoenix 选型对比；主规划引用本页）
