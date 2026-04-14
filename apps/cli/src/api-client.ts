import type {
  ClassifyRequest,
  ClassifyResponse,
} from '@auctor/shared/api-types'
import type { WorkUnit } from '@auctor/shared/classification'

const DEFAULT_SERVER_URL = 'http://localhost:3001'

export function buildClassifyPayload(
  repoUrl: string,
  workUnits: WorkUnit[],
): ClassifyRequest {
  return { repo_url: repoUrl, work_units: workUnits }
}

export async function classifyWorkUnits(
  serverUrl: string | undefined,
  repoUrl: string,
  workUnits: WorkUnit[],
): Promise<ClassifyResponse> {
  const base = serverUrl || DEFAULT_SERVER_URL
  const payload = buildClassifyPayload(repoUrl, workUnits)

  const response = await fetch(`${base}/api/classify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Classification failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<ClassifyResponse>
}
