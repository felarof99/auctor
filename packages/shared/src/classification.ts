import { z } from 'zod'

export const WorkUnitTypeEnum = z.enum(['pr', 'branch-day'])

export const ClassificationTypeEnum = z.enum([
  'feature',
  'bugfix',
  'refactor',
  'chore',
  'test',
  'docs',
])

export const DifficultyEnum = z.enum([
  'trivial',
  'easy',
  'medium',
  'hard',
  'complex',
])

export const ClassificationSchema = z.object({
  type: ClassificationTypeEnum,
  difficulty: DifficultyEnum,
  impact_score: z.number().min(0).max(10),
  reasoning: z.string(),
})

export type WorkUnitType = z.infer<typeof WorkUnitTypeEnum>
export type ClassificationType = z.infer<typeof ClassificationTypeEnum>
export type Difficulty = z.infer<typeof DifficultyEnum>
export type Classification = z.infer<typeof ClassificationSchema>

export interface WorkUnit {
  id: string
  kind: WorkUnitType
  author: string
  branch: string
  date: string
  commit_shas: string[]
  commit_messages: string[]
  diff: string
  insertions: number
  deletions: number
  net: number
}
