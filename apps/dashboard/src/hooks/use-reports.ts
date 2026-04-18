import type { BundleAggregate } from '@auctor/shared/aggregate'
import { aggregateBundle } from '@auctor/shared/aggregate'
import type { RepoReport } from '@auctor/shared/report'
import { useCallback, useEffect, useState } from 'react'

export interface BundleView {
  name: string
  repos: Record<string, RepoReport>
  aggregate: BundleAggregate | null
}

interface UseReportsResult {
  bundles: Record<string, BundleView>
  bundleNames: string[]
  resultRoots: ResultRootOption[]
  selectedResultRoot: string
  setSelectedResultRoot: (path: string) => void
  loading: boolean
  syncing: boolean
  error: string | null
  refresh: () => Promise<void>
}

interface ManifestBundle {
  name: string
  repos: string[]
}

export interface ResultRootOption {
  label: string
  path: string
}

export function useReports(): UseReportsResult {
  const [bundles, setBundles] = useState<Record<string, BundleView>>({})
  const [bundleNames, setBundleNames] = useState<string[]>([])
  const [resultRoots, setResultRoots] = useState<ResultRootOption[]>([
    { label: 'out', path: 'out' },
  ])
  const [selectedResultRoot, setSelectedResultRoot] = useState('out')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cacheKey = Date.now()
      const manifestRes = await fetch(`/data/manifest.json?t=${cacheKey}`, {
        cache: 'no-store',
      })
      if (!manifestRes.ok) throw new Error('Failed to load manifest.json')
      const manifest: { bundles: ManifestBundle[] } = await manifestRes.json()

      if (manifest.bundles.length === 0) {
        setBundles({})
        setBundleNames([])
        return
      }

      const bundleViews = await Promise.all(
        manifest.bundles.map(async (b) => {
          const repoEntries = await Promise.all(
            b.repos.map(async (repo) => {
              const filename = `${b.name}__${repo}.json`
              const res = await fetch(`/data/${filename}?t=${cacheKey}`, {
                cache: 'no-store',
              })
              if (!res.ok) throw new Error(`Failed to load ${filename}`)
              const report: RepoReport = await res.json()
              return [repo, report] as const
            }),
          )
          const repos = Object.fromEntries(repoEntries)
          const repoReports = Object.values(repos)
          const aggregate =
            repoReports.length > 0 ? aggregateBundle(repoReports) : null
          const view: BundleView = { name: b.name, repos, aggregate }
          return [b.name, view] as const
        }),
      )

      setBundles(Object.fromEntries(bundleViews))
      setBundleNames(bundleViews.map(([name]) => name))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const loadResultRoots = useCallback(async () => {
    try {
      const res = await fetch('/api/result-roots', { cache: 'no-store' })
      if (!res.ok) throw new Error('No result root API')
      const data: { roots?: ResultRootOption[] } = await res.json()
      const roots = data.roots?.filter((root) => root.path && root.label) ?? []
      if (roots.length === 0) return
      setResultRoots(roots)
      setSelectedResultRoot((current) =>
        roots.some((root) => root.path === current) ? current : roots[0].path,
      )
    } catch {
      setResultRoots([{ label: 'out', path: 'out' }])
    }
  }, [])

  const refresh = useCallback(async () => {
    setSyncing(true)
    setError(null)
    try {
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceRoot: selectedResultRoot }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        output?: string
      }
      if (!res.ok) throw new Error(data.error ?? 'sync.sh failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setLoading(false)
    } finally {
      setSyncing(false)
    }
  }, [load, selectedResultRoot])

  useEffect(() => {
    loadResultRoots()
    load()
  }, [load, loadResultRoots])

  return {
    bundles,
    bundleNames,
    resultRoots,
    selectedResultRoot,
    setSelectedResultRoot,
    loading,
    syncing,
    error,
    refresh,
  }
}
