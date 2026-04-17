import type { BundleConfig, Commit } from './types'

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase()
}

export function extractGithubUsername(email: string): string | null {
  const noreplyMatch = email.match(/^\d+\+(.+)@users\.noreply\.github\.com$/i)
  if (noreplyMatch) return noreplyMatch[1]

  const simpleNoreply = email.match(/^(.+)@users\.noreply\.github\.com$/i)
  if (simpleNoreply) return simpleNoreply[1]

  return null
}

export function primaryAuthorIdentity(name: string, email?: string): string {
  if (email) {
    const githubUsername = extractGithubUsername(email)
    if (githubUsername) return githubUsername

    const localPart = email.split('@')[0]
    if (localPart) return localPart
  }

  return name
}

export function authorIdentities(name: string, email?: string): string[] {
  const identities = new Set<string>()

  const add = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (trimmed) identities.add(normalizeIdentity(trimmed))
  }

  add(name)
  add(email)

  if (email) {
    add(extractGithubUsername(email) ?? undefined)
    add(email.split('@')[0])
  }

  return [...identities]
}

export function createAuthorResolver(
  bundle: Pick<BundleConfig, 'engineers' | 'aliases'>,
): (commit: Commit) => string | null {
  const canonicalByIdentity = new Map<string, string>()

  for (const engineer of bundle.engineers) {
    const aliases = bundle.aliases?.[engineer] ?? []
    for (const identity of [engineer, ...aliases]) {
      for (const normalized of authorIdentities(identity)) {
        canonicalByIdentity.set(normalized, engineer)
      }
    }
  }

  return (commit: Commit) => {
    for (const identity of authorIdentities(
      commit.author,
      commit.authorEmail,
    )) {
      const canonical = canonicalByIdentity.get(identity)
      if (canonical) return canonical
    }
    return null
  }
}
