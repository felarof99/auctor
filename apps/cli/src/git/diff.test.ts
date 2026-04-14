import { describe, expect, test } from 'bun:test'
import { getDiffForCommits } from './diff'

const REPO = '/Users/felarof01/Workspaces/build/COMPANY_ADMIN/auctor-v4'

describe('getDiffForCommits', () => {
  test('returns empty string for 0 shas', async () => {
    const result = await getDiffForCommits(REPO, [])
    expect(result).toBe('')
  })

  test('returns a string diff for a single real commit', async () => {
    // Use a known commit from this repo
    const sha = 'f828b6f'
    const result = await getDiffForCommits(REPO, [sha])
    expect(typeof result).toBe('string')
    // The initial commit should produce some diff output
    expect(result.length).toBeGreaterThan(0)
  })

  test('returns a string diff for multiple commits', async () => {
    const shas = ['f828b6f', 'e8dd51b']
    const result = await getDiffForCommits(REPO, shas)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })
})
