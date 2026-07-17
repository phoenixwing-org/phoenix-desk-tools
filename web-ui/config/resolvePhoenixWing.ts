import fs from 'fs'
import { isAbsolute, resolve } from 'path'

/**
 * 仅在显式配置 PHOENIX_WING_SRC 时启用源码联调 alias。
 * 默认始终消费 package.json 锁定的 npm 包，避免相邻仓库掩盖发布物问题。
 */
export function resolvePhoenixWingPath(
  projectRoot: string,
  configuredPath = process.env.PHOENIX_WING_SRC,
): string | null {
  if (!configuredPath?.trim()) return null
  const localSrc = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(projectRoot, configuredPath)
  return fs.existsSync(localSrc) ? localSrc : null
}
