import { Server } from 'http';
import chalk from 'chalk';
import { createDashboardServer, markAudioReady } from '../dashboard/server.js';
export { markAudioReady };

interface FeedbackResult {
  transcript: string;
  storyFeedback?: Array<{ storyId: string; storyTitle: string; transcript: string }>;
}
import type { Story } from '../lib/agent-parser.js';

interface DashboardOptions {
  port: string | number;
  autoOpen?: boolean;
  stories?: Story[];
  projectPath?: string;
  productUrl?: string;
  audioPath?: string;
  sprintSummary?: string;
  liveMode?: boolean;
}

/** CLI command: demoloop dashboard */
export function dashboardCommand(options: DashboardOptions): void {
  startDashboard({ ...options, projectPath: process.cwd() });
}

/** Called from start.ts — returns the running server so it can be closed. */
export function startDashboard(options: DashboardOptions): Server {
  const port = parseInt(String(options.port ?? '4242'), 10);
  const projectPath = options.projectPath ?? process.cwd();
  const stories = options.stories ?? [];
  const teal = chalk.hex('#00e5b0');
  const muted = chalk.hex('#888888');

  const server = createDashboardServer(
    stories, projectPath, options.productUrl, options.audioPath, options.sprintSummary
  );

  server.listen(port, '127.0.0.1', async () => {
    const dashUrl = `http://localhost:${port}`;
    console.log(teal(`> Dashboard: ${dashUrl}`));
    if (options.productUrl) {
      console.log(chalk.hex('#888888')(`  Product:   ${options.productUrl}`));
    }

    if (options.autoOpen !== false) {
      const { default: open } = await import('open');
      if (options.productUrl) await open(options.productUrl);
      await open(options.liveMode ? `${dashUrl}/live` : dashUrl);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(muted(`  Port ${port} in use — dashboard already running.`));
    }
  });

  return server;
}

/**
 * Polls the dashboard server until the user submits feedback from the browser.
 * Resolves with the feedback string.
 */
export async function getFeedbackFromDashboard(port: number): Promise<FeedbackResult> {
  const url = `http://127.0.0.1:${port}/api/feedback/poll`;

  while (true) {
    try {
      const res  = await fetch(url);
      const data = await res.json() as { payload: FeedbackResult | null };
      if (data.payload !== null) return data.payload!;
    } catch { /* server warming up */ }
    await sleep(1500);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
