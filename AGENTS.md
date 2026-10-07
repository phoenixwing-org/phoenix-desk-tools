# Desk Tools AI 开发约定

## Wing 联调真源

- 标准开发目录为 `phoenix-desk-tools/` 与 `phoenix-wing/` 并列。
- 根目录 `pnpm dev` 固定消费 manifest/lockfile 的 Registry Wing；`pnpm wing` 必须消费并列 `../phoenix-wing`，同时启动 Server 与 Web。找不到本地 Wing 时应停止，禁止静默回退 npm 包。
- 不得新增或恢复根级 `pnpm dev:registry`、`pnpm dev:local-wing`；日志中的 `[Wing][LOCAL]` / `[Wing][REGISTRY]` 是当前真源标识。
- 非标准目录可设置 `PHOENIX_WING_ROOT=/absolute/path/to/phoenix-wing`。`PHOENIX_WING_SRC` 仅为旧配置兼容入口，新脚本和文档不得继续推广它。

## 依赖安全边界

- 禁止为联调执行 `pnpm link`，也禁止把 Wing 改成 `link:`、`file:`、`workspace:` 或写入 `pnpm.overrides`。
- `package.json` 与 `pnpm-lock.yaml` 必须继续锁定 Registry 精确版本；本地切换只能发生在启动进程的 Vite alias、Node loader 和构建 resolver 中。
- 禁止为了切换 Wing 修改或覆盖 Desk 的 `node_modules`。运行 `pnpm verify:wing-dependencies` 检查该边界。
- 普通本地联调覆盖 aggregate 及 CAD、Code 忽略规则、数据库、Git、工作空间契约所需的 TypeScript 包。Desk 已不再消费 `kt-codegen` 与 `cad-rust-source`；Tauri 薄壳和原生发行制品仍走独立门禁。

## AI 点检命令

```bash
pnpm wing:check-local       # 只检查并列目录，不构建、不启动
pnpm test:local-wing        # 使用本地 Wing 跑消费端测试
pnpm build:local-wing       # 使用本地 Wing 构建 Web 与 Server bundle
pnpm verify:wing-dependencies
```

提交前只暂存本任务文件；不得顺带提交工作区中用户或其他任务的未提交文件。

## 私有工程与发布隐私边界

- 不以用户个人工程作为文档、教程、截图或单元测试范本；仅替换项目名不算完成脱敏。公开样本须独立构造，只表达必要的通用算法条件，不复刻真实零件清单、编号、型号、装配结构或几何。
- 必须用真实工程点检时，仅限本地、显式授权的范围；样本、绝对路径、截图、日志和映射表留在仓库外或已忽略的本地目录，不进入提交、CI 或发布包。仓库只保留不含项目细节的验收结论。
- 正式发布前，按最终压缩/整理后的提交内容与实际发布包复核源码、文档、测试夹具、配置、日志、截图和构建附带文件；同时核查发布历史范围。存在未解决的隐私项不得发布，不能仅以关键词无命中替代内容审查。
