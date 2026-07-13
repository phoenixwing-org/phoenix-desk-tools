import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
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

  it('返回 null 当本地 phoenix-wing 不存在', () => {
    mockExistsSync.mockReturnValue(false)

    const result = resolvePhoenixWingPath(userWebUiRoot)
    expect(result).toBeNull()
  })

  it('返回本地路径当 phoenix-wing 存在', () => {
    mockExistsSync.mockReturnValue(true)

    const result = resolvePhoenixWingPath(userWebUiRoot)
    expect(result).toBe(userPhoenixWingSrc)
  })
})
