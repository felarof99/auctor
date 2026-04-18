import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'

export interface SyncOptions {
  rootDir: string
  outDir: string
  resultsRoot?: string
}

interface BundleEntry {
  name: string
  repos: string[]
}

interface Manifest {
  bundles: BundleEntry[]
}

interface RepoReportRef {
  bundle: string
  repo: string
  sourcePath: string
  sourceRel: string
  mtimeMs: number
}

export async function syncDashboardData(opts: SyncOptions): Promise<void> {
  const { rootDir, outDir, resultsRoot = 'out' } = opts

  mkdirSync(outDir, { recursive: true })

  const reports = await findLatestRepoReports(rootDir, resultsRoot)

  const bundleMap = new Map<string, string[]>()
  const expectedFiles = new Set<string>()

  for (const report of reports) {
    const outFile = `${report.bundle}__${report.repo}.json`
    const srcPath = report.sourcePath
    const destPath = join(outDir, outFile)

    const contents = await Bun.file(srcPath).text()
    await Bun.write(destPath, contents)

    const repos = bundleMap.get(report.bundle) ?? []
    if (!repos.includes(report.repo)) repos.push(report.repo)
    bundleMap.set(report.bundle, repos)
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
  console.log(
    `Synced ${fileCount} files across ${bundleCount} bundles from ${resultsRoot}`,
  )
}

async function findLatestRepoReports(
  rootDir: string,
  resultsRoot: string,
): Promise<RepoReportRef[]> {
  const sourceRoot = resolveSourceRoot(rootDir, resultsRoot)
  const refs = await findRepoReportRefs(sourceRoot)
  const latestByRepo = new Map<string, RepoReportRef>()
  for (const ref of refs) {
    const key = `${ref.bundle}\0${ref.repo}`
    const current = latestByRepo.get(key)
    if (!current || isNewerReport(ref, current)) {
      latestByRepo.set(key, ref)
    }
  }
  return [...latestByRepo.values()].sort((a, b) => {
    const bundleSort = a.bundle.localeCompare(b.bundle)
    return bundleSort || a.repo.localeCompare(b.repo)
  })
}

async function findRepoReportRefs(
  sourceRoot: string,
): Promise<RepoReportRef[]> {
  if (!existsSync(sourceRoot)) return []

  const scanRoots = getScanRoots(sourceRoot)
  const refs: RepoReportRef[] = []
  for (const scan of scanRoots) {
    const glob = new Bun.Glob(scan.pattern)
    const matches = await Array.fromAsync(
      glob.scan({ cwd: scan.cwd, absolute: false, dot: true }),
    )
    for (const rel of matches) {
      if (basename(rel).includes('-microscope-')) continue
      const sourcePath = join(scan.cwd, rel)
      const report = await readRepoReportRef(sourcePath, rel)
      if (report) refs.push(report)
    }
  }
  return refs
}

function getScanRoots(sourceRoot: string): { cwd: string; pattern: string }[] {
  if (basename(sourceRoot) === 'results') {
    return [{ cwd: sourceRoot, pattern: '*.json' }]
  }
  if (existsSync(join(sourceRoot, 'results'))) {
    return [{ cwd: sourceRoot, pattern: 'results/*.json' }]
  }
  const roots = [{ cwd: sourceRoot, pattern: '*/results/*.json' }]
  if (basename(sourceRoot) === 'configs') {
    roots.push({ cwd: sourceRoot, pattern: '*/.results/*.json' })
  }
  return roots
}

async function readRepoReportRef(
  sourcePath: string,
  sourceRel: string,
): Promise<RepoReportRef | null> {
  try {
    const raw = await Bun.file(sourcePath).json()
    if (!raw || typeof raw !== 'object') return null
    const report = raw as Record<string, unknown>
    if (typeof report.bundle !== 'string') return null
    if (typeof report.repo !== 'string') return null
    if (!Array.isArray(report.authors)) return null
    return {
      bundle: report.bundle,
      repo: report.repo,
      sourcePath,
      sourceRel,
      mtimeMs: statSync(sourcePath).mtimeMs,
    }
  } catch {
    return null
  }
}

function resolveSourceRoot(rootDir: string, resultsRoot: string): string {
  if (isAbsolute(resultsRoot)) return resultsRoot
  return resolve(rootDir, resultsRoot)
}

function isNewerReport(
  candidate: RepoReportRef,
  current: RepoReportRef,
): boolean {
  if (candidate.mtimeMs !== current.mtimeMs) {
    return candidate.mtimeMs > current.mtimeMs
  }
  return candidate.sourceRel.localeCompare(current.sourceRel) > 0
}

function parseArgs(args: string[]): string {
  const rootIndex = args.indexOf('--root')
  if (rootIndex >= 0) return args[rootIndex + 1] ?? 'out'
  return process.env.AUCTOR_RESULTS_ROOT ?? 'out'
}

if (import.meta.main) {
  const scriptDir = import.meta.dir
  const rootDir = resolve(scriptDir, '../../..')
  const outDir = resolve(scriptDir, '../public/data')
  const resultsRoot = parseArgs(Bun.argv.slice(2))

  await syncDashboardData({ rootDir, outDir, resultsRoot })
}
