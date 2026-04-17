import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addRepo,
  findRepoByPath,
  loadBundle,
  mergeEngineers,
  saveBundle,
} from './bundle'
import type { BundleConfig } from './types'

const tmpDirs: string[] = []
function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'auctor-bundle-test-'))
  tmpDirs.push(d)
  return d
}
afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

const base: BundleConfig = {
  name: 'browseros',
  repos: [{ name: 'main', path: '/tmp/main' }],
  engineers: ['alice'],
}

describe('saveBundle + loadBundle', () => {
  test('roundtrips a bundle through YAML', async () => {
    const dir = mkTmp()
    const path = join(dir, 'browseros.yaml')
    await saveBundle(path, {
      ...base,
      server_url: 'https://server',
      convex_url: 'https://convex',
      aliases: { alice: ['Alice Example', 'alice@example.com'] },
    })
    const loaded = await loadBundle(path)
    expect(loaded.name).toBe('browseros')
    expect(loaded.server_url).toBe('https://server')
    expect(loaded.convex_url).toBe('https://convex')
    expect(loaded.repos).toEqual([{ name: 'main', path: '/tmp/main' }])
    expect(loaded.engineers).toEqual(['alice'])
    expect(loaded.aliases).toEqual({
      alice: ['Alice Example', 'alice@example.com'],
    })
  })

  test('loadBundle throws when file does not exist', async () => {
    await expect(loadBundle('/does/not/exist.yaml')).rejects.toThrow(
      /not found/i,
    )
  })

  test('loadBundle throws when YAML is missing required fields', async () => {
    const dir = mkTmp()
    const path = join(dir, 'bad.yaml')
    await Bun.write(path, 'name: test\n')
    await expect(loadBundle(path)).rejects.toThrow(/repos/)
  })
})

describe('addRepo', () => {
  test('appends a new repo', () => {
    const out = addRepo(base, { name: 'docs', path: '/tmp/docs' })
    expect(out.repos).toHaveLength(2)
    expect(out.repos[1]).toEqual({ name: 'docs', path: '/tmp/docs' })
  })

  test('is idempotent when same path is added twice', () => {
    const out = addRepo(base, { name: 'main', path: '/tmp/main' })
    expect(out.repos).toHaveLength(1)
  })

  test('does not mutate the input', () => {
    const snapshot = JSON.stringify(base)
    addRepo(base, { name: 'docs', path: '/tmp/docs' })
    expect(JSON.stringify(base)).toBe(snapshot)
  })
})

describe('mergeEngineers', () => {
  test('unions usernames without duplicates', () => {
    const out = mergeEngineers(base, ['alice', 'bob'])
    expect(out.engineers.sort()).toEqual(['alice', 'bob'])
  })

  test('preserves existing ordering then appends new', () => {
    const out = mergeEngineers({ ...base, engineers: ['alice', 'bob'] }, [
      'carol',
      'alice',
    ])
    expect(out.engineers).toEqual(['alice', 'bob', 'carol'])
  })
})

describe('findRepoByPath', () => {
  test('returns the matching repo', () => {
    const r = findRepoByPath(base, '/tmp/main')
    expect(r?.name).toBe('main')
  })

  test('returns null when no match', () => {
    expect(findRepoByPath(base, '/tmp/nope')).toBeNull()
  })
})
