import { serve } from "@hono/node-server";
import { refreshRuntimeCatalog } from "./routes/unit-tests.js";
import { setShellShutdownHandler } from "./routes/shell.js";
import { createPhoenixServerApp } from "./serverApp.js";
import { migrateLegacyRuntimeUserData } from "./lib/appRuntimePaths.js";

const port = Number(process.env.CAA_SERVER_PORT || 5180);

const userDataMigration = migrateLegacyRuntimeUserData();
if (userDataMigration.imported.length) {
  console.log(`[runtime] imported legacy user data: ${userDataMigration.imported.join(", ")}`);
}
if (userDataMigration.errors.length) {
  console.error(`[runtime] legacy user data import incomplete: ${userDataMigration.errors.join("; ")}`);
}

const app = createPhoenixServerApp();

// 启动检查
refreshRuntimeCatalog();

const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`Phoenix server http://127.0.0.1:${info.port}`);
  console.log(`  /api/caa/*  CAA 对话`);
  console.log(`  /api/cad/*  CAD 工具 (Node/Rust)`);
});

setShellShutdownHandler(() => {
  server.close();
});
