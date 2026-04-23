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

export interface ConfigureOptions {
  name?: string
  engineers?: string
  allEngineers?: boolean
}

export async function configure(
  configPath: string,
  timeWindow: string,
  repoPaths: string[],
  options: ConfigureOptions = {},
): Promise<void> {
  if (repoPaths.length === 0) {
    console.error('At least one repo path is required.')
    process.exit(1)
  }

  const explicitEngineers = parseEngineerList(options.engineers)
  if (explicitEngineers.length > 0 && options.allEngineers) {
    console.error('Use either --engineers or --all-engineers, not both.')
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

  let bundle = await getOrInitBundle(absoluteConfigPath, options)

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

  const selected = await selectEngineers({
    authorInfos,
    bundle,
    explicitEngineers,
    allEngineers: options.allEngineers === true,
    timeWindow,
    repoCount: absoluteRepoPaths.length,
  })

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

function parseEngineerList(engineers?: string): string[] {
  return (
    engineers
      ?.split(',')
      .map((u) => u.trim())
      .filter(Boolean) ?? []
  )
}

async function selectEngineers(opts: {
  authorInfos: Array<{ username: string; name: string }>
  bundle: BundleConfig
  explicitEngineers: string[]
  allEngineers: boolean
  timeWindow: string
  repoCount: number
}): Promise<string[]> {
  if (opts.explicitEngineers.length > 0) return opts.explicitEngineers
  if (opts.authorInfos.length === 0) {
    clack.log.warn(
      `No authors found in ${opts.timeWindow} window across ${opts.repoCount} repo(s); skipping engineer prompt.`,
    )
    return []
  }
  if (opts.allEngineers) return opts.authorInfos.map((a) => a.username)
  const picked = await clack.multiselect({
    message: 'Select engineers to track (GitHub usernames):',
    options: opts.authorInfos.map((a) => ({
      value: a.username,
      label: a.username,
    })),
    initialValues: opts.authorInfos
      .map((a) => a.username)
      .filter((u) => opts.bundle.engineers.includes(u)),
    required: false,
  })
  if (clack.isCancel(picked)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  return picked as string[]
}

async function getOrInitBundle(
  configPath: string,
  options: ConfigureOptions,
): Promise<BundleConfig> {
  if (existsSync(configPath)) {
    return loadBundle(configPath)
  }
  clack.log.info(`Creating new bundle at ${configPath}`)
  const defaultName = basename(configPath).replace(/(_config)?\.ya?ml$/, '')
  if (shouldPromptForNewBundle(options)) {
    return promptForNewBundle(configPath, defaultName)
  }
  const name = (options.name ?? defaultName).trim()
  if (!name) {
    console.error('Bundle name cannot be empty.')
    process.exit(1)
  }
  mkdirSync(dirname(configPath), { recursive: true })
  return {
    name,
    repos: [],
    engineers: [],
  }
}

function shouldPromptForNewBundle(options: ConfigureOptions): boolean {
  return (
    options.name === undefined &&
    parseEngineerList(options.engineers).length === 0 &&
    options.allEngineers !== true
  )
}

async function promptForNewBundle(
  configPath: string,
  defaultName: string,
): Promise<BundleConfig> {
  const nameRes = await clack.text({
    message: 'Bundle name:',
    initialValue: defaultName,
    validate: (v) => (v.trim() ? undefined : 'Name is required'),
  })
  if (clack.isCancel(nameRes)) {
    clack.cancel('Configuration cancelled.')
    process.exit(0)
  }
  mkdirSync(dirname(configPath), { recursive: true })
  const name = (nameRes as string).trim()
  return {
    name,
    repos: [],
    engineers: [],
  }
}
