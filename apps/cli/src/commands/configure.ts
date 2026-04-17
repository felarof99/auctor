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
  timeWindow: string,
  repoPaths: string[],
): Promise<void> {
  if (repoPaths.length === 0) {
    console.error('At least one repo path is required.')
    process.exit(1)
  }

  const absoluteConfigPath = resolve(configPath)
  const absoluteRepoPaths = repoPaths.map((p) => resolve(p))

  for (const repoPath of absoluteRepoPaths) {
    if (!existsSync(`${repoPath}/.git`)) {
      console.error(`Not a git repository: ${repoPath}`)
      process.exit(1)
    }
  }

  clack.intro('auctor configure')

  let bundle = await getOrInitBundle(absoluteConfigPath)

  const since = parseTimeWindow(timeWindow)

  const usernames = new Map<string, string>()
  for (const repoPath of absoluteRepoPaths) {
    const authorInfos = await getUniqueAuthors(repoPath, since)
    for (const info of authorInfos) {
      usernames.set(info.username, info.name)
    }
  }
  const authorInfos = [...usernames.entries()]
    .map(([username, name]) => ({ username, name }))
    .sort((a, b) => a.username.localeCompare(b.username))

  let selected: string[] = []
  if (authorInfos.length === 0) {
    clack.log.warn(
      `No authors found in ${timeWindow} window across ${absoluteRepoPaths.length} repo(s); skipping engineer prompt.`,
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

  for (const repoPath of absoluteRepoPaths) {
    const repoEntry = findRepoByPath(bundle, repoPath) ?? {
      name: basename(repoPath),
      path: repoPath,
    }
    bundle = addRepo(bundle, repoEntry)
  }
  bundle = mergeEngineers(bundle, selected)

  await saveBundle(absoluteConfigPath, bundle)

  clack.outro(
    `Saved bundle ${bundle.name}: ${bundle.repos.length} repo(s), ${bundle.engineers.length} engineer(s)`,
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
