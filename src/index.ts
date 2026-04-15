#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { startCommand } from './commands/start.js';
import { dashboardCommand } from './commands/dashboard.js';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('demoloop')
  .description('AI agent demo layer — review what your agent built with voice, not logs')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize DemoLoop in the current project')
  .action(initCommand);

program
  .command('start')
  .description('Start a demo session for the latest agent output')
  .option('-p, --path <dir>', 'project path to analyze', process.cwd())
  .option('-u, --url <url>', 'product URL to open alongside the dashboard')
  .option('--no-voice', 'skip TTS, print transcript only')
  .option('--no-browser', 'skip opening the dashboard in browser')
  .action(startCommand);

program
  .command('dashboard')
  .description('Open the web dashboard')
  .option('--port <number>', 'port for local dashboard', '4242')
  .action(dashboardCommand);

program.parse();
