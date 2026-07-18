import { register } from "node:module";

if (process.env.PHOENIX_WING_MODE === "local") {
  const wingRoot = process.env.PHOENIX_WING_ROOT;
  if (!wingRoot) throw new Error("PHOENIX_WING_MODE=local 时必须设置 PHOENIX_WING_ROOT");
  register(new URL("./local-wing-loader.mjs", import.meta.url), {
    parentURL: import.meta.url,
    data: { wingRoot },
  });
}
