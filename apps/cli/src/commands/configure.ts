import { existsSync, mkdirSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import {
  addRepo,
  findRepoByPath,
  loadBundle,
  mergeEngineers,
  saveBundle,
} from '../bundle'
import { getUniqueAuthors } from '../git/authors'
import { parseTimeWindow } from '../git/log'
import type { BundleConfig } from '../types'

export async function configure(
  configPath: string,
  repoPath: string,
  timeWindow: string,
): Promise<void> {
  const absoluteConfigPath = resolve(configPath)
  const absoluteRepoPath = resolve(repoPath)

  if (!existsSync(`${absoluteRepoPath}/.git`)) {
    console.error(`Not a git repository: ${absoluteRepoPath}`)
    process.exit(1)
  }

  clack.intro('auctor configure')

  const bundle = await getOrInitBundle(absoluteConfigPath)

  const since = parseTimeWindow(timeWindow)
  const authorInfos = await getUniqueAuthors(absoluteRepoPath, since)

  let selected: string[] = []
  if (authorInfos.length === 0) {
    clack.log.warn(
      `No authors found in ${timeWindow} window; skipping engineer prompt.`,
    )
  } else {
    const picked = await clack.multiselect({
      message: 'Select engineers to track (GitHub usernames):',
      options: authorInfos.map((a) => ({
        value: a.username,
        label: a.username,
      })),
      initialValues: authorInfos
        .map((a) => a.username)
        .filter((u) => bundle.engineers.includes(u)),
      required: false,
    })
    if (clack.isCancel(picked)) {
      clack.cancel('Configuration cancelled.')
      process.exit(0)
    }
    selected = picked as string[]
  }

  const repoEntry = findRepoByPath(bundle, absoluteRepoPath) ?? {
    name: basename(absoluteRepoPath),
    path: absoluteRepoPath,
  }
  const withRepo = addRepo(bundle, repoEntry)
  const withEngineers = mergeEngineers(withRepo, selected)

  await saveBundle(absoluteConfigPath, withEngineers)

  clack.outro(
    `Saved bundle ${withEngineers.name}: ${withEngineers.repos.length} repo(s), ${withEngineers.engineers.length} engineer(s)`,
  )
}

async function getOrInitBundle(configPath: string): Promise<BundleConfig> {
  if (existsSync(configPath)) {
    return loadBundle(configPath)
  }
  clack.log.info(`Creating new bundle at ${configPath}`)
  const defaultName = basename(configPath).replace(/(_config)?\.ya?ml$/, '')
  const nameRes = await clack.text({
    message: 'Bundle name:',
    initialValue: defaultName,
    validate: (v) => (v.trim() ? undefined : 'Name is required'),
  })
  if (clack.isCancel(nameRes)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  const serverRes = await clack.text({
    message: 'Server URL (blank to skip):',
    placeholder: 'https://auctor-server.fly.dev',
    defaultValue: '',
  })
  if (clack.isCancel(serverRes)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  mkdirSync(dirname(configPath), { recursive: true })
  const name = (nameRes as string).trim()
  const serverUrl = (serverRes as string).trim()
  return {
    name,
    ...(serverUrl ? { server_url: serverUrl } : {}),
    repos: [],
    engineers: [],
  }
}
