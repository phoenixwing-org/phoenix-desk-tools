# Phoenix 桌面辅助工具（Web）

## 快速启动

| 命令 | 启动内容 | 端口 |
|------|---------|------|
| `pnpm dev` | Node + Vite 全栈 | **49373** + Node 首选 **48375** |
| `pnpm dev:ui` | 仅 Vite 前端 | **49373** |
| `pnpm dev:server` | 仅 Node 后端 | 首选 **48375**，占用时向上寻找 |

## 首次

```bash
pnpm install
```

## 开发模式

改 Vue 源码后热更新；改 server 源码后 tsx watch 自动重启。
