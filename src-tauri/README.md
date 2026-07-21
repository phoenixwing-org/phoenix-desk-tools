# Phoenix Tauri shell

The Rust shell owns the local Hono process lifecycle. In development it launches the checked-out TypeScript server with the installed Node.js runtime. A production build embeds a target-platform Node runtime, the compiled server bundle, SQLite WASM, native FCStd tools, and the external-engine adapter resources.

Install the Tauri 2 CLI once, then use the root scripts:

```powershell
cargo install tauri-cli --version "^2.6" --locked
pnpm tauri:dev
pnpm tauri:build
```

`pnpm tauri:build` is intentionally strict: `pnpm build:native`, the server bundle smoke test, and runtime resource staging must all succeed before packaging starts.

Release gates use `pnpm verify:tauri-release:macos` on macOS and `pnpm verify:tauri-release:windows` on Windows. Both launch the real packaged application with an absolute, temporary `PHOENIX_TAURI_USER_DATA_DIR`, discover the actual local API port from `service.v1.json`, exercise Codegen and FCStd through the packaged sidecar, close the application normally, and verify that the selected port is released. The Windows gate additionally installs and uninstalls the current NSIS and validates its registration.
