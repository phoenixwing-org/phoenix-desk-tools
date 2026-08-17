import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pnwAssetSpecifier = "phoenix-wing/assets/phoenix-wing-mark.svg";
const pnwScriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const pnwDeskRoot = path.resolve(pnwScriptDirectory, "..");
const pnwWebRequire = createRequire(path.join(pnwDeskRoot, "web-ui", "package.json"));
const pnwTarget = path.join(pnwDeskRoot, "web-ui", "public", "favicon.svg");
const pnwCheckOnly = process.argv.includes("--check");

function pnwResolveSource() {
  const pnwConfiguredRoot = process.env.PHOENIX_WING_ROOT?.trim();
  if (pnwConfiguredRoot) {
    return path.join(path.resolve(pnwConfiguredRoot), "assets", "phoenix-wing-mark.svg");
  }
  try {
    return pnwWebRequire.resolve(pnwAssetSpecifier);
  } catch (error) {
    throw new Error(
      `无法解析 ${pnwAssetSpecifier}。本地联调请通过 Desk local-wing 命令运行；Registry 模式需要包含该静态资产的 Wing 版本。\n${String(error)}`,
    );
  }
}

const pnwSource = pnwResolveSource();
if (!fs.existsSync(pnwSource)) {
  throw new Error(`Phoenix Wing 品牌 SVG 不存在：${pnwSource}`);
}

const pnwSourceBytes = fs.readFileSync(pnwSource);
const pnwTargetBytes = fs.existsSync(pnwTarget) ? fs.readFileSync(pnwTarget) : null;
const pnwMatches = pnwTargetBytes !== null && pnwSourceBytes.equals(pnwTargetBytes);

if (pnwCheckOnly) {
  if (!pnwMatches) {
    throw new Error(
      `Desk favicon 与 Phoenix Wing 权威资产不一致：${pnwTarget}\n`
      + "请在相同 Wing 模式下运行 pnpm brand:sync。",
    );
  }
  console.log(`[brand][check] ${pnwTarget} 与 ${pnwAssetSpecifier} 一致`);
  process.exit(0);
}

if (!pnwMatches) {
  fs.mkdirSync(path.dirname(pnwTarget), { recursive: true });
  fs.copyFileSync(pnwSource, pnwTarget);
}

const pnwSyncedBytes = fs.readFileSync(pnwTarget);
if (!pnwSourceBytes.equals(pnwSyncedBytes)) {
  throw new Error(`Phoenix Wing favicon 同步后校验失败：${pnwTarget}`);
}

console.log(`[brand][sync] ${pnwAssetSpecifier} -> ${pnwTarget}${pnwMatches ? "（已是最新）" : ""}`);
