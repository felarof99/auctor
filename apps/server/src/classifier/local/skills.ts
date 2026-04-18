import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'

export interface SkillEntry {
  name: string
  sourceDir: string
  files: { relativePath: string; content: string }[]
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
  const hash = createHash('sha256')
    .update(
      JSON.stringify(
        skills.map((skill) => ({
          name: skill.name,
          files: skill.files.map((file) => ({
            relativePath: file.relativePath,
            content: file.content,
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
      content: readFileSync(join(sourceDir, relativePath), 'utf8'),
    })),
  }
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
      writeFileSync(targetFile, file.content)
    }
  }
}
