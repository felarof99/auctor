import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
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
import {
  buildMicroscopeResultFilename,
  getResultsDir,
  resolveBundleConfigPath,
} from '../paths'

export async function microscope(
  configPath: string,
  timeWindow: string,
): Promise<void> {
  const absoluteConfigPath = resolveBundleConfigPath(configPath)
  const bundle = await loadBundle(absoluteConfigPath)

  if (bundle.engineers.length === 0) {
    console.error('No engineers in bundle. Run `auctor configure` first.')
    process.exit(1)
  }

  clack.intro('auctor microscope')
  const username = await pickEngineer(bundle.engineers)
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

  const resultsDir = getResultsDir(absoluteConfigPath)
  mkdirSync(resultsDir, { recursive: true })
  const reportPath = join(
    resultsDir,
    buildMicroscopeResultFilename(bundle.name, username),
  )
  const report = buildMicroscopeReport({
    username,
    bundleName: bundle.name,
    window: timeWindow,
    days,
  })
  await Bun.write(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport written to ${reportPath}`)
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
