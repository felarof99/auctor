import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query('repos')
      .withIndex('by_name', (q) => q.eq('name', args.name))
      .first()
  },
})

export const getOrCreate = mutation({
  args: { name: v.string() },
  returns: v.id('repos'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('repos')
      .withIndex('by_name', (q) => q.eq('name', args.name))
      .first()
    if (existing) return existing._id
    return await ctx.db.insert('repos', { name: args.name })
  },
})
