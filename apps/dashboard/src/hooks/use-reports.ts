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
  loading: boolean
  error: string | null
  refresh: () => void
}

interface ManifestBundle {
  name: string
  repos: string[]
}

export function useReports(): UseReportsResult {
  const [bundles, setBundles] = useState<Record<string, BundleView>>({})
  const [bundleNames, setBundleNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const manifestRes = await fetch('/data/manifest.json')
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
              const res = await fetch(`/data/${filename}`)
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

  useEffect(() => {
    load()
  }, [load])

  return { bundles, bundleNames, loading, error, refresh: load }
}
