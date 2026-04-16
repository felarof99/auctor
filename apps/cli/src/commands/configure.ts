import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import { createConvexClient, ensureAuthors, ensureRepo } from '../convex-client'
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
  const authorInfos = await getUniqueAuthors(repoPath, since)

  if (authorInfos.length === 0) {
    console.error(`No authors found in the last ${timeWindow}`)
    process.exit(1)
  }

  const configPath = join(repoPath, '.auctor.json')
  let existingConfig: Partial<Config> = {}
  if (existsSync(configPath)) {
    existingConfig = JSON.parse(await Bun.file(configPath).text())
  }
  const existingAuthors = existingConfig.authors ?? []

  clack.intro('auctor configure')

  const selected = await clack.multiselect({
    message: 'Select authors to track (GitHub usernames):',
    options: authorInfos.map((a) => ({
      value: a.username,
      label: a.username === a.name ? a.username : `${a.username} (${a.name})`,
    })),
    initialValues: existingAuthors.filter((a) =>
      authorInfos.some((info) => info.username === a),
    ),
  })

  if (clack.isCancel(selected)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }

  const config: Config = { ...existingConfig, authors: selected as string[] }
  await Bun.write(configPath, JSON.stringify(config, null, 2))

  if (config.convex_url) {
    try {
      const client = createConvexClient(config.convex_url)
      const repoName = config.repo_url ?? basename(repoPath)
      const repoId = await ensureRepo(client, repoName)
      await ensureAuthors(
        client,
        repoId,
        config.authors.map((a) => ({ username: a, whitelisted: true })),
      )
      clack.log.success('Synced to Convex')
      await client.close()
    } catch (err) {
      clack.log.warn(
        `Failed to sync to Convex: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  clack.outro(`Saved ${config.authors.length} authors to .auctor.json`)
}
