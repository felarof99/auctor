import {
  type Classification,
  ClassificationSchema,
  type WorkUnit,
} from '@auctor/shared/classification'
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime'
import type { ClassifierBackend } from './backend'
import { buildClassificationPrompt } from './prompt'

const REGION = process.env.AWS_REGION ?? 'us-east-1'
const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001'

const client = new BedrockRuntimeClient({ region: REGION })

// JSON schema matching ClassificationSchema for Bedrock structured output
const classificationJsonSchema = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['feature', 'bugfix', 'refactor', 'chore', 'test', 'docs'],
    },
    difficulty: {
      type: 'string',
      enum: ['trivial', 'easy', 'medium', 'hard', 'complex'],
    },
    impact_score: { type: 'number', minimum: 0, maximum: 10 },
    reasoning: { type: 'string' },
  },
  required: ['type', 'difficulty', 'impact_score', 'reasoning'],
  additionalProperties: false,
}

export async function classifyWorkUnit(
  unit: WorkUnit,
  _repoDir: string,
): Promise<Classification> {
  const prompt = buildClassificationPrompt(unit)

  // Call Bedrock Converse with structured JSON output
  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 1024, temperature: 0 },
    outputConfig: {
      textFormat: {
        type: 'json_schema',
        structure: {
          jsonSchema: {
            schema: JSON.stringify(classificationJsonSchema),
            name: 'classification',
            description: 'Classify a code work unit',
          },
        },
      },
    },
  })

  const response = await client.send(command)

  // Extract text from response
  const textBlock = response.output?.message?.content?.find(
    (b): b is { text: string } => 'text' in b,
  )
  if (!textBlock) {
    throw new Error('Bedrock response contained no text content')
  }

  // Validate against Zod schema
  const parsed = ClassificationSchema.safeParse(JSON.parse(textBlock.text))
  if (!parsed.success) {
    throw new Error(`Classification validation failed: ${parsed.error.message}`)
  }

  return parsed.data
}

type ClassifyWorkUnitFn = typeof classifyWorkUnit

export class BedrockClassifierBackend implements ClassifierBackend {
  constructor(
    private readonly classifyOne: ClassifyWorkUnitFn = classifyWorkUnit,
  ) {}

  async classifyMany(input: {
    repoPath: string
    workUnits: WorkUnit[]
  }): Promise<Map<string, Classification>> {
    const classifications = new Map<string, Classification>()

    for (const unit of input.workUnits) {
      const classification = await this.classifyOne(unit, input.repoPath)
      classifications.set(unit.id, classification)
    }

    return classifications
  }
}
