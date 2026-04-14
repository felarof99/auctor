import { createHash } from 'node:crypto'
import type { WorkUnit } from '@auctor/shared/classification'
import type { Commit } from '../types'

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function sha256id(shas: string[]): string {
  return createHash('sha256')
    .update([...shas].sort().join('\n'))
    .digest('hex')
    .slice(0, 16)
}

export function extractBranchDayUnits(
  commits: Commit[],
  branch: string,
): Omit<WorkUnit, 'diff'>[] {
  const groups = new Map<string, Commit[]>()

  for (const commit of commits) {
    const key = `${commit.author}::${dateKey(commit.date)}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(commit)
  }

  const units: Omit<WorkUnit, 'diff'>[] = []

  for (const [, group] of groups) {
    const first = group[0]
    const insertions = group.reduce((sum, c) => sum + c.insertions, 0)
    const deletions = group.reduce((sum, c) => sum + c.deletions, 0)
    const commit_shas = group.map((c) => c.sha)

    units.push({
      id: sha256id(commit_shas),
      kind: 'branch-day',
      author: first.author,
      branch,
      date: dateKey(first.date),
      commit_shas,
      commit_messages: group.map((c) => c.subject),
      insertions,
      deletions,
      net: insertions - deletions,
    })
  }

  return units
}

export function extractPrUnits(commits: Commit[]): Omit<WorkUnit, 'diff'>[] {
  return commits
    .filter((c) => c.isMerge)
    .map((c) => ({
      id: sha256id([c.sha]),
      kind: 'pr' as const,
      author: c.author,
      branch: '',
      date: dateKey(c.date),
      commit_shas: [c.sha],
      commit_messages: [c.subject],
      insertions: c.insertions,
      deletions: c.deletions,
      net: c.insertions - c.deletions,
    }))
}
