import { describe, expect, test } from 'bun:test'
import type { Classification, WorkUnit } from '@auctor/shared/classification'
import {
  classifyWithLocalExecutors,
  type LocalExecutorRuntime,
} from './orchestrator'

const repoPath = '/tmp/repo'

function workUnit(id: string): WorkUnit {
  return {
    id,
    kind: 'branch-day',
    author: 'dev@example.com',
    branch: 'feature/local-classifier',
    date: '2026-04-18',
    commit_shas: [`${id}-sha`],
    commit_messages: [`${id} commit`],
    diff: `diff --git a/${id}.ts b/${id}.ts`,
    insertions: 1,
    deletions: 0,
    net: 1,
  }
}

function classification(reasoning: string): Classification {
  return {
    type: 'feature',
    difficulty: 'medium',
    impact_score: 5,
    reasoning,
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function nextTimerTurn(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('classifyWithLocalExecutors', () => {
  test('never exceeds maxParallel', async () => {
    const units = [
      workUnit('unit-1'),
      workUnit('unit-2'),
      workUnit('unit-3'),
      workUnit('unit-4'),
      workUnit('unit-5'),
    ]
    const completions = units.map(() => deferred<Classification>())
    let active = 0
    let maxActive = 0
    let calls = 0
    const executor: LocalExecutorRuntime = {
      type: 'claude',
      async classify() {
        const completion = completions[calls]
        calls += 1
        active += 1
        maxActive = Math.max(maxActive, active)
        const result = await completion.promise
        active -= 1
        return result
      },
    }

    const promise = classifyWithLocalExecutors({
      repoPath,
      workUnits: units,
      maxParallel: 2,
      executors: [executor],
    })

    while (calls < 2) {
      await Promise.resolve()
    }

    expect(calls).toBe(2)
    expect(maxActive).toBe(2)

    completions[0].resolve(classification('unit-1'))
    while (calls < 3) {
      await Promise.resolve()
    }
    expect(maxActive).toBe(2)

    for (let index = 1; index < completions.length; index += 1) {
      completions[index].resolve(classification(units[index].id))
    }

    const results = await promise
    expect(results.size).toBe(units.length)
    expect(maxActive).toBe(2)
  })

  test('assigns executors round-robin across work units', async () => {
    const calls: string[] = []
    const executors: LocalExecutorRuntime[] = [
      {
        type: 'claude',
        async classify({ repoPath: path, workUnit: unit }) {
          calls.push(`claude:${path}:${unit.id}`)
          return classification(`claude ${unit.id}`)
        },
      },
      {
        type: 'codex',
        async classify({ repoPath: path, workUnit: unit }) {
          calls.push(`codex:${path}:${unit.id}`)
          return classification(`codex ${unit.id}`)
        },
      },
    ]

    const results = await classifyWithLocalExecutors({
      repoPath,
      workUnits: [
        workUnit('unit-1'),
        workUnit('unit-2'),
        workUnit('unit-3'),
        workUnit('unit-4'),
      ],
      maxParallel: 3,
      executors,
    })

    expect(calls).toEqual([
      'claude:/tmp/repo:unit-1',
      'codex:/tmp/repo:unit-2',
      'claude:/tmp/repo:unit-3',
      'codex:/tmp/repo:unit-4',
    ])
    expect(results.get('unit-1')).toEqual(classification('claude unit-1'))
    expect(results.get('unit-4')).toEqual(classification('codex unit-4'))
  })

  test('throws on first executor failure', async () => {
    const error = new Error('executor crashed')
    const executor: LocalExecutorRuntime = {
      type: 'codex',
      async classify() {
        throw error
      },
    }

    await expect(
      classifyWithLocalExecutors({
        repoPath,
        workUnits: [workUnit('unit-1')],
        maxParallel: 1,
        executors: [executor],
      }),
    ).rejects.toThrow(error)
  })

  test('drains active classifications before rejecting after concurrent failure', async () => {
    const error = new Error('unit-2 failed')
    const unit1 = deferred<Classification>()
    const unit2 = deferred<Classification>()
    const calls: string[] = []
    let settled = false
    let observedError: unknown
    const executor: LocalExecutorRuntime = {
      type: 'claude',
      async classify({ workUnit: unit }) {
        calls.push(unit.id)

        if (unit.id === 'unit-1') {
          return unit1.promise
        }
        if (unit.id === 'unit-2') {
          return unit2.promise
        }

        return classification(unit.id)
      },
    }

    const result = classifyWithLocalExecutors({
      repoPath,
      workUnits: [workUnit('unit-1'), workUnit('unit-2'), workUnit('unit-3')],
      maxParallel: 2,
      executors: [executor],
    })
    const observed = result.then(
      () => {
        settled = true
      },
      (err: unknown) => {
        settled = true
        observedError = err
      },
    )

    while (calls.length < 2) {
      await Promise.resolve()
    }

    unit2.reject(error)
    await nextTimerTurn()

    expect(settled).toBe(false)
    expect(calls).toEqual(['unit-1', 'unit-2'])

    unit1.resolve(classification('unit-1'))
    await observed

    expect(settled).toBe(true)
    expect(observedError).toBe(error)
    expect(calls).toEqual(['unit-1', 'unit-2'])
  })

  test('empty executor list throws', async () => {
    await expect(
      classifyWithLocalExecutors({
        repoPath,
        workUnits: [workUnit('unit-1')],
        maxParallel: 1,
        executors: [],
      }),
    ).rejects.toThrow('No local classifier executors configured')
  })

  test('empty work unit list returns an empty map without calling executors', async () => {
    let calls = 0
    const executor: LocalExecutorRuntime = {
      type: 'claude',
      async classify() {
        calls += 1
        return classification('unused')
      },
    }

    const results = await classifyWithLocalExecutors({
      repoPath,
      workUnits: [],
      maxParallel: 4,
      executors: [executor],
    })

    expect(results).toEqual(new Map())
    expect(calls).toBe(0)
  })

  test('duplicate work unit ids throw before classification starts', async () => {
    let calls = 0
    const executor: LocalExecutorRuntime = {
      type: 'claude',
      async classify() {
        calls += 1
        return classification('unused')
      },
    }

    await expect(
      classifyWithLocalExecutors({
        repoPath,
        workUnits: [
          workUnit('duplicate-unit'),
          {
            ...workUnit('duplicate-unit'),
            diff: 'second diff',
          },
        ],
        maxParallel: 2,
        executors: [executor],
      }),
    ).rejects.toThrow('duplicate-unit')

    expect(calls).toBe(0)
  })
})
