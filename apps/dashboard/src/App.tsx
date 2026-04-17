import type { BundleAuthorStats } from '@auctor/shared/aggregate'
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
import type { BundleView } from '@/src/hooks/use-reports'
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

function AuthorTable({
  authors,
  query,
  sortKey,
  sortDir,
  onSort,
}: {
  authors: (RepoAuthorStats | BundleAuthorStats)[]
  query: string
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSort: (key: SortKey) => void
}) {
  const filtered = useMemo(() => {
    let list = authors
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((a) => a.author.toLowerCase().includes(q))
    }
    return [...list].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [authors, query, sortKey, sortDir])

  if (filtered.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No authors found</CardTitle>
          <CardDescription>
            {query ? 'Try a different search.' : 'No data available.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
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
              onSort={onSort}
            />
            <SortableHeader
              label="PRs"
              sortKey="prs"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="+LOC"
              sortKey="insertions"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="-LOC"
              sortKey="deletions"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="Net"
              sortKey="net"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="Score"
              sortKey="score"
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={onSort}
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
  )
}

function BundlePanel({ bundle }: { bundle: BundleView }) {
  const repoNames = Object.keys(bundle.repos)
  const hasAggregate = bundle.aggregate !== null

  // "aggregate" is a reserved tab value; repo tabs use the repo name
  const defaultTab = hasAggregate ? 'aggregate' : (repoNames[0] ?? '')
  const [selectedTab, setSelectedTab] = useState(defaultTab)

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const activeAuthors = useMemo(() => {
    if (selectedTab === 'aggregate' && bundle.aggregate) {
      return bundle.aggregate.authors
    }
    return bundle.repos[selectedTab]?.authors ?? []
  }, [selectedTab, bundle])

  const windowDays = useMemo(() => {
    if (selectedTab === 'aggregate' && bundle.aggregate) {
      return bundle.aggregate.window_days
    }
    return bundle.repos[selectedTab]?.window_days ?? null
  }, [selectedTab, bundle])

  const generatedAt = useMemo(() => {
    if (selectedTab === 'aggregate' && bundle.aggregate) {
      return bundle.aggregate.generated_at
    }
    return bundle.repos[selectedTab]?.generated_at ?? null
  }, [selectedTab, bundle])

  const showSecondaryTabs = hasAggregate
    ? repoNames.length > 0
    : repoNames.length > 1

  return (
    <div className="flex flex-col gap-4">
      {/* Window badge + secondary tabs row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {windowDays !== null && (
          <Badge variant="outline">{windowDays}d window</Badge>
        )}
      </div>

      {showSecondaryTabs && (
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList>
            {hasAggregate && (
              <TabsTrigger value="aggregate">Aggregate</TabsTrigger>
            )}
            {repoNames.map((repo) => (
              <TabsTrigger key={repo} value={repo}>
                {repo}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Search + count */}
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
          {activeAuthors.length} author{activeAuthors.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <AuthorTable
        authors={activeAuthors}
        query={query}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={handleSort}
      />

      {generatedAt && (
        <div className="text-muted-foreground text-xs">
          Generated {new Date(generatedAt).toLocaleString()}
        </div>
      )}
    </div>
  )
}

export function App() {
  const { bundles, bundleNames, loading, error, refresh } = useReports()
  const [selectedBundle, setSelectedBundle] = useState<string | null>(null)

  const activeBundleName = selectedBundle ?? bundleNames[0] ?? null
  const activeBundle = activeBundleName ? bundles[activeBundleName] : null

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
          <Button type="button" variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        </div>

        {/* Primary bundle tabs (only when >1 bundle) */}
        {bundleNames.length > 1 && (
          <Tabs
            value={activeBundleName ?? undefined}
            onValueChange={setSelectedBundle}
          >
            <TabsList>
              {bundleNames.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}

        {/* Active bundle content */}
        {activeBundle ? (
          <BundlePanel bundle={activeBundle} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>No data</CardTitle>
              <CardDescription>
                No bundles found in the manifest.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  )
}
