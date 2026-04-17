import { describe, expect, test } from 'bun:test'
import { createAuthorResolver, primaryAuthorIdentity } from './author-identity'
import type { BundleConfig, Commit } from './types'

function commit(author: string, authorEmail?: string): Commit {
  return {
    sha: `${author}-${authorEmail ?? 'none'}`,
    author,
    ...(authorEmail ? { authorEmail } : {}),
    date: new Date('2026-04-17T12:00:00Z'),
    subject: 'test commit',
    insertions: 1,
    deletions: 0,
    isMerge: false,
  }
}

describe('primaryAuthorIdentity', () => {
  test('uses GitHub noreply username before the email local part', () => {
    expect(
      primaryAuthorIdentity(
        'GitHub Name',
        '56757235+shivammittal274@users.noreply.github.com',
      ),
    ).toBe('shivammittal274')
  })

  test('falls back to email local part for normal emails', () => {
    expect(primaryAuthorIdentity('Nikhil Sonti', 'nikhilsv92@gmail.com')).toBe(
      'nikhilsv92',
    )
  })
})

describe('createAuthorResolver', () => {
  test('matches configured usernames against commit author emails', () => {
    const bundle: BundleConfig = {
      name: 'browseros',
      repos: [],
      engineers: ['nikhilsv92', 'neelgupta04'],
    }
    const resolveAuthor = createAuthorResolver(bundle)

    expect(resolveAuthor(commit('Nikhil Sonti', 'nikhilsv92@gmail.com'))).toBe(
      'nikhilsv92',
    )
    expect(resolveAuthor(commit('Neel Gupta', 'neelgupta04@outlook.com'))).toBe(
      'neelgupta04',
    )
  })

  test('maps aliases to canonical dashboard names', () => {
    const bundle: BundleConfig = {
      name: 'browseros',
      repos: [],
      engineers: ['nikhil', 'dani', 'shivam', 'neel', 'felarof01'],
      aliases: {
        nikhil: ['nikhilsv92', 'Nikhil', 'Nikhil Sonti'],
        dani: ['DaniAkash', 'Dani Akash'],
        shivam: ['shivammittal274', 'mittal.shivam103'],
        neel: ['neelgupta04', 'Neel Gupta'],
        felarof01: ['nithin.sonti', 'Felarof'],
      },
    }
    const resolveAuthor = createAuthorResolver(bundle)

    expect(resolveAuthor(commit('Nikhil Sonti', 'nikhilsv92@gmail.com'))).toBe(
      'nikhil',
    )
    expect(
      resolveAuthor(commit('Dani Akash', 'DaniAkash@users.noreply.github.com')),
    ).toBe('dani')
    expect(
      resolveAuthor(commit('shivammittal274', 'mittal.shivam103@gmail.com')),
    ).toBe('shivam')
    expect(resolveAuthor(commit('Neel Gupta', 'neelgupta04@outlook.com'))).toBe(
      'neel',
    )
    expect(resolveAuthor(commit('Felarof', 'nithin.sonti@gmail.com'))).toBe(
      'felarof01',
    )
  })
})
