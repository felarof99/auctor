import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  type Classification,
  ClassificationSchema,
} from '@auctor/shared/classification'

export interface ClassificationCacheKeyInput {
  unitId: string
  commitShas: string[]
  diffHash: string
  backend: string
  executor?: string | null
  model?: string | null
  effort?: string | null
  promptVersion: string
  skillBundleHash?: string | null
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(',')}}`
}

export function buildClassificationCacheKey(
  input: ClassificationCacheKeyInput,
): string {
  const payload = {
    unitId: input.unitId,
    commitShas: input.commitShas,
    diffHash: input.diffHash,
    backend: input.backend,
    executor: input.executor ?? null,
    model: input.model ?? null,
    effort: input.effort ?? null,
    promptVersion: input.promptVersion,
    skillBundleHash: input.skillBundleHash ?? null,
  }

  return createHash('sha256').update(stableJsonStringify(payload)).digest('hex')
}

export class ClassificationCache {
  private db: Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.ensureSchema()
  }

  private ensureSchema(): void {
    const table = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'classifications'",
      )
      .get() as { name: string } | undefined

    if (!table) {
      this.createSchema()
      return
    }

    const columns = this.db
      .prepare('PRAGMA table_info(classifications)')
      .all() as { name: string }[]

    if (columns.some((column) => column.name === 'cache_key')) {
      return
    }

    const legacyTable = `classifications_legacy_${Date.now()}`
    this.db.exec('BEGIN')
    try {
      this.db.exec(
        `ALTER TABLE classifications RENAME TO "${legacyTable.replaceAll('"', '""')}"`,
      )
      this.createSchema()
      this.db
        .prepare(
          `INSERT INTO classifications (
            cache_key,
            work_unit_id,
            backend,
            executor,
            classification_json,
            created_at
          )
          SELECT
            work_unit_id,
            work_unit_id,
            'legacy',
            NULL,
            classification_json,
            created_at
          FROM "${legacyTable.replaceAll('"', '""')}"`,
        )
        .run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS classifications (
        cache_key TEXT PRIMARY KEY,
        work_unit_id TEXT NOT NULL,
        backend TEXT NOT NULL DEFAULT 'legacy',
        executor TEXT,
        classification_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)
  }

  getByKey(cacheKey: string): Classification | null {
    const row = this.db
      .prepare(
        'SELECT classification_json FROM classifications WHERE cache_key = ?',
      )
      .get(cacheKey) as { classification_json: string } | undefined

    if (!row) return null

    const parsed = ClassificationSchema.safeParse(
      JSON.parse(row.classification_json),
    )
    if (!parsed.success) return null

    return parsed.data
  }

  setByKey(
    cacheKey: string,
    workUnitId: string,
    backend: string,
    executor: string | null,
    classification: Classification,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO classifications (
          cache_key,
          work_unit_id,
          backend,
          executor,
          classification_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        cacheKey,
        workUnitId,
        backend,
        executor,
        JSON.stringify(classification),
      )
  }

  get(workUnitId: string): Classification | null {
    return this.getByKey(workUnitId)
  }

  set(workUnitId: string, classification: Classification): void {
    this.setByKey(workUnitId, workUnitId, 'legacy', null, classification)
  }

  close(): void {
    this.db.close()
  }
}
