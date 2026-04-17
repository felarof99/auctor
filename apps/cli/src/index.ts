#!/usr/bin/env bun
import { Command } from 'commander'
import { analyze } from './commands/analyze'
import { configure } from './commands/configure'

const program = new Command()
  .name('auctor')
  .description('Team coding productivity tracker')
  .version('0.1.0')

program
  .command('configure')
  .description('Add a repo to a bundle and refresh its engineer list')
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<repo>', 'Path to git repository to add')
  .argument('<time-window>', 'Time window for author scan (e.g., -7d, -30d)')
  .action(async (configPath: string, repoPath: string, timeWindow: string) => {
    await configure(configPath, repoPath, timeWindow)
  })

program
  .command('analyze')
  .description('Analyze git history and show leaderboard')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--path <path>', 'Path to git repository', '.')
  .option('--json <file>', 'Write RepoReport JSON to file')
  .option(
    '--no-fetch',
    'Skip git fetch before analyzing (faster, but may miss branches)',
  )
  .action(
    async (
      timeWindow: string,
      opts: { path: string; json?: string; fetch: boolean },
    ) => {
      await analyze(timeWindow, opts.path, opts.json, { fetch: opts.fetch })
    },
  )

program.parse()
