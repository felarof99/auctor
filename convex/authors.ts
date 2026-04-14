import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getByRepo = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('authors')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect()
  },
})

export const getWhitelisted = query({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query('authors')
      .withIndex('by_repo', (q) => q.eq('repoId', args.repoId))
      .collect()
    return all.filter((a) => a.whitelisted)
  },
})

export const upsert = mutation({
  args: {
    repoId: v.id('repos'),
    username: v.string(),
    whitelisted: v.boolean(),
  },
  returns: v.id('authors'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('authors')
      .withIndex('by_repo_username', (q) =>
        q.eq('repoId', args.repoId).eq('username', args.username),
      )
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, { whitelisted: args.whitelisted })
      return existing._id
    }
    return await ctx.db.insert('authors', {
      repoId: args.repoId,
      username: args.username,
      whitelisted: args.whitelisted,
    })
  },
})
