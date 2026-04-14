import { afterEach, describe, expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { RepoManager } from './manager'

const TEST_BASE = '/tmp/auctor-test-repos'

afterEach(() => {
  rmSync(TEST_BASE, { recursive: true, force: true })
})

describe('RepoManager', () => {
  describe('repoDir', () => {
    test('returns deterministic path containing sanitized URL', () => {
      const mgr = new RepoManager(TEST_BASE)
      const dir = mgr.repoDir('https://github.com/user/repo.git')
      expect(dir).toContain(TEST_BASE)
      expect(dir).toContain('github.com-user-repo')
      expect(dir).not.toContain('https')
      expect(dir).not.toContain('.git')
    })

    test('returns consistent path for same URL', () => {
      const mgr = new RepoManager(TEST_BASE)
      const a = mgr.repoDir('https://github.com/user/repo.git')
      const b = mgr.repoDir('https://github.com/user/repo.git')
      expect(a).toBe(b)
    })
  })
})
