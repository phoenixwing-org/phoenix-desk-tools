# Phoenix Tauri shell

The Rust shell owns only the desktop window and local Hono process lifecycle. In development it launches the checked-out TypeScript server with the installed Node.js runtime. A production build embeds a target-platform Node runtime, the compiled server bundle, SQLite WASM, and the external-engine adapter resources. FCStd ZIP/XML, BOM/XLink mutation, file discovery, and SQLite access run in TypeScript; the bundle no longer contains CAD Rust sidecars.

Install the Tauri 2 CLI once, then use the root scripts:

```powershell
cargo install tauri-cli --version "^2.6" --locked
pnpm tauri:dev
pnpm tauri:build
```

`pnpm tauri:dev` follows the repository development truth: it builds and consumes the sibling `../phoenix-wing` for both Vite and the Node service, and stops if that checkout is unavailable. Use `pnpm tauri:dev:registry` only to compare against the exact Registry versions in `package.json` and `pnpm-lock.yaml`.

`pnpm tauri:build` is intentionally strict: the Web/Server build and `pnpm build:tauri-runtime` bundle smoke/resource staging must succeed before packaging starts. Rust is still required to compile the Tauri shell itself, but there is no separate CAD native build.

Release gates use `pnpm verify:tauri-release:macos` on macOS and `pnpm verify:tauri-release:windows` on Windows. Both launch the real packaged application with an absolute, temporary `PHOENIX_TAURI_USER_DATA_DIR`, discover the actual local API port from `service.v1.json`, exercise Codegen and FCStd through the packaged sidecar, close the application normally, and verify that the selected port is released. The Windows gate additionally installs and uninstalls the current NSIS and validates its registration.
