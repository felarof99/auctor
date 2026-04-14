import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const workUnitArgs = {
  repoId: v.id('repos'),
  authorId: v.id('authors'),
  unitType: v.union(v.literal('pr'), v.literal('branch_day')),
  branch: v.string(),
  date: v.string(),
  prNumber: v.optional(v.number()),
  commitShas: v.array(v.string()),
  locAdded: v.number(),
  locRemoved: v.number(),
  locNet: v.number(),
  classificationType: v.union(
    v.literal('feature'),
    v.literal('bugfix'),
    v.literal('refactor'),
    v.literal('chore'),
    v.literal('test'),
    v.literal('docs'),
  ),
  difficultyLevel: v.union(
    v.literal('trivial'),
    v.literal('easy'),
    v.literal('medium'),
    v.literal('hard'),
    v.literal('complex'),
  ),
  impactScore: v.number(),
  reasoning: v.string(),
  locFactor: v.number(),
  formulaScore: v.number(),
  aiScore: v.number(),
  typeWeight: v.number(),
  difficultyWeight: v.number(),
  unitScore: v.number(),
}

export const exists = query({
  args: {
    repoId: v.id('repos'),
    authorId: v.id('authors'),
    date: v.string(),
    unitType: v.union(v.literal('pr'), v.literal('branch_day')),
    branch: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query('work_units')
      .withIndex('by_author', (q) =>
        q.eq('repoId', args.repoId).eq('authorId', args.authorId),
      )
      .collect()
    return candidates.some(
      (wu) =>
        wu.date === args.date &&
        wu.unitType === args.unitType &&
        wu.branch === args.branch,
    )
  },
})

export const getByRepoAndDateRange = query({
  args: {
    repoId: v.id('repos'),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('work_units')
      .withIndex('by_date', (q) =>
        q
          .eq('repoId', args.repoId)
          .gte('date', args.startDate)
          .lte('date', args.endDate),
      )
      .collect()
  },
})

export const getByAuthor = query({
  args: {
    repoId: v.id('repos'),
    authorId: v.id('authors'),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('work_units')
      .withIndex('by_author', (q) =>
        q.eq('repoId', args.repoId).eq('authorId', args.authorId),
      )
      .collect()
  },
})

export const insert = mutation({
  args: workUnitArgs,
  returns: v.id('work_units'),
  handler: async (ctx, args) => {
    return await ctx.db.insert('work_units', args)
  },
})
