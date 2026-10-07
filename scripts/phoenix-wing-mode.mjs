import fs from "node:fs";
import path from "node:path";

export const LOCAL_WING_PACKAGE_NAMES = Object.freeze([
  "@phoenix-wing/cad-contracts",
  "@phoenix-wing/cad-core",
  "@phoenix-wing/code-core",
  "@phoenix-wing/db-node",
  "@phoenix-wing/git-core",
  "@phoenix-wing/git-node",
  "@phoenix-wing/workspace-schema",
]);

const PACKAGE_DIRS = Object.freeze({
  "phoenix-wing": ".",
  "@phoenix-wing/cad-contracts": "packages/cad-contracts",
  "@phoenix-wing/cad-core": "packages/cad-core",
  "@phoenix-wing/code-core": "packages/code-core",
  "@phoenix-wing/db-node": "packages/db-node",
  "@phoenix-wing/git-core": "packages/git-core",
  "@phoenix-wing/git-node": "packages/git-node",
  "@phoenix-wing/workspace-schema": "packages/workspace-schema",
});

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function packageNameAndSubpath(specifier) {
  if (specifier === "phoenix-wing" || specifier.startsWith("phoenix-wing/")) {
    return {
      packageName: "phoenix-wing",
      subpath: specifier === "phoenix-wing" ? "." : `./${specifier.slice("phoenix-wing/".length)}`,
    };
  }
  if (!specifier.startsWith("@phoenix-wing/")) return null;
  const segments = specifier.split("/");
  const packageName = segments.slice(0, 2).join("/");
  if (!(packageName in PACKAGE_DIRS)) return null;
  return {
    packageName,
    subpath: segments.length === 2 ? "." : `./${segments.slice(2).join("/")}`,
  };
}

function selectExportTarget(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return value.import ?? value.default ?? null;
}

function sourcePathForBuildExport(packageRoot, exportTarget) {
  if (typeof exportTarget !== "string" || !exportTarget.startsWith("./dist/")) return null;
  const relativeBuildPath = exportTarget.slice("./dist/".length);
  const sourceStem = path.join(packageRoot, "src", relativeBuildPath.replace(/\.js$/u, ""));
  const candidates = [
    `${sourceStem}.ts`,
    `${sourceStem}.tsx`,
    `${sourceStem}.js`,
    `${sourceStem}.vue`,
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function createExactSourceExportAliases(wingRoot, packageName) {
  const packageRoot = path.join(wingRoot, PACKAGE_DIRS[packageName]);
  const manifest = readJson(path.join(packageRoot, "package.json"));
  const aliases = [];
  for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
    if (subpath === "." || !subpath.startsWith("./") || subpath.includes("*")) continue;
    const sourcePath = sourcePathForBuildExport(packageRoot, selectExportTarget(value));
    if (!sourcePath) continue;
    aliases.push({
      find: `${packageName}/${subpath.slice(2)}`,
      replacement: sourcePath,
    });
  }
  // Vite 的字符串 alias 会同时匹配其 `/` 子路径；长子路径必须排在父入口前面，
  // 例如 `ui/report-model` 不能先被 `ui` 改写成 `ui/index.ts/report-model`。
  return aliases.sort((left, right) => String(right.find).length - String(left.find).length);
}

function matchExport(exportsMap, subpath) {
  const exact = selectExportTarget(exportsMap?.[subpath]);
  if (exact) return exact;
  for (const [key, value] of Object.entries(exportsMap ?? {})) {
    const wildcard = key.indexOf("*");
    if (wildcard < 0) continue;
    const prefix = key.slice(0, wildcard);
    const suffix = key.slice(wildcard + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
    const captured = subpath.slice(prefix.length, subpath.length - suffix.length);
    const target = selectExportTarget(value);
    if (target) return target.replaceAll("*", captured);
  }
  return null;
}

function normalizeConfiguredRoot(deskRoot, configuredPath, legacySource) {
  const absolute = path.isAbsolute(configuredPath)
    ? path.normalize(configuredPath)
    : path.resolve(deskRoot, configuredPath);
  if (legacySource && path.basename(absolute) === "src") return path.dirname(absolute);
  return absolute;
}

export function assertLocalWingRoot(wingRoot) {
  const rootManifest = path.join(wingRoot, "package.json");
  if (!fs.existsSync(rootManifest)) {
    throw new Error(`本地 Wing 不存在：${wingRoot}\n若要测试 npm 正式包，请运行 pnpm dev`);
  }
  const rootPackage = readJson(rootManifest);
  if (rootPackage.name !== "phoenix-wing") {
    throw new Error(`PHOENIX_WING_ROOT 不是 phoenix-wing 仓库：${wingRoot}`);
  }
  for (const packageName of LOCAL_WING_PACKAGE_NAMES) {
    const manifest = path.join(wingRoot, PACKAGE_DIRS[packageName], "package.json");
    if (!fs.existsSync(manifest) || readJson(manifest).name !== packageName) {
      throw new Error(`本地 Wing 缺少包 ${packageName}：${manifest}`);
    }
  }
  return path.resolve(wingRoot);
}

/**
 * 只有根包装器显式传 PHOENIX_WING_MODE=local 才启用本地模式；任何未标 mode
 * 的 build/test/dev 子命令都保持 Registry，避免残留路径变量污染正式构建。
 * PHOENIX_WING_SRC 仅在 local mode 中兼容，并归一成 PHOENIX_WING_ROOT。
 */
export function resolvePhoenixWingContext(deskRoot, env = process.env) {
  const requestedMode = env.PHOENIX_WING_MODE?.trim().toLowerCase();
  if (requestedMode && requestedMode !== "local" && requestedMode !== "registry") {
    throw new Error(`PHOENIX_WING_MODE 仅支持 local 或 registry，当前为 ${requestedMode}`);
  }
  const configuredRoot = env.PHOENIX_WING_ROOT?.trim();
  const legacySource = env.PHOENIX_WING_SRC?.trim();
  const mode = requestedMode ?? "registry";
  if (mode === "registry") {
    return { mode, root: null, configuredBy: "package.json + pnpm-lock.yaml" };
  }
  const rawRoot = configuredRoot || legacySource || path.resolve(deskRoot, "../phoenix-wing");
  const root = normalizeConfiguredRoot(deskRoot, rawRoot, !configuredRoot && Boolean(legacySource));
  return {
    mode,
    root: assertLocalWingRoot(root),
    configuredBy: configuredRoot
      ? "PHOENIX_WING_ROOT"
      : legacySource
        ? "PHOENIX_WING_SRC（兼容）"
        : "并列仓库 ../phoenix-wing",
  };
}

/** 将浏览器消费入口指向 Wing 源码，支持 Vite 热更新并复用 Desk 的 Vue/Pinia singleton。 */
export function createPhoenixWingSourceAliases(wingRoot) {
  const aliases = [
    {
      find: "phoenix-wing/style.css",
      replacement: path.join(wingRoot, "dist/style.css"),
    },
    {
      find: /^phoenix-wing\/fixtures\/(.+)$/u,
      replacement: path.join(wingRoot, "fixtures", "$1"),
    },
    {
      find: /^@phoenix-wing\/code-core\/fixtures\/(.+)$/u,
      replacement: path.join(wingRoot, "packages/code-core/src/fixtures", "$1"),
    },
    {
      find: /^@phoenix-wing\/cad-contracts\/(fixtures|schemas)\/(.+)$/u,
      replacement: path.join(wingRoot, "packages/cad-contracts", "$1", "$2"),
    },
    {
      find: /^@phoenix-wing\/workspace-schema\/fixtures\/(.+)$/u,
      replacement: path.join(wingRoot, "packages/workspace-schema/fixtures", "$1"),
    },
  ];
  for (const packageName of ["phoenix-wing", ...LOCAL_WING_PACKAGE_NAMES]) {
    aliases.push(...createExactSourceExportAliases(wingRoot, packageName));
  }
  for (const packageName of LOCAL_WING_PACKAGE_NAMES) {
    aliases.push({
      find: packageName,
      replacement: path.join(wingRoot, PACKAGE_DIRS[packageName], "src"),
    });
  }
  aliases.push({ find: "phoenix-wing", replacement: path.join(wingRoot, "src") });
  return aliases;
}

/** 按各包 exports 将 Node/esbuild 消费入口解析到本地构建制品。 */
export function resolveLocalWingExport(wingRoot, specifier) {
  const parsed = packageNameAndSubpath(specifier);
  if (!parsed) return null;
  const packageRoot = path.join(wingRoot, PACKAGE_DIRS[parsed.packageName]);
  const manifest = readJson(path.join(packageRoot, "package.json"));
  const target = matchExport(manifest.exports, parsed.subpath);
  if (!target) {
    throw new Error(`本地 ${parsed.packageName} 未导出 ${parsed.subpath}`);
  }
  const resolved = path.resolve(packageRoot, target);
  if (!fs.existsSync(resolved)) {
    throw new Error(`本地 Wing 构建制品不存在：${resolved}；请通过 Desk 的 local-wing 命令启动`);
  }
  return resolved;
}

/** Type checking must consume the same public local exports as the running app. */
export function createPhoenixWingTypePaths(wingRoot) {
  const paths = {};
  for (const [name, relativeRoot] of Object.entries(PACKAGE_DIRS)) {
    const packageRoot = path.join(wingRoot, relativeRoot);
    const manifest = readJson(path.join(packageRoot, "package.json"));
    for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
      const declaration = typeof value === "object" && value !== null ? value.types : null;
      if (typeof declaration !== "string") continue;
      const target = path.resolve(packageRoot, declaration);
      if (!target.startsWith(`${packageRoot}${path.sep}`)) throw new Error(`本地 Wing 类型导出越界：${name}`);
      if (!target.includes("*") && !fs.existsSync(target)) throw new Error(`本地 Wing 公开类型缺失：${name}${subpath.slice(1)}`);
      paths[subpath === "." ? name : `${name}/${subpath.slice(2)}`] = [target];
    }
    if (!paths[name]) throw new Error(`本地 Wing 公开类型缺失：${name}`);
  }
  return paths;
}
