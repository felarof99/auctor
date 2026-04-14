import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const authorScoreValidator = v.object({
  authorId: v.id('authors'),
  username: v.string(),
  commits: v.number(),
  locAdded: v.number(),
  locRemoved: v.number(),
  locNet: v.number(),
  score: v.number(),
})

export const getLatestByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('analysis_runs')
      .withIndex('by_repo_date', (q) => q.eq('repoId', args.repoId))
      .order('desc')
      .first()
  },
})

export const getByRepoAndTimeWindow = query({
  args: {
    repoId: v.id('repos'),
    timeWindow: v.string(),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query('analysis_runs')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .order('desc')
      .collect()
    return all.filter((r) => r.timeWindow === args.timeWindow)
  },
})

export const insert = mutation({
  args: {
    repoId: v.id('repos'),
    timeWindow: v.string(),
    analyzedAt: v.string(),
    daysInWindow: v.number(),
    authorScores: v.array(authorScoreValidator),
  },
  returns: v.id('analysis_runs'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('analysis_runs', args)
  },
})
