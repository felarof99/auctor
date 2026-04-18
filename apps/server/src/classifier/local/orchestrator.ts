import type { Classification, WorkUnit } from '@auctor/shared/classification'

export type LocalExecutorType = 'claude' | 'codex'

export interface LocalExecutorRuntime {
  type: LocalExecutorType
  classify(input: {
    repoPath: string
    workUnit: WorkUnit
  }): Promise<Classification>
}

export interface ClassifyWithLocalExecutorsInput {
  repoPath: string
  workUnits: WorkUnit[]
  maxParallel: number
  executors: LocalExecutorRuntime[]
}

export async function classifyWithLocalExecutors(
  input: ClassifyWithLocalExecutorsInput,
): Promise<Map<string, Classification>> {
  if (input.executors.length === 0) {
    throw new Error('No local classifier executors configured')
  }

  if (input.workUnits.length === 0) {
    return new Map()
  }

  const duplicateId = findDuplicateWorkUnitId(input.workUnits)
  if (duplicateId) {
    throw new Error(`Duplicate local classifier work unit id: ${duplicateId}`)
  }

  const workerCount = effectiveWorkerCount(
    input.maxParallel,
    input.workUnits.length,
  )
  const classifications = new Map<string, Classification>()
  let nextUnitIndex = 0
  let failed = false
  let firstError: unknown

  async function worker(): Promise<void> {
    while (!failed) {
      const unitIndex = nextUnitIndex
      nextUnitIndex += 1

      const workUnit = input.workUnits[unitIndex]
      if (!workUnit) return

      const executor = input.executors[unitIndex % input.executors.length]

      try {
        const classification = await executor.classify({
          repoPath: input.repoPath,
          workUnit,
        })
        classifications.set(workUnit.id, classification)
      } catch (error) {
        if (!failed) {
          failed = true
          firstError = error
        }
        return
      }
    }
  }

  const workerResults = await Promise.allSettled(
    Array.from({ length: workerCount }, async () => {
      await worker()
    }),
  )

  if (failed) {
    throw firstError
  }

  for (const result of workerResults) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }

  return classifications
}

function effectiveWorkerCount(
  maxParallel: number,
  workUnitCount: number,
): number {
  const requested = Number.isFinite(maxParallel) ? Math.trunc(maxParallel) : 1
  return Math.min(workUnitCount, Math.max(1, requested))
}

function findDuplicateWorkUnitId(workUnits: WorkUnit[]): string | null {
  const seen = new Set<string>()
  for (const unit of workUnits) {
    if (seen.has(unit.id)) return unit.id
    seen.add(unit.id)
  }

  return null
}
