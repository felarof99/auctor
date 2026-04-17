import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  type Classification,
  ClassificationSchema,
} from '@auctor/shared/classification'

export class ClassificationCache {
  private db: Database

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS classifications (
        work_unit_id TEXT PRIMARY KEY,
        classification_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `)
  }

  get(workUnitId: string): Classification | null {
    const row = this.db
      .prepare(
        'SELECT classification_json FROM classifications WHERE work_unit_id = ?',
      )
      .get(workUnitId) as { classification_json: string } | undefined

    if (!row) return null

    const parsed = ClassificationSchema.safeParse(
      JSON.parse(row.classification_json),
    )
    if (!parsed.success) return null

    return parsed.data
  }

  set(workUnitId: string, classification: Classification): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO classifications (work_unit_id, classification_json) VALUES (?, ?)',
      )
      .run(workUnitId, JSON.stringify(classification))
  }

  close(): void {
    this.db.close()
  }
}
