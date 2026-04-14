import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import { getUniqueAuthors } from '../git/authors'
import { parseTimeWindow } from '../git/log'
import type { Config } from '../types'

export async function configure(
  timeWindow: string,
  path: string,
): Promise<void> {
  const repoPath = resolve(path)
  const gitDir = join(repoPath, '.git')

  if (!existsSync(gitDir)) {
    console.error(`Not a git repository: ${repoPath}`)
    process.exit(1)
  }

  const since = parseTimeWindow(timeWindow)
  const authors = await getUniqueAuthors(repoPath, since)

  if (authors.length === 0) {
    console.error(`No authors found in the last ${timeWindow}`)
    process.exit(1)
  }

  const configPath = join(repoPath, '.auctor.json')
  let existingAuthors: string[] = []
  if (existsSync(configPath)) {
    const existing: Config = JSON.parse(await Bun.file(configPath).text())
    existingAuthors = existing.authors
  }

  clack.intro('auctor configure')

  const selected = await clack.multiselect({
    message: 'Select authors to track:',
    options: authors.map((a) => ({
      value: a,
      label: a,
    })),
    initialValues: existingAuthors.filter((a) => authors.includes(a)),
  })

  if (clack.isCancel(selected)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }

  const config: Config = { authors: selected as string[] }
  await Bun.write(configPath, JSON.stringify(config, null, 2))

  clack.outro(`Saved ${config.authors.length} authors to .auctor.json`)
}
