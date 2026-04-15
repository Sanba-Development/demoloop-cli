import chalk from 'chalk';
import { createDashboardServer } from '../dashboard/server.js';
import type { Story } from '../lib/agent-parser.js';

interface DashboardOptions {
  port: string;
  autoOpen?: boolean;
  stories?: Story[];
}

export function dashboardCommand(options: DashboardOptions): void {
  startDashboard(options);
}

export function startDashboard(options: DashboardOptions): void {
  const port = parseInt(options.port ?? '4242', 10);
  const projectPath = process.cwd();
  const stories = options.stories ?? [];
  const teal = chalk.hex('#00e5b0');
  const muted = chalk.hex('#888888');

  const server = createDashboardServer(stories, projectPath);

  server.listen(port, '127.0.0.1', async () => {
    const url = `http://localhost:${port}`;
    console.log(teal(`> Dashboard running at ${url}`));
    console.log(muted('  Auto-refreshes every 5s. Ctrl+C to stop.'));

    if (options.autoOpen !== false) {
      const { default: open } = await import('open');
      await open(url);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(muted(`  Port ${port} in use — dashboard already running at http://localhost:${port}`));
    }
  });
}
