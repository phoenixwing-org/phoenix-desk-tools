// Compatibility CLI only: use the packaged Node/entry selected by the shared
// real-HTTP recovery runner, not a fixed port or a discovered user instance.
if (process.argv.length !== 2) throw new Error("usage: node scripts/smoke-tauri-runtime.mjs");
process.argv.push("runtime");
await import("./smoke-workspace-recovery.mjs");
