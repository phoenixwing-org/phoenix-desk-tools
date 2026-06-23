import { serve } from "@hono/node-server";
import { createCaaApp } from "./routes/dialog.js";

const port = Number(process.env.CAA_SERVER_PORT || 5180);

const app = createCaaApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CAA server http://127.0.0.1:${info.port}`);
});
