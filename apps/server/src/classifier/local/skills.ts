import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

const SAFE_CODEX_CONFIG_KEYS = new Set([
  'model',
  'model_reasoning_effort',
  'service_tier',
])
const SAFE_CODEX_REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'none'])

export interface SkillEntry {
  name: string
  sourceDir: string
  files: { relativePath: string; sha256: string }[]
}

export interface SkillBundle {
  hash: string
  skills: SkillEntry[]
}

export async function resolveSkillBundle(
  classifierSkillPath: string,
  extraSkillPaths: string[],
): Promise<SkillBundle> {
  const skills = [classifierSkillPath, ...extraSkillPaths].map(readSkill)
  rejectDuplicateSkillNames(skills)

  const hash = createHash('sha256')
    .update(
      JSON.stringify(
        skills.map((skill) => ({
          name: skill.name,
          files: skill.files.map((file) => ({
            relativePath: file.relativePath,
            sha256: file.sha256,
          })),
        })),
      ),
    )
    .digest('hex')

  return { hash, skills }
}

export async function materializeClaudeSkillBundle(
  bundle: SkillBundle,
  rootDir: string,
): Promise<string> {
  const materializedRoot = join(rootDir, bundle.hash)

  copySkills(bundle, join(materializedRoot, '.claude', 'skills'))

  return materializedRoot
}

export async function materializeCodexSkillsHome(
  bundle: SkillBundle,
  homeDir: string,
): Promise<string> {
  const skillsHome = join(homeDir, 'skills')

  mkdirSync(homeDir, { recursive: true })
  copyCodexAuthAndConfig(homeDir)
  rmSync(skillsHome, { recursive: true, force: true })
  copySkills(bundle, skillsHome)

  return skillsHome
}

function copyCodexAuthAndConfig(homeDir: string) {
  const sourceHome = process.env.CODEX_HOME || join(homedir(), '.codex')
  const sourceAuth = join(sourceHome, 'auth.json')
  if (existsSync(sourceAuth) && statSync(sourceAuth).isFile()) {
    copyFileIfDifferent(sourceAuth, join(homeDir, 'auth.json'))
  }

  const sourceConfig = join(sourceHome, 'config.toml')
  if (existsSync(sourceConfig) && statSync(sourceConfig).isFile()) {
    writeFileSync(
      join(homeDir, 'config.toml'),
      sanitizeCodexConfig(readFileSync(sourceConfig, 'utf8')),
    )
  }
}

function copyFileIfDifferent(sourcePath: string, targetPath: string) {
  if (resolve(sourcePath) === resolve(targetPath)) return

  mkdirSync(dirname(targetPath), { recursive: true })
  copyFileSync(sourcePath, targetPath)
}

function sanitizeCodexConfig(config: string): string {
  const lines: string[] = []

  for (const line of config.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (trimmed.startsWith('[')) break

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(trimmed)
    if (!match) continue

    const [, key, value] = match
    const sanitizedValue = sanitizeCodexConfigValue(key, value.trim())
    if (sanitizedValue !== null) {
      lines.push(`${key} = ${sanitizedValue}`)
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

function sanitizeCodexConfigValue(key: string, value: string): string | null {
  if (!SAFE_CODEX_CONFIG_KEYS.has(key)) return null
  if (key !== 'model_reasoning_effort') return value

  const effort = readTomlStringValue(value)
  if (effort === null) return null

  const normalized = effort.toLowerCase()
  if (SAFE_CODEX_REASONING_EFFORTS.has(normalized)) {
    return JSON.stringify(normalized)
  }
  if (normalized === 'xhigh') {
    return JSON.stringify('high')
  }

  return null
}

function readTomlStringValue(value: string): string | null {
  const quoted = /^(?:"([^"]*)"|'([^']*)')$/.exec(value)
  if (quoted) return quoted[1] ?? quoted[2] ?? ''

  const bare = /^[A-Za-z_-]+$/.exec(value)
  return bare ? value : null
}

function readSkill(sourceDir: string): SkillEntry {
  const skillMdPath = join(sourceDir, 'SKILL.md')
  if (!existsSync(skillMdPath) || !statSync(skillMdPath).isFile()) {
    throw new Error(`Skill directory ${sourceDir} is missing SKILL.md`)
  }

  return {
    name: basename(sourceDir),
    sourceDir,
    files: walkFiles(sourceDir).map((relativePath) => ({
      relativePath,
      sha256: hashFile(join(sourceDir, relativePath)),
    })),
  }
}

function rejectDuplicateSkillNames(skills: SkillEntry[]) {
  const seen = new Map<string, SkillEntry>()

  for (const skill of skills) {
    const existing = seen.get(skill.name)
    if (existing) {
      throw new Error(
        `Duplicate skill name "${skill.name}" from ${existing.sourceDir} and ${skill.sourceDir}`,
      )
    }

    seen.set(skill.name, skill)
  }
}

function hashFile(filePath: string) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function walkFiles(rootDir: string, currentDir = rootDir): string[] {
  return readdirSync(currentDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const fullPath = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        return walkFiles(rootDir, fullPath)
      }
      if (!entry.isFile()) {
        return []
      }

      return relative(rootDir, fullPath).split(sep).join('/')
    })
}

function copySkills(bundle: SkillBundle, skillsRoot: string) {
  for (const skill of bundle.skills) {
    const targetDir = join(skillsRoot, skill.name)

    for (const file of skill.files) {
      const targetFile = join(targetDir, file.relativePath)

      mkdirSync(dirname(targetFile), { recursive: true })
      copyFileSync(join(skill.sourceDir, file.relativePath), targetFile)
    }
  }
}
