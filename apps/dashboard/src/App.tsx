import { createClient } from '@supabase/supabase-js'
import {
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  RefreshCw,
  Repeat2,
  Search,
  TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type Tweet = {
  tweet_id: string
  tweet_url: string
  author_handle: string
  author_name: string
  content: string
  posted_at: string | null
  extracted_at: string | null
  likes: number | null
  retweets: number | null
  replies: number | null
  views: number | null
  links: string[] | null
  ext_velocity_score: number | null
  ext_velocity_rank: number | null
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

function formatCompactInt(n: number) {
  return new Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n)
}

function formatLocalDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

function sinceIso(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

export function App() {
  const [tweets, setTweets] = useState<Tweet[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [query, setQuery] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const loadTweets = useCallback(async () => {
    if (!supabase) return

    setLoading(true)
    setError(null)
    try {
      const since = sinceIso(24)
      const { data, error: qErr } = await supabase
        .from('tweets')
        .select(
          [
            'tweet_id',
            'tweet_url',
            'author_handle',
            'author_name',
            'content',
            'posted_at',
            'extracted_at',
            'likes',
            'retweets',
            'replies',
            'views',
            'links',
            'ext_velocity_score',
            'ext_velocity_rank',
          ].join(','),
        )
        .gte('extracted_at', since)
        .order('extracted_at', { ascending: false })
        .limit(250)

      if (qErr) throw new Error(qErr.message)

      setTweets((data ?? []) as unknown as Tweet[])
      setLastUpdatedAt(new Date().toISOString())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTweets()
  }, [loadTweets])

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => {
      loadTweets()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [autoRefresh, loadTweets])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tweets
    return tweets.filter((t) => {
      const haystack = [
        t.author_handle,
        t.author_name,
        t.content,
        t.tweet_url,
        ...(t.links ?? []),
      ]
        .filter(Boolean)
        .join('\n')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [tweets, query])

  if (!supabase) {
    return (
      <div className="min-h-dvh bg-background text-foreground">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <Card>
            <CardHeader>
              <CardTitle>Twitter Extractor Dashboard</CardTitle>
              <CardDescription>
                Missing Supabase env vars. Set these in `apps/dashboard/.env`
                (or export them before running Vite):
              </CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <pre className="overflow-auto rounded-md border bg-muted p-3">
                {`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}
              </pre>
              <div className="mt-4 text-muted-foreground">
                Your Supabase table should be named `tweets` (see
                `apps/extractor/sql/schema.sql`).
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="text-muted-foreground text-sm">Supabase</div>
            <h1 className="font-semibold text-2xl leading-none">
              Extracted Tweets (Last 24h)
            </h1>
            <div className="text-muted-foreground text-sm">
              {lastUpdatedAt ? (
                <>Last updated {formatLocalDateTime(lastUpdatedAt)}</>
              ) : (
                <>Not updated yet</>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              <TrendingUp className="size-4" />
              Auto-refresh: {autoRefresh ? 'On' : 'Off'}
            </Button>
            <Button type="button" onClick={loadTweets} disabled={loading}>
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by author, content, URL, link..."
              className="pl-9"
            />
          </div>
          <Badge variant="secondary">{filtered.length} tweets</Badge>
          <Badge variant="outline">
            Window since {formatLocalDateTime(sinceIso(24))}
          </Badge>
        </div>

        {error ? (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Query failed</CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        <Separator />

        <div className="flex flex-col gap-4">
          {loading && tweets.length === 0 ? (
            <>
              <Card>
                <CardHeader>
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-72" />
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-11/12" />
                  <Skeleton className="h-4 w-10/12" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-6 w-24" />
                </CardFooter>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-4 w-52" />
                  <Skeleton className="h-3 w-64" />
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-10/12" />
                </CardContent>
                <CardFooter>
                  <Skeleton className="h-6 w-28" />
                </CardFooter>
              </Card>
            </>
          ) : filtered.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No tweets found</CardTitle>
                <CardDescription>
                  Either nothing was extracted in the last hour, or your
                  Supabase RLS policy blocks anon reads.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                Check `apps/extractor/sql/schema.sql` and ensure the extractor
                is writing to the same project/table.
              </CardContent>
            </Card>
          ) : (
            filtered.map((t) => (
              <Card key={t.tweet_id} className="py-5">
                <CardHeader className="pb-0">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{t.author_name}</span>
                    <span className="font-normal text-muted-foreground">
                      @{t.author_handle}
                    </span>
                    {t.ext_velocity_rank != null ? (
                      <Badge variant="secondary">
                        rank {t.ext_velocity_rank}
                      </Badge>
                    ) : null}
                    {t.ext_velocity_score != null ? (
                      <Badge variant="outline">
                        v {t.ext_velocity_score.toFixed(2)}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {t.posted_at ? (
                      <>Posted {formatLocalDateTime(t.posted_at)}</>
                    ) : (
                      <>Posted time unknown</>
                    )}
                    {t.extracted_at ? (
                      <> · Extracted {formatLocalDateTime(t.extracted_at)}</>
                    ) : null}
                  </CardDescription>
                  <CardAction>
                    <Button asChild variant="outline" size="sm">
                      <a href={t.tweet_url} target="_blank" rel="noreferrer">
                        <ExternalLink className="size-4" />
                        Open
                      </a>
                    </Button>
                  </CardAction>
                </CardHeader>

                <CardContent className="pt-0">
                  <div className="whitespace-pre-wrap text-sm leading-6">
                    {t.content}
                  </div>

                  {t.links && t.links.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.links.slice(0, 8).map((u) => (
                        <Badge key={u} variant="outline" asChild>
                          <a
                            href={u}
                            target="_blank"
                            rel="noreferrer"
                            className="max-w-full truncate"
                            title={u}
                          >
                            {u}
                          </a>
                        </Badge>
                      ))}
                      {t.links.length > 8 ? (
                        <Badge variant="secondary">+{t.links.length - 8}</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </CardContent>

                <CardFooter className="flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    <Heart className="size-3" />
                    {formatCompactInt(t.likes ?? 0)}
                  </Badge>
                  <Badge variant="secondary">
                    <Repeat2 className="size-3" />
                    {formatCompactInt(t.retweets ?? 0)}
                  </Badge>
                  <Badge variant="secondary">
                    <MessageCircle className="size-3" />
                    {formatCompactInt(t.replies ?? 0)}
                  </Badge>
                  <Badge variant="secondary">
                    <Eye className="size-3" />
                    {formatCompactInt(t.views ?? 0)}
                  </Badge>
                </CardFooter>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
