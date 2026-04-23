import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import * as clack from '@clack/prompts'
import fuzzysort from 'fuzzysort'
import { loadBundle } from '../bundle'
import { resolveCommitsToGithubAuthors } from '../git/authors'
import { getGitLog, parseGitLog, parseTimeWindow } from '../git/log'
import {
  buildMicroscopeReport,
  groupByDay,
  type MicroscopeCommit,
  renderMicroscope,
} from '../microscope-output'

export interface MicroscopeOptions {
  engineer?: string
  jsonPath?: string
}

export async function microscope(
  configPath: string,
  timeWindow: string,
  options: MicroscopeOptions = {},
): Promise<void> {
  const absoluteConfigPath = resolve(configPath)
  const bundle = await loadBundle(absoluteConfigPath)

  if (bundle.engineers.length === 0) {
    console.error('No engineers in bundle. Run `auctor configure` first.')
    process.exit(1)
  }

  clack.intro('auctor microscope')
  const username = await resolveEngineer(bundle.engineers, options.engineer)
  if (!username) {
    clack.cancel('No engineer selected.')
    process.exit(0)
  }

  const since = parseTimeWindow(timeWindow)
  const commits: MicroscopeCommit[] = []
  for (const repo of bundle.repos) {
    if (!existsSync(`${repo.path}/.git`)) {
      clack.log.warn(`Skipping ${repo.name}: path not found`)
      continue
    }
    const log = await getGitLog(repo.path, since)
    const parsed = (
      await resolveCommitsToGithubAuthors(repo.path, parseGitLog(log))
    ).filter((c) => c.author === username)
    for (const c of parsed) {
      commits.push({
        repo: repo.name,
        sha: c.sha,
        subject: c.subject,
        insertions: c.insertions,
        deletions: c.deletions,
        date: c.date,
      })
    }
  }

  const days = groupByDay(commits)
  const output = renderMicroscope({
    username,
    bundleName: bundle.name,
    window: timeWindow,
    days,
  })
  clack.outro(
    `${commits.length} commit(s) across ${bundle.repos.length} repo(s)`,
  )
  console.log(`\n${output}`)

  const reportPath =
    options.jsonPath !== undefined
      ? resolve(options.jsonPath)
      : getDefaultReportPath(absoluteConfigPath, bundle.name, username)
  mkdirSync(dirname(reportPath), { recursive: true })
  const report = buildMicroscopeReport({
    username,
    bundleName: bundle.name,
    window: timeWindow,
    days,
  })
  await Bun.write(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport written to ${reportPath}`)
}

async function resolveEngineer(
  engineers: string[],
  requested?: string,
): Promise<string | null> {
  if (requested === undefined) return pickEngineer(engineers)
  const username = requested.trim()
  if (!username) {
    console.error('Engineer username cannot be empty.')
    process.exit(1)
  }
  if (!engineers.includes(username)) {
    console.error(`Engineer not found in bundle: ${username}`)
    console.error(`Available engineers: ${engineers.join(', ')}`)
    process.exit(1)
  }
  return username
}

function getDefaultReportPath(
  configPath: string,
  bundleName: string,
  username: string,
): string {
  const resultsDir = join(dirname(configPath), '.results')
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
    .replace('T', '-')
  return join(resultsDir, `${bundleName}-microscope-${username}-${stamp}.json`)
}

async function pickEngineer(engineers: string[]): Promise<string | null> {
  if (engineers.length <= 20) {
    const res = await clack.select({
      message: 'Pick engineer:',
      options: engineers.map((e) => ({ value: e, label: e })),
    })
    if (clack.isCancel(res)) return null
    return res as string
  }
  const query = await clack.text({
    message: 'Search engineer (type a prefix):',
    placeholder: '',
  })
  if (clack.isCancel(query)) return null
  const matches = fuzzysort.go(query as string, engineers, { limit: 10 })
  const top =
    matches.length > 0 ? matches.map((m) => m.target) : engineers.slice(0, 10)
  const res = await clack.select({
    message: 'Pick engineer:',
    options: top.map((e) => ({ value: e, label: e })),
  })
  if (clack.isCancel(res)) return null
  return res as string
}
