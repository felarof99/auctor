import { spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

interface ResultRootOption {
  label: string
  path: string
}

const dashboardDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(dashboardDir, '../..')
const syncScript = join(dashboardDir, 'sync.sh')

export default defineConfig({
  plugins: [dashboardSyncPlugin(), tailwindcss(), react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
})

function dashboardSyncPlugin(): Plugin {
  return {
    name: 'dashboard-sync-api',
    configureServer(server) {
      server.middlewares.use('/api/result-roots', async (_req, res) => {
        sendJson(res, 200, { roots: discoverResultRoots() })
      })
      server.middlewares.use('/api/sync', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed' })
          return
        }
        const body = await readJson(req)
        const sourceRoot =
          typeof body.sourceRoot === 'string' ? body.sourceRoot : 'out'
        const allowedRoots = discoverResultRoots().map((root) => root.path)
        if (!allowedRoots.includes(sourceRoot)) {
          sendJson(res, 400, { error: `Unknown result root: ${sourceRoot}` })
          return
        }
        const result = await runSync(sourceRoot)
        if (result.exitCode !== 0) {
          sendJson(res, 500, {
            error: result.stderr || result.stdout || 'sync.sh failed',
          })
          return
        }
        sendJson(res, 200, { ok: true, output: result.stdout })
      })
    },
  }
}

function discoverResultRoots(): ResultRootOption[] {
  const roots = new Map<string, ResultRootOption>()
  roots.set('out', { label: 'out', path: 'out' })
  addBundleRoots(roots, 'out', 'results')
  addBundleRoots(roots, 'configs', '.results')
  return [...roots.values()]
}

function addBundleRoots(
  roots: Map<string, ResultRootOption>,
  parent: string,
  resultsDirName: string,
): void {
  const parentPath = join(repoRoot, parent)
  if (!existsSync(parentPath)) return
  for (const entry of readdirSync(parentPath)) {
    const bundlePath = join(parentPath, entry)
    if (!statSync(bundlePath).isDirectory()) continue
    if (!existsSync(join(bundlePath, resultsDirName))) continue
    const path = `${parent}/${entry}`
    roots.set(path, { label: path, path })
  }
}

function runSync(
  sourceRoot: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(syncScript, [sourceRoot], { cwd: repoRoot })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', (error) => {
      stderr.push(Buffer.from(error.message))
      resolveRun({
        exitCode: 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      })
    })
    child.on('close', (exitCode) => {
      resolveRun({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
      })
    })
  })
}

async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString())
  } catch {
    return {}
  }
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  res.statusCode = statusCode
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify(body))
}
