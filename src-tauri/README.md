# Phoenix Tauri shell

The Rust shell owns the local Hono process lifecycle. In development it launches the checked-out TypeScript server with the installed Node.js runtime. A production build embeds a target-platform Node runtime, the compiled server bundle, SQLite WASM, native FCStd tools, and the external-engine adapter resources.

Install the Tauri 2 CLI once, then use the root scripts:

```powershell
cargo install tauri-cli --version "^2.6" --locked
pnpm tauri:dev
pnpm tauri:build
```

`pnpm tauri:build` is intentionally strict: `pnpm build:native`, the server bundle smoke test, and runtime resource staging must all succeed before packaging starts.
