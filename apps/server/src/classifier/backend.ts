import type { Classification, WorkUnit } from '@auctor/shared/classification'

export interface ClassifierBackend {
  classifyMany(input: {
    repoPath: string
    workUnits: WorkUnit[]
  }): Promise<Map<string, Classification>>
}

export function mapClassificationsById(
  classifications: { id: string; classification: Classification }[],
): Map<string, Classification> {
  return new Map(classifications.map((item) => [item.id, item.classification]))
}
