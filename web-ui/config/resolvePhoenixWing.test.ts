import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn() },
}))

import { resolvePhoenixWingPath } from './resolvePhoenixWing'

const mockExistsSync = vi.mocked(fs.existsSync)

describe('resolvePhoenixWingPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('返回 null 当本地 phoenix-wing 不存在', () => {
    mockExistsSync.mockReturnValue(false)

    const result = resolvePhoenixWingPath('/Users/kathy/phoenix/phoenix-desk-tools/web-ui')
    expect(result).toBeNull()
  })

  it('返回本地路径当 phoenix-wing 存在', () => {
    mockExistsSync.mockReturnValue(true)

    const result = resolvePhoenixWingPath('/Users/kathy/phoenix/phoenix-desk-tools/web-ui')
    expect(result).toBe('/Users/kathy/phoenix/phoenix-wing/src')
  })
})
