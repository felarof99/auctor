import { describe, expect, test } from 'bun:test'
import type { ClassifiedWorkUnit } from '@auctor/shared/api-types'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  buildClassificationMap,
  buildClassificationsForUnits,
  buildClassifierRequestUnits,
  buildConsideredItemsForUnit,
} from './analyze'

function makeUnit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'unit-1',
    kind: 'branch-day',
    author: 'alice',
    branch: 'main',
    date: '2026-04-17',
    commit_shas: ['aaa1111', 'bbb2222'],
    commit_messages: ['feat: first', 'fix: second'],
    diff: '',
    insertions: 10,
    deletions: 2,
    net: 8,
    ...overrides,
  }
}

function makeClassification(
  overrides: Partial<Classification> = {},
): Classification {
  return {
    type: 'feature',
    difficulty: 'medium',
    impact_score: 5,
    reasoning: 'test classification',
    ...overrides,
  }
}

describe('buildConsideredItemsForUnit', () => {
  test('turns branch-day work units into raw commit provenance', () => {
    const considered = buildConsideredItemsForUnit('browseros-main', makeUnit())

    expect(considered).toEqual({
      commits: [
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'aaa1111',
          message: 'feat: first',
        },
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'bbb2222',
          message: 'fix: second',
        },
      ],
      prs: [],
    })
  })

  test('turns PR work units into merge commit provenance with parsed PR number', () => {
    const considered = buildConsideredItemsForUnit(
      'browseros-main',
      makeUnit({
        kind: 'pr',
        commit_shas: ['ccc3333'],
        commit_messages: ['feat: add mcp guard (#710)'],
      }),
    )

    expect(considered).toEqual({
      commits: [],
      prs: [
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'ccc3333',
          pr_number: 710,
          message: 'feat: add mcp guard (#710)',
        },
      ],
    })
  })

  test('uses merge commit SHA when PR number cannot be parsed', () => {
    const considered = buildConsideredItemsForUnit(
      'browseros-main',
      makeUnit({
        kind: 'pr',
        commit_shas: ['ddd4444'],
        commit_messages: ['merge feature branch'],
      }),
    )

    expect(considered).toEqual({
      commits: [],
      prs: [
        {
          repo: 'browseros-main',
          branch: 'main',
          sha: 'ddd4444',
          message: 'merge feature branch',
        },
      ],
    })
  })

  test('parses GitHub merge commit PR numbers', () => {
    const considered = buildConsideredItemsForUnit(
      'browseros-main',
      makeUnit({
        kind: 'pr',
        commit_shas: ['eee5555'],
        commit_messages: ['chore: merge pull request #690 (feat/acls)'],
      }),
    )

    expect(considered.prs[0].pr_number).toBe(690)
  })
})

describe('buildClassificationMap', () => {
  test('uses returned classifier results by work unit id', () => {
    const classification = makeClassification({
      type: 'bugfix',
      difficulty: 'hard',
      impact_score: 8,
      reasoning: 'Fixes branch-aware analysis',
    })
    const returned: ClassifiedWorkUnit[] = [{ id: 'unit-1', classification }]

    const map = buildClassificationMap(returned)

    expect(map.get('unit-1')).toEqual(classification)
  })

  test('throws on duplicate returned ids', () => {
    const returned: ClassifiedWorkUnit[] = [
      { id: 'unit-1', classification: makeClassification() },
      {
        id: 'unit-1',
        classification: makeClassification({ type: 'bugfix' }),
      },
    ]

    expect(() => buildClassificationMap(returned)).toThrow(
      'Duplicate classification for work unit unit-1',
    )
  })
})

describe('buildClassificationsForUnits', () => {
  test('preserves ordered classifier results for duplicate work unit ids', () => {
    const first = makeClassification({
      type: 'feature',
      reasoning: 'branch-day result',
    })
    const second = makeClassification({
      type: 'bugfix',
      reasoning: 'pr result',
    })
    const units = [
      makeUnit({ id: 'shared-sha', kind: 'branch-day' }),
      makeUnit({ id: 'shared-sha', kind: 'pr' }),
    ]
    const returned: ClassifiedWorkUnit[] = [
      { id: 'shared-sha', classification: first },
      { id: 'shared-sha', classification: second },
    ]

    expect(buildClassificationsForUnits(units, returned)).toEqual([
      first,
      second,
    ])
  })

  test('throws on missing classifier response', () => {
    const units = [makeUnit({ id: 'unit-1' }), makeUnit({ id: 'unit-2' })]
    const returned: ClassifiedWorkUnit[] = [
      { id: 'unit-1', classification: makeClassification() },
    ]

    expect(() => buildClassificationsForUnits(units, returned)).toThrow(
      'Expected 2 classifications but received 1',
    )
  })

  test('throws on mismatched classifier response order', () => {
    const units = [makeUnit({ id: 'unit-1' }), makeUnit({ id: 'unit-2' })]
    const returned: ClassifiedWorkUnit[] = [
      { id: 'unit-1', classification: makeClassification() },
      { id: 'unit-3', classification: makeClassification() },
    ]

    expect(() => buildClassificationsForUnits(units, returned)).toThrow(
      'Classification response mismatch at index 1: expected work unit unit-2 but received unit-3',
    )
  })
})

describe('buildClassifierRequestUnits', () => {
  test('uniquifies duplicate ids before classification while preserving order and content', () => {
    const units = [
      makeUnit({
        id: 'shared-sha',
        kind: 'branch-day',
        commit_messages: ['branch-day'],
      }),
      makeUnit({
        id: 'shared-sha',
        kind: 'pr',
        commit_messages: ['pr'],
      }),
      makeUnit({ id: 'unique-sha', commit_messages: ['unique'] }),
    ]

    const requestUnits = buildClassifierRequestUnits(units)

    expect(requestUnits.map((unit) => unit.id)).toEqual([
      'shared-sha::classifier-0',
      'shared-sha::classifier-1',
      'unique-sha',
    ])
    expect(requestUnits.map(({ id: _id, ...unit }) => unit)).toEqual(
      units.map(({ id: _id, ...unit }) => unit),
    )
    expect(units.map((unit) => unit.id)).toEqual([
      'shared-sha',
      'shared-sha',
      'unique-sha',
    ])
  })

  test('allows duplicate source units to receive distinct ordered classifications without collapse', () => {
    const units = [
      makeUnit({ id: 'shared-sha', kind: 'branch-day' }),
      makeUnit({ id: 'shared-sha', kind: 'pr' }),
    ]
    const requestUnits = buildClassifierRequestUnits(units)
    const first = makeClassification({
      type: 'feature',
      reasoning: 'branch-day result',
    })
    const second = makeClassification({
      type: 'bugfix',
      reasoning: 'pr result',
    })
    const returned: ClassifiedWorkUnit[] = [
      { id: requestUnits[0].id, classification: first },
      { id: requestUnits[1].id, classification: second },
    ]

    expect(buildClassificationsForUnits(requestUnits, returned)).toEqual([
      first,
      second,
    ])
  })

  test('leaves unique ids unchanged', () => {
    const units = [makeUnit({ id: 'unit-1' }), makeUnit({ id: 'unit-2' })]

    expect(buildClassifierRequestUnits(units).map((unit) => unit.id)).toEqual([
      'unit-1',
      'unit-2',
    ])
  })
})
