import { existsSync } from 'node:fs'
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
]

export function resolveBundleConfigPath(
  configPath: string,
  cwd = process.cwd(),
): string {
  const projectRoot = findProjectRoot(cwd)
  const absolutePath = resolve(cwd, configPath)
  if (isOutsideRoot(absolutePath, projectRoot)) return absolutePath
  if (isInsidePath(absolutePath, join(projectRoot, 'out'))) return absolutePath

  const bundleName = deriveBundleName(configPath)
  return join(projectRoot, 'out', bundleName, `${bundleName}_config.yaml`)
}

export function getResultsDir(configPath: string): string {
  return join(dirname(configPath), 'results')
}

export function buildRepoResultFilename(
  repoName: string,
  date = new Date(),
): string {
  return `${formatResultStamp(date)}-${sanitizePathSegment(repoName)}.json`
}

export function buildMicroscopeResultFilename(
  bundleName: string,
  username: string,
  date = new Date(),
): string {
  const safeBundle = sanitizePathSegment(bundleName)
  const safeUsername = sanitizePathSegment(username)
  return `${formatResultStamp(date)}-${safeBundle}-microscope-${safeUsername}.json`
}

export function formatResultStamp(date = new Date()): string {
  const month = MONTHS[date.getMonth()]
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  return `${month}-${day}-${hour}-${minute}`
}

export function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function deriveBundleName(configPath: string): string {
  const name = basename(configPath).replace(/\.ya?ml$/, '')
  const stripped = name.replace(/([_-]?config)$/i, '')
  return sanitizePathSegment(stripped || name)
}

function findProjectRoot(start: string): string {
  let current = resolve(start)
  while (true) {
    if (
      existsSync(join(current, 'package.json')) &&
      existsSync(join(current, 'apps'))
    ) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) return resolve(start)
    current = parent
  }
}

function isOutsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel.startsWith('..') || isAbsolute(rel)
}

function isInsidePath(path: string, parent: string): boolean {
  const rel = relative(parent, path)
  return rel === '' || !(rel.startsWith('..') || isAbsolute(rel))
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}
