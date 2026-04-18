import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

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

  rmSync(skillsHome, { recursive: true, force: true })
  copySkills(bundle, skillsHome)

  return skillsHome
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
