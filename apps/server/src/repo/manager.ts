import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export class RepoManager {
  constructor(private baseDir: string) {
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true })
    }
  }

  repoDir(repoUrl: string): string {
    const sanitized = repoUrl
      .replace(/^https?:\/\//, '')
      .replace(/\.git$/, '')
      .replace(/[/\\:]/g, '-')
    return join(this.baseDir, sanitized)
  }

  async ensureRepo(repoUrl: string): Promise<string> {
    const dir = this.repoDir(repoUrl)

    if (existsSync(join(dir, '.git'))) {
      const proc = Bun.spawn(['git', 'pull', '--ff-only'], { cwd: dir })
      await proc.exited
      if (proc.exitCode !== 0) {
        throw new Error(`git pull failed with exit code ${proc.exitCode}`)
      }
    } else {
      const proc = Bun.spawn(['git', 'clone', repoUrl, dir])
      await proc.exited
      if (proc.exitCode !== 0) {
        throw new Error(`git clone failed with exit code ${proc.exitCode}`)
      }
    }

    return dir
  }
}
