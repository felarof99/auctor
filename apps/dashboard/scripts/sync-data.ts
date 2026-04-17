import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface SyncOptions {
  rootDir: string
  outDir: string
}

interface BundleEntry {
  name: string
  repos: string[]
}

interface Manifest {
  bundles: BundleEntry[]
}

export async function syncDashboardData(opts: SyncOptions): Promise<void> {
  const { rootDir, outDir } = opts

  mkdirSync(outDir, { recursive: true })

  const glob = new Bun.Glob('configs/*/.results/*.json')
  const matches = await Array.fromAsync(
    glob.scan({ cwd: rootDir, absolute: false, dot: true }),
  )

  const microscopeRe = /-microscope-/

  const bundleMap = new Map<string, string[]>()
  const expectedFiles = new Set<string>()

  for (const rel of matches) {
    const file = basename(rel)
    if (microscopeRe.test(file)) continue

    const bundleName = basename(dirname(dirname(rel)))
    const repoName = file.replace(/\.json$/, '')
    const outFile = `${bundleName}__${repoName}.json`

    const srcPath = join(rootDir, rel)
    const destPath = join(outDir, outFile)

    const contents = await Bun.file(srcPath).text()
    await Bun.write(destPath, contents)

    const repos = bundleMap.get(bundleName) ?? []
    if (!repos.includes(repoName)) repos.push(repoName)
    bundleMap.set(bundleName, repos)
    expectedFiles.add(outFile)
  }

  // Remove stale files (excluding manifest.json)
  const existing = readdirSync(outDir).filter(
    (f) => f.endsWith('.json') && f !== 'manifest.json',
  )
  for (const stale of existing) {
    if (!expectedFiles.has(stale)) {
      rmSync(join(outDir, stale))
    }
  }

  const bundles: BundleEntry[] = Array.from(bundleMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, repos]) => ({ name, repos: repos.slice().sort() }))

  const manifest: Manifest = { bundles }
  writeFileSync(
    join(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )

  const fileCount = expectedFiles.size
  const bundleCount = bundles.length
  console.log(`Synced ${fileCount} files across ${bundleCount} bundles`)
}

// CLI entry point
const scriptDir = import.meta.dir
const rootDir = resolve(scriptDir, '../../..')
const outDir = resolve(scriptDir, '../public/data')

await syncDashboardData({ rootDir, outDir })
