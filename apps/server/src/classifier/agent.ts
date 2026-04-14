import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  type Classification,
  ClassificationSchema,
  type WorkUnit,
} from '@auctor/shared/classification'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { buildClassificationPrompt } from './prompt'

const classificationJsonSchema = zodToJsonSchema(ClassificationSchema, {
  $refStrategy: 'root',
})

export async function classifyWorkUnit(
  unit: WorkUnit,
  repoDir: string,
): Promise<Classification> {
  const prompt = buildClassificationPrompt(unit)

  for await (const message of query({
    prompt,
    options: {
      allowedTools: ['Read', 'Grep', 'Bash'],
      cwd: repoDir,
      model: 'haiku',
      maxTurns: 3,
      outputFormat: {
        type: 'json_schema',
        schema: classificationJsonSchema,
      },
    },
  })) {
    if (message.type === 'result' && message.structured_output) {
      const parsed = ClassificationSchema.safeParse(message.structured_output)
      if (parsed.success) {
        return parsed.data
      }
      throw new Error(
        `Classification output failed validation: ${JSON.stringify(message.structured_output)}`,
      )
    }
  }

  throw new Error('Agent SDK query completed without a result')
}
