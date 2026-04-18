import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  buildMicroscopeResultFilename,
  buildRepoResultFilename,
  formatResultStamp,
  getResultsDir,
  resolveBundleConfigPath,
} from './paths'

const ROOT = join(import.meta.dir, '../../..')

describe('resolveBundleConfigPath', () => {
  test('maps legacy configs paths into out bundle folders', () => {
    const result = resolveBundleConfigPath(
      'configs/browseros/browseros_config.yaml',
      ROOT,
    )

    expect(result).toBe(join(ROOT, 'out/browseros/browseros_config.yaml'))
  })

  test('maps bare config filenames into out bundle folders', () => {
    const result = resolveBundleConfigPath('acme.yaml', ROOT)

    expect(result).toBe(join(ROOT, 'out/acme/acme_config.yaml'))
  })

  test('preserves repo-local out paths', () => {
    const result = resolveBundleConfigPath('out/browseros/custom.yaml', ROOT)

    expect(result).toBe(join(ROOT, 'out/browseros/custom.yaml'))
  })

  test('preserves absolute paths outside the project', () => {
    const result = resolveBundleConfigPath('/tmp/browseros.yaml', ROOT)

    expect(result).toBe('/tmp/browseros.yaml')
  })
})

describe('result paths', () => {
  test('uses a visible results folder next to the config', () => {
    expect(getResultsDir('/repo/out/browseros/browseros_config.yaml')).toBe(
      '/repo/out/browseros/results',
    )
  })

  test('formats report timestamps as mon-dd-hh-mm', () => {
    const date = new Date(2026, 3, 18, 9, 42)

    expect(formatResultStamp(date)).toBe('apr-18-09-42')
  })

  test('prefixes repo report filenames with the timestamp', () => {
    const date = new Date(2026, 3, 18, 9, 42)

    expect(buildRepoResultFilename('BrowserOS Main', date)).toBe(
      'apr-18-09-42-browseros-main.json',
    )
  })

  test('prefixes microscope filenames with the timestamp', () => {
    const date = new Date(2026, 3, 18, 9, 42)

    expect(buildMicroscopeResultFilename('browseros', 'Alice', date)).toBe(
      'apr-18-09-42-browseros-microscope-alice.json',
    )
  })
})
