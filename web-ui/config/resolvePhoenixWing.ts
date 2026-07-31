import fs from 'fs'
import { isAbsolute, resolve } from 'path'

export {
  createPhoenixWingSourceAliases,
  LOCAL_WING_PACKAGE_NAMES,
  resolvePhoenixWingContext,
} from '../../scripts/phoenix-wing-mode.mjs'

/**
 * 旧调用兼容层：仅在显式配置 PHOENIX_WING_SRC 时返回源码目录。
 * 新启动链统一使用 PHOENIX_WING_ROOT；此函数保留给旧配置与回归测试。
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
