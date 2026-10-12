import { Hono } from "hono";
import { CadIndexSearchError, searchCadIndex } from "./service.js";

export const cadIndexSearchRoutes = new Hono();
cadIndexSearchRoutes.get("/", c => {
  c.header("Cache-Control", "no-store");
  try { return c.json(searchCadIndex(c.req.query("workspace") || "", c.req.query("q") || "")); }
  catch (error) {
    if (error instanceof CadIndexSearchError) {
      return c.json({ detail: error.message, code: error.code, diagnostics: error.diagnostics }, error.status);
    }
    return c.json({ detail: "CAD 索引读取失败，请刷新诊断。", code: "index_unreadable" }, 503);
  }
});
