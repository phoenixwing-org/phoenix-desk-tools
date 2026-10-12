// Compatibility CLI only: lifecycle, environment and endpoint ownership remain
// in the shared real-HTTP recovery runner. No independent port/shutdown path.
if (process.argv.length !== 2) throw new Error("usage: node scripts/smoke-server-bundle.mjs");
process.argv.push("bundle");
await import("./smoke-workspace-recovery.mjs");
