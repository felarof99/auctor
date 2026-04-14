import { describe, expect, test } from 'bun:test'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import { type BuildWorkUnitInput, buildWorkUnitPayload } from './convex-client'

function makeWorkUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'wu-1',
    kind: 'branch-day',
    author: 'alice',
    branch: 'feat/login',
    date: '2026-04-10',
    commit_shas: ['abc123', 'def456'],
    commit_messages: ['feat: add login', 'fix: typo'],
    diff: '+added\n-removed',
    insertions: 42,
    deletions: 10,
    net: 32,
    ...overrides,
  }
}

function makeClassification(
  overrides: Partial<Classification> = {},
): Classification {
  return {
    type: 'feature',
    difficulty: 'medium',
    impact_score: 7,
    reasoning: 'Adds user authentication flow',
    ...overrides,
  }
}

function makeInput(
  overrides: Partial<BuildWorkUnitInput> = {},
): BuildWorkUnitInput {
  return {
    workUnit: makeWorkUnit(),
    repoId: 'repo-id-123' as unknown as never,
    authorId: 'author-id-456' as unknown as never,
    classification: makeClassification(),
    locFactor: 1.5,
    formulaScore: 6.0,
    aiScore: 7.0,
    typeWeight: 1.2,
    difficultyWeight: 1.0,
    unitScore: 8.5,
    ...overrides,
  }
}

describe('buildWorkUnitPayload', () => {
  test('converts branch-day kind to branch_day unitType', () => {
    const payload = buildWorkUnitPayload(makeInput())
    expect(payload.unitType).toBe('branch_day')
  })

  test('maps all WorkUnit fields to Convex field names', () => {
    const payload = buildWorkUnitPayload(makeInput())

    expect(payload.commitShas).toEqual(['abc123', 'def456'])
    expect(payload.locAdded).toBe(42)
    expect(payload.locRemoved).toBe(10)
    expect(payload.locNet).toBe(32)
    expect(payload.branch).toBe('feat/login')
    expect(payload.date).toBe('2026-04-10')
  })

  test('maps classification fields correctly', () => {
    const payload = buildWorkUnitPayload(makeInput())

    expect(payload.classificationType).toBe('feature')
    expect(payload.difficultyLevel).toBe('medium')
    expect(payload.impactScore).toBe(7)
    expect(payload.reasoning).toBe('Adds user authentication flow')
  })

  test('maps scoring fields correctly', () => {
    const payload = buildWorkUnitPayload(makeInput())

    expect(payload.locFactor).toBe(1.5)
    expect(payload.formulaScore).toBe(6.0)
    expect(payload.aiScore).toBe(7.0)
    expect(payload.typeWeight).toBe(1.2)
    expect(payload.difficultyWeight).toBe(1.0)
    expect(payload.unitScore).toBe(8.5)
  })

  test('includes repoId and authorId', () => {
    const payload = buildWorkUnitPayload(makeInput())

    expect(payload.repoId).toBe('repo-id-123')
    expect(payload.authorId).toBe('author-id-456')
  })

  test('handles pr kind correctly', () => {
    const payload = buildWorkUnitPayload(
      makeInput({
        workUnit: makeWorkUnit({ kind: 'pr' }),
        prNumber: 42,
      }),
    )

    expect(payload.unitType).toBe('pr')
    expect(payload.prNumber).toBe(42)
  })

  test('omits prNumber when not provided', () => {
    const payload = buildWorkUnitPayload(makeInput())
    expect(payload.prNumber).toBeUndefined()
  })
})
