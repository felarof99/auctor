import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadClassifierConfig } from './config'

describe('loadClassifierConfig', () => {
  test('defaults classifier config', () => {
    const config = loadClassifierConfig({})
    const expectedSkillPath = fileURLToPath(
      new URL('../../skills/auctor-classifier', import.meta.url),
    )

    expect(config.backend).toBe('bedrock')
    expect(config.local.executors).toEqual([
      {
        type: 'claude',
        command: 'claude',
        maxTurns: 4,
        skipPermissions: true,
      },
    ])
    expect(config.local.maxParallel).toBe(4)
    expect(config.local.timeoutMs).toBe(240000)
    expect(config.local.repairAttempts).toBe(1)
    expect(config.local.skillPath).toBe(expectedSkillPath)
    expect(existsSync(join(config.local.skillPath, 'SKILL.md'))).toBe(true)
    expect(config.local.extraSkillPaths).toEqual([])
  })

  test('clamps local parallelism to 1 through 10', () => {
    expect(
      loadClassifierConfig({
        CLASSIFIER_BACKEND: 'local-agent',
        LOCAL_CLASSIFIER_MAX_PARALLEL: '0',
      }).local.maxParallel,
    ).toBe(1)
    expect(
      loadClassifierConfig({
        CLASSIFIER_BACKEND: 'local-agent',
        LOCAL_CLASSIFIER_MAX_PARALLEL: '99',
      }).local.maxParallel,
    ).toBe(10)
  })

  test('parses enabled executors and skill paths', () => {
    const config = loadClassifierConfig({
      CLASSIFIER_BACKEND: 'local-agent',
      LOCAL_CLASSIFIER_EXECUTORS: 'claude,codex',
      LOCAL_CLASSIFIER_SKILL_PATH: './skills/auctor-classifier',
      LOCAL_CLASSIFIER_EXTRA_SKILL_PATHS: './skills/one, ./skills/two',
    })

    expect(config.backend).toBe('local-agent')
    expect(config.local.executors.map((e) => e.type)).toEqual([
      'claude',
      'codex',
    ])
    expect(config.local.skillPath).toBe('./skills/auctor-classifier')
    expect(config.local.extraSkillPaths).toEqual([
      './skills/one',
      './skills/two',
    ])
  })

  test('throws for unknown backend or executor', () => {
    expect(() => loadClassifierConfig({ CLASSIFIER_BACKEND: 'other' })).toThrow(
      'Unsupported classifier backend',
    )
    expect(() =>
      loadClassifierConfig({
        CLASSIFIER_BACKEND: 'local-agent',
        LOCAL_CLASSIFIER_EXECUTORS: 'bad',
      }),
    ).toThrow('Unsupported local classifier executor')
  })
})
