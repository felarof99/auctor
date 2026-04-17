import type { ConvexClient } from '@auctor/database/client'
import { createClient } from '@auctor/database/client'
import type { Classification, WorkUnit } from '@auctor/shared/classification'

// biome-ignore lint/suspicious/noExplicitAny: Convex _generated/api.ts not yet generated — replace with typed imports after `npx convex dev`
type Api = any
type Id<_T extends string> = string

export function createConvexClient(url: string): ConvexClient {
  return createClient(url)
}

export async function ensureRepo(
  client: ConvexClient,
  repoName: string,
): Promise<Id<'repos'>> {
  return await client.mutation('repos:getOrCreate' as Api, { name: repoName })
}

export async function ensureAuthors(
  client: ConvexClient,
  repoId: Id<'repos'>,
  authors: Array<{ username: string; whitelisted: boolean }>,
): Promise<Map<string, Id<'authors'>>> {
  const map = new Map<string, Id<'authors'>>()
  for (const author of authors) {
    const authorId = await client.mutation('authors:upsert' as Api, {
      repoId,
      username: author.username,
      whitelisted: author.whitelisted,
    })
    map.set(author.username, authorId)
  }
  return map
}

export interface CachedWorkUnit {
  classificationType: Classification['type']
  difficultyLevel: Classification['difficulty']
  impactScore: number
  reasoning: string
  unitScore: number
}

export async function findExistingWorkUnit(
  client: ConvexClient,
  repoId: Id<'repos'>,
  authorId: Id<'authors'>,
  date: string,
  unitType: 'pr' | 'branch_day',
  branch: string,
): Promise<CachedWorkUnit | null> {
  return await client.query('work_units:find' as Api, {
    repoId,
    authorId,
    date,
    unitType,
    branch,
  })
}

export interface WorkUnitPayload {
  repoId: Id<'repos'>
  authorId: Id<'authors'>
  unitType: 'pr' | 'branch_day'
  branch: string
  date: string
  prNumber?: number
  commitShas: string[]
  locAdded: number
  locRemoved: number
  locNet: number
  classificationType: string
  difficultyLevel: string
  impactScore: number
  reasoning: string
  locFactor: number
  formulaScore: number
  aiScore: number
  typeWeight: number
  difficultyWeight: number
  unitScore: number
}

export interface BuildWorkUnitInput {
  workUnit: WorkUnit
  repoId: Id<'repos'>
  authorId: Id<'authors'>
  classification: Classification
  prNumber?: number
  locFactor: number
  formulaScore: number
  aiScore: number
  typeWeight: number
  difficultyWeight: number
  unitScore: number
}

function convertUnitType(kind: WorkUnit['kind']): 'pr' | 'branch_day' {
  if (kind === 'branch-day') return 'branch_day'
  return kind
}

export function buildWorkUnitPayload(
  input: BuildWorkUnitInput,
): WorkUnitPayload {
  const { workUnit, repoId, authorId, classification } = input

  return {
    repoId,
    authorId,
    unitType: convertUnitType(workUnit.kind),
    branch: workUnit.branch,
    date: workUnit.date,
    ...(input.prNumber !== undefined ? { prNumber: input.prNumber } : {}),
    commitShas: workUnit.commit_shas,
    locAdded: workUnit.insertions,
    locRemoved: workUnit.deletions,
    locNet: workUnit.net,
    classificationType: classification.type,
    difficultyLevel: classification.difficulty,
    impactScore: classification.impact_score,
    reasoning: classification.reasoning,
    locFactor: input.locFactor,
    formulaScore: input.formulaScore,
    aiScore: input.aiScore,
    typeWeight: input.typeWeight,
    difficultyWeight: input.difficultyWeight,
    unitScore: input.unitScore,
  }
}

export async function insertWorkUnit(
  client: ConvexClient,
  payload: WorkUnitPayload,
): Promise<Id<'work_units'>> {
  return await client.mutation('work_units:insert' as Api, payload)
}

export interface AnalysisRunData {
  repoId: Id<'repos'>
  timeWindow: string
  analyzedAt: string
  daysInWindow: number
  authorScores: Array<{
    authorId: Id<'authors'>
    username: string
    commits: number
    locAdded: number
    locRemoved: number
    locNet: number
    score: number
  }>
}

export async function insertAnalysisRun(
  client: ConvexClient,
  data: AnalysisRunData,
): Promise<Id<'analysis_runs'>> {
  return await client.mutation('analysis_runs:insert' as Api, data)
}
