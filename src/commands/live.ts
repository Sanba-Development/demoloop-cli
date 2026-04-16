import chalk from 'chalk';
import ora from 'ora';
import { parseAgentOutput } from '../lib/agent-parser.js';
import { startDashboard } from './dashboard.js';

interface LiveOptions {
  path: string;
  url?: string;
  port?: string;
}

const teal  = chalk.hex('#00e5b0');
const muted = chalk.hex('#888888');

export async function liveCommand(options: LiveOptions): Promise<void> {
  const projectPath = options.path;
  const port = options.port ?? process.env.DEMOLOOP_PORT ?? '4242';

  console.log('');
  console.log(teal('> DemoLoop — Live Session'));
  console.log(muted('  Parsing sprint context...'));
  console.log('');

  const spinner = ora({ text: 'Loading stories...', color: 'cyan' }).start();
  const agentOutput = parseAgentOutput(projectPath);

  if (agentOutput.stories.length === 0) {
    spinner.fail('No stories found. Add a demo-session.md or make sure you have recent commits.');
    process.exit(1);
  }

  const sourceLabel = agentOutput.source === 'demo-session.md'
    ? 'demo-session.md'
    : `${agentOutput.stories.length} git commits`;
  spinner.succeed(`${agentOutput.stories.length} stories loaded from ${sourceLabel}`);

  agentOutput.stories.forEach((s, i) => {
    console.log(`  ${muted(`[${i + 1}]`)} ${chalk.white(s.title)}`);
  });
  console.log('');

  // Start the dashboard server with realtime proxy attached
  const server = startDashboard({
    port,
    autoOpen: true,
    stories: agentOutput.stories,
    projectPath,
    productUrl: options.url,
    sprintSummary: agentOutput.agentLogSnippet,
    liveMode: true,
  });

  console.log(teal(`> Live session: http://localhost:${port}/live`));
  if (options.url) console.log(muted(`  Product:        ${options.url}`));
  console.log('');
  console.log(muted('  The AI will walk through the sprint and respond to your voice in real time.'));
  console.log(muted('  Ctrl+C to end the session.'));
  console.log('');

  // Keep process alive
  process.on('SIGINT', () => {
    server.close();
    console.log('');
    console.log(muted('  Session ended.'));
    process.exit(0);
  });
}
