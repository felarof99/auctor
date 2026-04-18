import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  materializeClaudeSkillBundle,
  materializeCodexSkillsHome,
  resolveSkillBundle,
} from './skills'

const tempDirs: string[] = []

function makeTempDir() {
  const dir = mkdtempSync(join(process.cwd(), 'tmp-skill-bundle-'))
  tempDirs.push(dir)
  return dir
}

async function writeSkill(
  rootDir: string,
  name: string,
  files: Record<string, string>,
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
    const skillDir = await writeSkill(rootDir, 'auctor-classifier', {
      'SKILL.md': '# Auctor Classifier\n',
    })
    const bundle = await resolveSkillBundle(skillDir, [])
    const homeDir = join(rootDir, 'codex-home')

    const skillsHome = await materializeCodexSkillsHome(bundle, homeDir)

    expect(skillsHome).toBe(join(homeDir, 'skills'))
    expect(
      readFileSync(join(skillsHome, 'auctor-classifier/SKILL.md'), 'utf8'),
    ).toBe('# Auctor Classifier\n')
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
