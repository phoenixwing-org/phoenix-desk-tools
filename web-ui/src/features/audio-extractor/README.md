# 视频音频提取功能边界

本目录是 Desk Tools 内部的独立功能单元，为后续拆成可安装插件保留清晰边界。

- `audioExtraction.ts`：不依赖 Desk API 的浏览器媒体解码与 MP3 编码核心。
- `AudioExtractPage.vue`：Desk Workbench 页面适配，负责 Primary、状态栏和日志接入。
- `index.ts`：功能公开入口；宿主注册不得越过此目录引用内部实现。

文件只在浏览器或 Tauri WebView 内存中处理，不上传，也不经 Desk API。宿主侧只保留页面注册、Ribbon 图标、导航配置和帮助文案。未来插件化时应移动本目录并替换这些宿主注册点，不把媒体算法放入 Wing；Wing 仅提供通用工作台 UI。
