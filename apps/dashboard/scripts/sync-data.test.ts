import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncDashboardData } from './sync-data'

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2))
}

describe('syncDashboardData', () => {
  let rootDir: string
  let outDir: string

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'auctor-sync-root-'))
    outDir = mkdtempSync(join(tmpdir(), 'auctor-sync-out-'))
  })

  afterEach(() => {
    // tmp dirs cleaned up by OS; explicit cleanup optional
  })

  function makeResultFile(bundle: string, repo: string, data?: unknown): void {
    const resultsDir = join(rootDir, 'configs', bundle, '.results')
    mkdirSync(resultsDir, { recursive: true })
    writeJson(join(resultsDir, `${repo}.json`), data ?? { bundle, repo })
  }

  it('copies per-repo files with bundle__repo naming', async () => {
    makeResultFile('browseros', 'browseros-main', {
      bundle: 'browseros',
      repo: 'browseros-main',
    })
    makeResultFile('browseros', 'browseros-docs', {
      bundle: 'browseros',
      repo: 'browseros-docs',
    })

    await syncDashboardData({ rootDir, outDir })

    const mainPath = join(outDir, 'browseros__browseros-main.json')
    const docsPath = join(outDir, 'browseros__browseros-docs.json')
    const mainData = JSON.parse(readFileSync(mainPath, 'utf8'))
    const docsData = JSON.parse(readFileSync(docsPath, 'utf8'))

    expect(mainData).toEqual({ bundle: 'browseros', repo: 'browseros-main' })
    expect(docsData).toEqual({ bundle: 'browseros', repo: 'browseros-docs' })
  })

  it('writes manifest.json with sorted bundles and repos', async () => {
    makeResultFile('zebra', 'zebra-repo')
    makeResultFile('alpha', 'alpha-b')
    makeResultFile('alpha', 'alpha-a')

    await syncDashboardData({ rootDir, outDir })

    const manifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    )
    expect(manifest).toEqual({
      bundles: [
        { name: 'alpha', repos: ['alpha-a', 'alpha-b'] },
        { name: 'zebra', repos: ['zebra-repo'] },
      ],
    })
  })

  it('skips microscope files', async () => {
    makeResultFile('browseros', 'browseros-main')
    // microscope file — should be skipped
    const resultsDir = join(rootDir, 'configs', 'browseros', '.results')
    writeJson(
      join(resultsDir, 'browseros-microscope-alice-20260417-1030.json'),
      { type: 'microscope' },
    )

    await syncDashboardData({ rootDir, outDir })

    const manifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    )
    expect(manifest.bundles[0].repos).toEqual(['browseros-main'])

    // microscope file must not appear in outDir
    const outFiles = Bun.spawnSync(['ls', outDir]).stdout.toString()
    expect(outFiles).not.toContain('microscope')
  })

  it('removes stale files from outDir', async () => {
    // Pre-populate a stale file in outDir
    writeFileSync(join(outDir, 'old-bundle__old-repo.json'), '{}')

    makeResultFile('browseros', 'browseros-main')

    await syncDashboardData({ rootDir, outDir })

    const outFiles = Bun.spawnSync(['ls', outDir]).stdout.toString()
    expect(outFiles).not.toContain('old-bundle__old-repo.json')
    expect(outFiles).toContain('browseros__browseros-main.json')
  })

  it('keeps manifest.json when removing stale files', async () => {
    writeFileSync(join(outDir, 'stale.json'), '{}')
    makeResultFile('browseros', 'browseros-main')

    await syncDashboardData({ rootDir, outDir })

    const manifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    )
    expect(manifest.bundles).toHaveLength(1)
  })

  it('handles empty source (no configs) gracefully', async () => {
    await syncDashboardData({ rootDir, outDir })

    const manifest = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf8'),
    )
    expect(manifest).toEqual({ bundles: [] })
  })

  it('creates outDir if it does not exist', async () => {
    const nonExistentOut = join(outDir, 'nested', 'deep')

    await syncDashboardData({ rootDir, outDir: nonExistentOut })

    const manifest = JSON.parse(
      readFileSync(join(nonExistentOut, 'manifest.json'), 'utf8'),
    )
    expect(manifest.bundles).toEqual([])
  })
})
