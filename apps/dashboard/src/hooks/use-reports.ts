import type { RepoReport } from '@auctor/shared/report'
import { useCallback, useEffect, useState } from 'react'

interface UseReportsResult {
  reports: Record<string, RepoReport>
  repoNames: string[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useReports(): UseReportsResult {
  const [reports, setReports] = useState<Record<string, RepoReport>>({})
  const [repoNames, setRepoNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const manifestRes = await fetch('/data/manifest.json')
      if (!manifestRes.ok) throw new Error('Failed to load manifest.json')
      const filenames: string[] = await manifestRes.json()

      const entries = await Promise.all(
        filenames.map(async (filename) => {
          const res = await fetch(`/data/${filename}`)
          if (!res.ok) throw new Error(`Failed to load ${filename}`)
          const report: RepoReport = await res.json()
          return [report.repo, report] as const
        }),
      )

      setReports(Object.fromEntries(entries))
      setRepoNames(entries.map(([name]) => name))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { reports, repoNames, loading, error, refresh: load }
}
