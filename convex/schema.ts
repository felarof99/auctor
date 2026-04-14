import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  repos: defineTable({
    name: v.string(),
  }).index('by_name', ['name']),

  authors: defineTable({
    repoId: v.id('repos'),
    username: v.string(),
    whitelisted: v.boolean(),
  })
    .index('by_repo', ['repoId'])
    .index('by_repo_username', ['repoId', 'username']),

  work_units: defineTable({
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
  })
    .index('by_repo', ['repoId'])
    .index('by_author', ['repoId', 'authorId'])
    .index('by_date', ['repoId', 'date']),

  analysis_runs: defineTable({
    repoId: v.id('repos'),
    timeWindow: v.string(),
    analyzedAt: v.string(),
    daysInWindow: v.number(),
    authorScores: v.array(
      v.object({
        authorId: v.id('authors'),
        username: v.string(),
        commits: v.number(),
        locAdded: v.number(),
        locRemoved: v.number(),
        locNet: v.number(),
        score: v.number(),
      }),
    ),
  })
    .index('by_repo', ['repoId'])
    .index('by_repo_date', ['repoId', 'analyzedAt']),
})
