# 禁止使用 better-sqlite3

**原因：** `better-sqlite3` 在 `pnpm install` 时需要 C++ 编译器进行原生编译，导致跨平台和环境问题。

**替代方案：** 已统一使用 `node-sqlite3-wasm`（纯 WASM，无需编译）。

- ❌ **不要** 安装或导入 `better-sqlite3` 或 `@types/better-sqlite3`
- ✅ **始终** 使用 `node-sqlite3-wasm`（已封装在 `phoenix-wing/db/pnwDbAdapter`）
- 数据库操作通过 `pnwCreateDb(dbPath)` 获取 `PnwDbAdapter` 实例
- API 调用方式：使用 `db.run/get/all/exec` 而非 `db.prepare(sql).run/get/all`
- 事务使用手动 `BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`（`node-sqlite3-wasm` 不支持 `db.transaction(fn)`）

**导入方式:**
```ts
import { pnwCreateDb, type PnwDbAdapter } from 'phoenix-wing/db/pnwDbAdapter'
```
