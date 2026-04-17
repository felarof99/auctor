import { existsSync } from 'node:fs'
import { parse, stringify } from 'yaml'
import type { BundleConfig, BundleRepo } from './types'

export async function loadBundle(configPath: string): Promise<BundleConfig> {
  if (!existsSync(configPath)) {
    throw new Error(`Bundle config not found: ${configPath}`)
  }
  const raw = await Bun.file(configPath).text()
  const parsed = parse(raw) as unknown
  return validate(parsed, configPath)
}

export async function saveBundle(
  configPath: string,
  config: BundleConfig,
): Promise<void> {
  const ordered: BundleConfig = {
    name: config.name,
    ...(config.server_url ? { server_url: config.server_url } : {}),
    ...(config.convex_url ? { convex_url: config.convex_url } : {}),
    repos: config.repos,
    engineers: config.engineers,
  }
  await Bun.write(configPath, stringify(ordered))
}

export function addRepo(config: BundleConfig, repo: BundleRepo): BundleConfig {
  if (findRepoByPath(config, repo.path)) return config
  return { ...config, repos: [...config.repos, repo] }
}

export function mergeEngineers(
  config: BundleConfig,
  usernames: string[],
): BundleConfig {
  const existing = new Set(config.engineers)
  const merged = [...config.engineers]
  for (const u of usernames) {
    if (!existing.has(u)) {
      merged.push(u)
      existing.add(u)
    }
  }
  return { ...config, engineers: merged }
}

export function findRepoByPath(
  config: BundleConfig,
  path: string,
): BundleRepo | null {
  return config.repos.find((r) => r.path === path) ?? null
}

function validate(raw: unknown, path: string): BundleConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Bundle config at ${path} is not a YAML object`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.name !== 'string' || !obj.name) {
    throw new Error(`Bundle ${path} is missing required string field: name`)
  }
  if (!Array.isArray(obj.repos)) {
    throw new Error(`Bundle ${path} is missing required array field: repos`)
  }
  if (!Array.isArray(obj.engineers)) {
    throw new Error(`Bundle ${path} is missing required array field: engineers`)
  }
  const repos: BundleRepo[] = obj.repos.map((r, i) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`Bundle ${path} repos[${i}] is not an object`)
    }
    const rec = r as Record<string, unknown>
    if (typeof rec.name !== 'string' || typeof rec.path !== 'string') {
      throw new Error(`Bundle ${path} repos[${i}] missing name or path`)
    }
    return {
      name: rec.name,
      path: rec.path,
      ...(typeof rec.repo_url === 'string' ? { repo_url: rec.repo_url } : {}),
    }
  })
  const engineers = obj.engineers.map((e, i) => {
    if (typeof e !== 'string') {
      throw new Error(`Bundle ${path} engineers[${i}] is not a string`)
    }
    return e
  })
  return {
    name: obj.name,
    ...(typeof obj.server_url === 'string'
      ? { server_url: obj.server_url }
      : {}),
    ...(typeof obj.convex_url === 'string'
      ? { convex_url: obj.convex_url }
      : {}),
    repos,
    engineers,
  }
}
