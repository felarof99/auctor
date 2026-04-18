import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Classification } from '@auctor/shared/classification'
import type { ClassifierConfig } from '../config'
import {
  buildLocalAgentConfigSignature,
  createLocalAgentClassifierBackend,
} from './backend'

function localConfig(
  overrides: Partial<ClassifierConfig['local']> = {},
): ClassifierConfig['local'] {
  return {
    executors: [{ type: 'codex', command: 'codex', model: 'gpt-5' }],
    maxParallel: 2,
    timeoutMs: 1000,
    repairAttempts: 1,
    skillPath: '/skills/classifier',
    extraSkillPaths: [],
    ...overrides,
  }
}

describe('createLocalAgentClassifierBackend', () => {
  test('passes Codex home root to executors after materializing skills', async () => {
    const config = localConfig()
    const signature = buildLocalAgentConfigSignature(config, {
      codexConfigHash: 'codex-config-hash',
    })
    const expectedHomeDir = join(
      '/tmp/auctor-test-cache',
      'codex',
      'bundle-hash',
      signature,
    )
    let materializedHomeDir = ''
    let executorCodexHomeDir = ''
    const classification: Classification = {
      type: 'feature',
      difficulty: 'medium',
      impact_score: 5,
      reasoning: 'local backend result',
    }

    const backend = await createLocalAgentClassifierBackend(config, {
      cacheRoot: '/tmp/auctor-test-cache',
      resolveSkillBundle: async () => ({
        hash: 'bundle-hash',
        skills: [],
      }),
      materializeClaudeSkillBundle: async () => '/tmp/claude-bundle',
      materializeCodexSkillsHome: async (_bundle, homeDir) => {
        materializedHomeDir = homeDir
        return join(homeDir, 'skills')
      },
      getSanitizedCodexConfigHash: () => 'codex-config-hash',
      createLocalExecutor: (input) => {
        executorCodexHomeDir = input.codexHomeDir
        return {
          type: 'codex',
          async classify() {
            return classification
          },
        }
      },
    })

    const result = await backend.classifyMany({
      repoPath: '/repo',
      workUnits: [
        {
          id: 'unit-1',
          kind: 'branch-day',
          author: 'dev@example.com',
          branch: 'main',
          date: '2026-04-18',
          commit_shas: ['abc123'],
          commit_messages: ['change'],
          diff: 'diff',
          insertions: 1,
          deletions: 0,
          net: 1,
        },
      ],
    })

    expect(materializedHomeDir).toBe(expectedHomeDir)
    expect(executorCodexHomeDir).toBe(expectedHomeDir)
    expect(result.get('unit-1')).toEqual(classification)
  })

  test('changes cache context when executor config changes', async () => {
    const first = buildLocalAgentConfigSignature(
      localConfig({
        executors: [{ type: 'claude', command: 'claude', model: 'sonnet' }],
      }),
    )
    const second = buildLocalAgentConfigSignature(
      localConfig({
        executors: [{ type: 'claude', command: 'claude', model: 'opus' }],
      }),
    )

    expect(second).not.toBe(first)
  })

  test('changes cache context when sanitized Codex config changes', async () => {
    const first = buildLocalAgentConfigSignature(localConfig(), {
      codexConfigHash: 'first-config-hash',
    })
    const second = buildLocalAgentConfigSignature(localConfig(), {
      codexConfigHash: 'second-config-hash',
    })

    expect(second).not.toBe(first)
  })
})
