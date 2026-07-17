import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import { resolve } from 'path'
import os from 'node:os'
import path from 'node:path'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn() },
}))

import { resolvePhoenixWingPath } from './resolvePhoenixWing'

const mockExistsSync = vi.mocked(fs.existsSync)
const userWebUiRoot = path.join(os.homedir(), 'phoenix', 'phoenix-desk-tools', 'web-ui')
const userPhoenixWingSrc = path.join(os.homedir(), 'phoenix', 'phoenix-wing', 'src')

describe('resolvePhoenixWingPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未显式配置时始终走锁定的 npm 包', () => {
    const result = resolvePhoenixWingPath(userWebUiRoot, undefined)
    expect(result).toBeNull()
    expect(mockExistsSync).not.toHaveBeenCalled()
  })

  it('显式配置且路径存在时返回本地源码路径', () => {
    mockExistsSync.mockReturnValue(true)

    const result = resolvePhoenixWingPath(userWebUiRoot, userPhoenixWingSrc)
    expect(result).toBe(userPhoenixWingSrc)
  })

  it('显式相对路径按 web-ui 根目录解析', () => {
    mockExistsSync.mockReturnValue(true)
    expect(resolvePhoenixWingPath(userWebUiRoot, '../../phoenix-wing/src')).toBe(userPhoenixWingSrc)
  })

  it('显式路径不存在时回退 npm 包', () => {
    mockExistsSync.mockReturnValue(false)
    expect(resolvePhoenixWingPath(userWebUiRoot, userPhoenixWingSrc)).toBeNull()
  })
})
