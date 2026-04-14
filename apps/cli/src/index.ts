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
  .description('Configure author whitelist from git history')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--path <path>', 'Path to git repository', '.')
  .action(async (timeWindow: string, opts: { path: string }) => {
    await configure(timeWindow, opts.path)
  })

program
  .command('analyze')
  .description('Analyze git history and show leaderboard')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--path <path>', 'Path to git repository', '.')
  .action(async (timeWindow: string, opts: { path: string }) => {
    await analyze(timeWindow, opts.path)
  })

program.parse()
