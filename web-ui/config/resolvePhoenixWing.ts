import fs from 'fs'
import { resolve } from 'path'

/**
 * 检测上级目录是否存在 phoenix-wing 本地源码。
 * 存在则返回本地路径（用于 Vite alias），否则返回 null（走 npm 版本）。
 */
export function resolvePhoenixWingPath(
  projectRoot: string,
  relativePath = '../../phoenix-wing/src',
): string | null {
  const localSrc = resolve(projectRoot, relativePath)
  return fs.existsSync(localSrc) ? localSrc : null
}
