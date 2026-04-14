import type { RepoAuthorStats } from '@auctor/shared/report'
import { RefreshCw, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useReports } from '@/src/hooks/use-reports'

type SortKey = keyof Pick<
  RepoAuthorStats,
  'score' | 'commits' | 'prs' | 'insertions' | 'deletions' | 'net'
>

const RANK_COLORS: Record<number, string> = {
  1: 'text-yellow-400',
  2: 'text-gray-300',
  3: 'text-amber-600',
}

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
}: {
  label: string
  sortKey: SortKey
  currentSort: SortKey
  currentDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const isActive = currentSort === sortKey
  return (
    <th
      className="cursor-pointer select-none px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider hover:text-foreground"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {isActive ? (currentDir === 'desc' ? ' \u2193' : ' \u2191') : ''}
    </th>
  )
}

export function App() {
  const { reports, repoNames, loading, error, refresh } = useReports()
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const activeRepo = selectedRepo ?? repoNames[0] ?? null
  const report = activeRepo ? reports[activeRepo] : null

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const filtered = useMemo(() => {
    if (!report) return []
    let authors = report.authors
    const q = query.trim().toLowerCase()
    if (q) {
      authors = authors.filter((a) => a.author.toLowerCase().includes(q))
    }
    const sorted = [...authors].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return sorted
  }, [report, query, sortKey, sortDir])

  if (loading) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <Skeleton className="mb-4 h-8 w-48" />
          <Skeleton className="mb-8 h-4 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">
                Failed to load data
              </CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-sm">
              Make sure <code>public/data/manifest.json</code> exists and lists
              valid repo JSON files.
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="font-semibold text-2xl leading-none">auctor</h1>
            <div className="text-muted-foreground text-sm">
              Engineering Productivity Leaderboard
            </div>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <Badge variant="outline">{report.window_days}d window</Badge>
            )}
            <Button type="button" variant="outline" size="sm" onClick={refresh}>
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Repo Tabs */}
        {repoNames.length > 1 && (
          <Tabs value={activeRepo ?? undefined} onValueChange={setSelectedRepo}>
            <TabsList>
              {repoNames.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by author name..."
              className="pl-9"
            />
          </div>
          <Badge variant="secondary">
            {filtered.length} author{filtered.length !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Leaderboard Table */}
        {filtered.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No authors found</CardTitle>
              <CardDescription>
                {query
                  ? 'Try a different search.'
                  : 'No data available for this repo.'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Rank
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                    Author
                  </th>
                  <SortableHeader
                    label="Commits"
                    sortKey="commits"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="PRs"
                    sortKey="prs"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="+LOC"
                    sortKey="insertions"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="-LOC"
                    sortKey="deletions"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Net"
                    sortKey="net"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortableHeader
                    label="Score"
                    sortKey="score"
                    currentSort={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {filtered.map((author, i) => {
                  const rank = i + 1
                  return (
                    <tr
                      key={author.author}
                      className="border-border border-b last:border-0 hover:bg-muted/30"
                    >
                      <td
                        className={cn(
                          'px-4 py-3 font-bold',
                          RANK_COLORS[rank] ?? 'text-muted-foreground',
                        )}
                      >
                        {rank}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {author.author}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {author.commits}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {author.prs}
                      </td>
                      <td className="px-4 py-3 text-right text-green-400">
                        {formatNumber(author.insertions)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatNumber(author.deletions)}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {formatNumber(author.net)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-indigo-400">
                        {author.score.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        {report && (
          <div className="text-muted-foreground text-xs">
            Generated {new Date(report.generated_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}
