import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

export async function initCommand(): Promise<void> {
  const cwd = process.cwd();
  const configPath = join(cwd, 'demoloop.config.json');
  const sessionDir = join(cwd, '.demoloop', 'sessions');

  if (existsSync(configPath)) {
    console.log(chalk.hex('#00e5b0')('> DemoLoop already initialized.'));
    return;
  }

  const config = {
    voice: 'onyx',
    backlog: 'BACKLOG.md',
    agentLogPath: null,
    autoOpenDashboard: true,
  };

  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  // Add .demoloop/sessions to .gitignore if it exists
  const gitignorePath = join(cwd, '.gitignore');
  if (existsSync(gitignorePath)) {
    const { readFileSync, appendFileSync } = await import('fs').then((m) => m);
    const content = readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.demoloop/sessions')) {
      appendFileSync(gitignorePath, '\n.demoloop/sessions/\n');
    }
  }

  console.log(chalk.hex('#00e5b0')('> DemoLoop initialized.'));
  console.log(chalk.hex('#888888')('  Config: demoloop.config.json'));
  console.log(chalk.hex('#888888')('  Sessions: .demoloop/sessions/'));
  console.log('');
  console.log(chalk.white('  Run ') + chalk.hex('#00e5b0')('demoloop start') + chalk.white(' after your next agent session.'));
}
