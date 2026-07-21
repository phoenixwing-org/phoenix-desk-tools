# Desk Tools AI 开发约定

## Wing 联调真源

- 标准开发目录为 `phoenix-desk-tools/` 与 `phoenix-wing/` 并列。
- 根目录 `pnpm dev` 必须消费并列 `../phoenix-wing`，同时启动 Server 与 Web；找不到本地 Wing 时应停止，禁止静默回退 npm 包。
- 需要与 npm 正式包对照时使用 `pnpm dev:registry`。日志中的 `[Wing][LOCAL]` / `[Wing][REGISTRY]` 是当前真源标识。
- 非标准目录可设置 `PHOENIX_WING_ROOT=/absolute/path/to/phoenix-wing`。`PHOENIX_WING_SRC` 仅为旧配置兼容入口，新脚本和文档不得继续推广它。

## 依赖安全边界

- 禁止为联调执行 `pnpm link`，也禁止把 Wing 改成 `link:`、`file:`、`workspace:` 或写入 `pnpm.overrides`。
- `package.json` 与 `pnpm-lock.yaml` 必须继续锁定 Registry 精确版本；本地切换只能发生在启动进程的 Vite alias、Node loader 和构建 resolver 中。
- 禁止为了切换 Wing 修改或覆盖 Desk 的 `node_modules`。运行 `pnpm verify:wing-dependencies` 检查该边界。
- 普通本地联调覆盖 aggregate、`@phoenix-wing/kt-codegen` 及 Server 使用的六个 TypeScript 包。Desk 已不再消费 `cad-rust-source`；Tauri 薄壳和原生发行制品仍走独立门禁。

## AI 点检命令

```bash
pnpm wing:check-local       # 只检查并列目录，不构建、不启动
pnpm test:local-wing        # 使用本地 Wing 跑消费端测试
pnpm build:local-wing       # 使用本地 Wing 构建 Web 与 Server bundle
pnpm verify:wing-dependencies
```

提交前只暂存本任务文件；不得顺带提交工作区中用户或其他任务的未提交文件。
