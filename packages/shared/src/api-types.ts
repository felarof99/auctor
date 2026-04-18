import type { Classification, WorkUnit } from './classification'

export interface ClassifyRequest {
  repo_path: string
  work_units: WorkUnit[]
}

export interface ClassifiedWorkUnit {
  id: string
  classification: Classification
}

export interface ClassifyResponse {
  classifications: ClassifiedWorkUnit[]
}
