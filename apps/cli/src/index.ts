#!/usr/bin/env bun
import { Command } from 'commander'
import { analyze } from './commands/analyze'
import { configure } from './commands/configure'
import { microscope } from './commands/microscope'

const program = new Command()
  .name('auctor')
  .description('Team coding productivity tracker')
  .version('0.1.0')

program
  .command('configure')
  .allowUnknownOption()
  .description(
    'Add one or more repos to a bundle and refresh its engineer list',
  )
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<time-window>', 'Time window for author scan (e.g., -7d, -30d)')
  .argument('<repos...>', 'One or more paths to git repositories to add')
  .option('--name <name>', 'Bundle name to use when creating a new config')
  .option(
    '--engineers <usernames>',
    'Comma-separated GitHub usernames to track without prompting',
  )
  .option('--all-engineers', 'Track all discovered authors without prompting')
  .action(
    async (
      configPath: string,
      timeWindow: string,
      repoPaths: string[],
      opts: {
        name?: string
        engineers?: string
        allEngineers?: boolean
      },
    ) => {
      await configure(configPath, timeWindow, repoPaths, opts)
    },
  )

program
  .command('analyze')
  .allowUnknownOption()
  .description(
    'Analyze a bundle: one leaderboard across all repos in the bundle',
  )
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d, 0d)')
  .option('--json <file>', 'Write RepoReport JSON to file')
  .option(
    '--no-fetch',
    'Skip git fetch before analyzing (faster, but may miss branches)',
  )
  .action(
    async (
      configPath: string,
      timeWindow: string,
      opts: { json?: string; fetch: boolean },
    ) => {
      await analyze(configPath, timeWindow, opts.json, { fetch: opts.fetch })
    },
  )

program
  .command('microscope')
  .allowUnknownOption()
  .description('Zoom into one engineer across a bundle, grouped by day')
  .argument('<config>', 'Path to bundle YAML file')
  .argument('<time-window>', 'Time window (e.g., -7d, -30d)')
  .option('--engineer <username>', 'GitHub username to inspect')
  .option('--json <file>', 'Write microscope report JSON to file')
  .action(
    async (
      configPath: string,
      timeWindow: string,
      opts: { engineer?: string; json?: string },
    ) => {
      await microscope(configPath, timeWindow, {
        engineer: opts.engineer,
        jsonPath: opts.json,
      })
    },
  )

program.parse()
