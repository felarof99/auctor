import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  materializeClaudeSkillBundle,
  materializeCodexSkillsHome,
  resolveSkillBundle,
} from './skills'

const tempDirs: string[] = []
const originalCodexHome = process.env.CODEX_HOME

function makeTempDir() {
  const dir = mkdtempSync(join(process.cwd(), 'tmp-skill-bundle-'))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(
  rootDir: string,
  name: string,
  files: Record<string, string | Uint8Array>,
) {
  const skillDir = join(rootDir, name)
  await mkdir(skillDir, { recursive: true })

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = join(skillDir, relativePath)
    await mkdir(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }

  return skillDir
}

describe('local classifier skill bundles', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }

    if (originalCodexHome === undefined) {
      delete process.env.CODEX_HOME
    } else {
      process.env.CODEX_HOME = originalCodexHome
    }
  })

  test('hash changes when skill content changes', async () => {
    const rootDir = makeTempDir()
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Original\n',
    })

    const first = await resolveSkillBundle(skillDir, [])
    writeFileSync(join(skillDir, 'SKILL.md'), '# Updated\n')
    const second = await resolveSkillBundle(skillDir, [])

    expect(first.hash).not.toBe(second.hash)
  })

  test('materializes Claude bundle under .claude/skills', async () => {
    const rootDir = makeTempDir()
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
      'references/rules.md': 'Use local context.\n',
    })
    const bundle = await resolveSkillBundle(skillDir, [])

    const materializedRoot = await materializeClaudeSkillBundle(bundle, rootDir)

    expect(materializedRoot).toBe(join(rootDir, bundle.hash))
    expect(
      readFileSync(
        join(materializedRoot, '.claude/skills/auctor-classifier/SKILL.md'),
        'utf8',
      ),
    ).toBe('# Auctor Classifier\n')
    expect(
      readFileSync(
        join(
          materializedRoot,
          '.claude/skills/auctor-classifier/references/rules.md',
        ),
        'utf8',
      ),
    ).toBe('Use local context.\n')
  })

  test('materializes Codex bundle under skills home', async () => {
    const rootDir = makeTempDir()
    const sourceHome = join(rootDir, 'source-codex-home')
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
    })
    await mkdir(sourceHome, { recursive: true })
    process.env.CODEX_HOME = sourceHome
    const bundle = await resolveSkillBundle(skillDir, [])
    const homeDir = join(rootDir, 'codex-home')

    const skillsHome = await materializeCodexSkillsHome(bundle, homeDir)

    expect(skillsHome).toBe(join(homeDir, 'skills'))
    expect(
      readFileSync(join(skillsHome, 'auctor-classifier/SKILL.md'), 'utf8'),
    ).toBe('# Auctor Classifier\n')
  })

  test('copies auth and sanitized top-level Codex config into materialized home', async () => {
    const rootDir = makeTempDir()
    const sourceHome = join(rootDir, 'source-codex-home')
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
    })
    await mkdir(sourceHome, { recursive: true })
    writeFileSync(
      join(sourceHome, 'auth.json'),
      JSON.stringify({ OPENAI_API_KEY: 'synthetic-test-key' }),
    )
    writeFileSync(
      join(sourceHome, 'config.toml'),
      [
        'model = "gpt-5.2-codex"',
        'model_reasoning_effort = "xhigh"',
        'service_tier = "flex"',
        'approval_policy = "never"',
        '',
        '[mcp_servers.github]',
        'command = "gh"',
        '',
        '[projects."/repo"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    )
    process.env.CODEX_HOME = sourceHome
    const bundle = await resolveSkillBundle(skillDir, [])
    const homeDir = join(rootDir, 'codex-home')

    await materializeCodexSkillsHome(bundle, homeDir)

    expect(existsSync(join(homeDir, 'auth.json'))).toBe(true)
    expect(readFileSync(join(homeDir, 'config.toml'), 'utf8')).toBe(
      [
        'model = "gpt-5.2-codex"',
        'model_reasoning_effort = "high"',
        'service_tier = "flex"',
        '',
      ].join('\n'),
    )
  })

  test('removes stale files when rematerializing Codex skills home', async () => {
    const rootDir = makeTempDir()
    const sourceHome = join(rootDir, 'source-codex-home')
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
      'references/old.md': 'old rules\n',
    })
    await mkdir(sourceHome, { recursive: true })
    process.env.CODEX_HOME = sourceHome
    const homeDir = join(rootDir, 'codex-home')
    const firstBundle = await resolveSkillBundle(skillDir, [])

    const skillsHome = await materializeCodexSkillsHome(firstBundle, homeDir)

    expect(
      existsSync(join(skillsHome, 'auctor-classifier/references/old.md')),
    ).toBe(true)

    rmSync(join(skillDir, 'references/old.md'))
    writeFileSync(join(skillDir, 'references/new.md'), 'new rules\n')
    const secondBundle = await resolveSkillBundle(skillDir, [])

    await materializeCodexSkillsHome(secondBundle, homeDir)

    expect(
      existsSync(join(skillsHome, 'auctor-classifier/references/old.md')),
    ).toBe(false)
    expect(
      readFileSync(
        join(skillsHome, 'auctor-classifier/references/new.md'),
        'utf8',
      ),
    ).toBe('new rules\n')
  })

  test('rematerializes Codex skills without wiping copied auth and config', async () => {
    const rootDir = makeTempDir()
    const sourceHome = join(rootDir, 'source-codex-home')
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
      'references/old.md': 'old rules\n',
    })
    await mkdir(sourceHome, { recursive: true })
    writeFileSync(
      join(sourceHome, 'auth.json'),
      JSON.stringify({ OPENAI_API_KEY: 'synthetic-test-key' }),
    )
    writeFileSync(
      join(sourceHome, 'config.toml'),
      'model = "gpt-5.2-codex"\n[mcp_servers.local]\ncommand = "broken"\n',
    )
    process.env.CODEX_HOME = sourceHome
    const homeDir = join(rootDir, 'codex-home')
    const firstBundle = await resolveSkillBundle(skillDir, [])

    const skillsHome = await materializeCodexSkillsHome(firstBundle, homeDir)

    expect(
      existsSync(join(skillsHome, 'auctor-classifier/references/old.md')),
    ).toBe(true)

    rmSync(join(skillDir, 'references/old.md'))
    writeFileSync(join(skillDir, 'references/new.md'), 'new rules\n')
    const secondBundle = await resolveSkillBundle(skillDir, [])

    await materializeCodexSkillsHome(secondBundle, homeDir)

    expect(
      existsSync(join(skillsHome, 'auctor-classifier/references/old.md')),
    ).toBe(false)
    expect(
      readFileSync(
        join(skillsHome, 'auctor-classifier/references/new.md'),
        'utf8',
      ),
    ).toBe('new rules\n')
    expect(existsSync(join(homeDir, 'auth.json'))).toBe(true)
    expect(readFileSync(join(homeDir, 'config.toml'), 'utf8')).toBe(
      'model = "gpt-5.2-codex"\n',
    )
  })

  test('rejects duplicate skill names before materialization', async () => {
    const rootDir = makeTempDir()
    const firstSkillDir = await writeSkill(join(rootDir, 'a'), 'rules', {
      'SKILL.md': '# First Rules\n',
    })
    const secondSkillDir = await writeSkill(join(rootDir, 'b'), 'rules', {
      'SKILL.md': '# Second Rules\n',
    })

    await expect(
      resolveSkillBundle(firstSkillDir, [secondSkillDir]),
    ).rejects.toThrow(/duplicate skill name.*rules/i)
  })

  test('preserves binary skill assets when materializing bundles', async () => {
    const rootDir = makeTempDir()
    const sourceHome = join(rootDir, 'source-codex-home')
    const binaryAsset = Buffer.from([0x00, 0x9f, 0x92, 0x96, 0xff, 0x0a])
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
      'assets/icon.bin': binaryAsset,
      'references/nested/rules.md': 'Use local context.\n',
    })
    await mkdir(sourceHome, { recursive: true })
    process.env.CODEX_HOME = sourceHome
    const bundle = await resolveSkillBundle(skillDir, [])

    const skillsHome = await materializeCodexSkillsHome(
      bundle,
      join(rootDir, 'codex-home'),
    )

    expect(
      readFileSync(join(skillsHome, 'auctor-classifier/assets/icon.bin')),
    ).toEqual(binaryAsset)
    expect(
      readFileSync(
        join(skillsHome, 'auctor-classifier/references/nested/rules.md'),
        'utf8',
      ),
    ).toBe('Use local context.\n')
  })

  test('rejects skill directories without SKILL.md', async () => {
    const rootDir = makeTempDir()
    const skillDir = join(rootDir, 'missing-skill-md')
    await mkdir(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'notes.md'), 'not a skill\n')

    await expect(resolveSkillBundle(skillDir, [])).rejects.toThrow(
      'missing SKILL.md',
    )
  })
})
