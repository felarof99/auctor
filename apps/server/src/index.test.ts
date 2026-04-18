import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

const originalHost = process.env.HOST
const originalPort = process.env.PORT
const originalLog = console.log
let logs: string[] = []

async function importServerConfig(id: string): Promise<{
  hostname: string
  port: number
}> {
  const module = await import(`./index.ts?${id}-${Date.now()}-${Math.random()}`)
  return module.default
}

beforeEach(() => {
  logs = []
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '))
  }
})

afterEach(() => {
  if (originalHost === undefined) {
    delete process.env.HOST
  } else {
    process.env.HOST = originalHost
  }
  if (originalPort === undefined) {
    delete process.env.PORT
  } else {
    process.env.PORT = originalPort
  }
  console.log = originalLog
})

describe('server bind address', () => {
  test('defaults to localhost only', async () => {
    delete process.env.HOST
    delete process.env.PORT

    const server = await importServerConfig('default-host')

    expect(server.hostname).toBe('127.0.0.1')
    expect(server.port).toBe(3001)
    expect(logs).toContain('Auctor server listening on 127.0.0.1:3001')
  })

  test('allows explicit host override', async () => {
    process.env.HOST = '0.0.0.0'
    process.env.PORT = '4123'

    const server = await importServerConfig('override-host')

    expect(server.hostname).toBe('0.0.0.0')
    expect(server.port).toBe(4123)
    expect(logs).toContain('Auctor server listening on 0.0.0.0:4123')
  })
})
