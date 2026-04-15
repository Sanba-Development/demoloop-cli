import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { parseAgentOutput } from '../lib/agent-parser.js';
import { speak, playAudio, buildDemoScript, AUDIO_EXT } from '../lib/tts.js';
import { extractTasks, writeToBacklog, saveSession } from '../lib/task-writer.js';
import { startDashboard, getFeedbackFromDashboard } from './dashboard.js';

interface StartOptions {
  path: string;
  voice: boolean;
  browser: boolean;
  url?: string;
}

const teal = chalk.hex('#00e5b0');
const muted = chalk.hex('#888888');

export async function startCommand(options: StartOptions): Promise<void> {
  const projectPath = options.path;

  console.log('');
  console.log(teal('> DemoLoop'));
  console.log(muted('  Analyzing agent output...'));
  console.log('');

  // 1. Parse agent output
  const parseSpinner = ora({ text: 'Summarizing stories...', color: 'cyan' }).start();
  const agentOutput = parseAgentOutput(projectPath);

  if (agentOutput.stories.length === 0) {
    parseSpinner.fail('No agent output found. Make sure you have recent commits or staged changes.');
    console.log(muted('  Run your AI agent first, then demoloop start.'));
    process.exit(1);
  }
  parseSpinner.succeed(`Found ${agentOutput.stories.length} ${agentOutput.stories.length === 1 ? 'story' : 'stories'}`);

  // 2. Print story list
  console.log('');
  agentOutput.stories.forEach((s, i) => {
    console.log(`  ${muted(`[${i + 1}]`)} ${chalk.white(s.title)}`);
    if (s.filesChanged.length) {
      const preview = s.filesChanged.slice(0, 3).join(', ');
      const more = s.filesChanged.length > 3 ? muted(` +${s.filesChanged.length - 3} more`) : '';
      console.log(`       ${muted(preview)}${more}`);
    }
  });
  console.log('');

  // 3. Start dashboard — opens browser, handles mic recording
  const port = parseInt(process.env.DEMOLOOP_PORT ?? '4242', 10);
  const server = startDashboard({
    port: String(port),
    autoOpen: options.browser,
    stories: agentOutput.stories,
    projectPath,
    productUrl: options.url,
  });

  // 4. Generate and play TTS walkthrough
  if (options.voice) {
    const script = buildDemoScript(agentOutput.stories);
    const audioPath = join(projectPath, '.demoloop', `demo-session.${AUDIO_EXT}`);

    const ttsSpinner = ora({ text: 'Generating voice walkthrough...', color: 'cyan' }).start();
    try {
      await speak(script, audioPath);
      ttsSpinner.succeed('Voice ready — playing now');
      console.log('');
      await playAudio(audioPath);
    } catch (err) {
      ttsSpinner.warn(`TTS skipped — ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  }

  // 5. Wait for feedback from the browser dashboard
  console.log('');
  console.log(teal('> Waiting for your feedback in the browser...'));
  console.log(muted(`  http://localhost:${port}  — record or type, then hit Submit.`));
  console.log('');

  const transcript = await getFeedbackFromDashboard(port);

  console.log('');
  console.log(muted('  Feedback received:'));
  console.log(`  "${chalk.white(transcript)}"`);

  // 6. Extract tasks
  console.log('');
  const taskSpinner = ora({ text: 'Extracting tasks from feedback...', color: 'cyan' }).start();
  const tasks = await extractTasks(transcript, agentOutput.stories);
  taskSpinner.succeed(`${tasks.length} task${tasks.length === 1 ? '' : 's'} queued`);

  // 7. Persist
  const session = {
    date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    stories: agentOutput.stories.map((s) => ({ id: s.id, title: s.title })),
    transcript,
    tasks,
  };

  writeToBacklog(projectPath, session);
  const sessionPath = saveSession(projectPath, session);

  server.close();

  // 8. Print summary
  console.log('');
  console.log(teal('> Next sprint tasks:'));
  tasks.forEach((t) => {
    const pc = t.priority === 'high' ? chalk.red : t.priority === 'medium' ? chalk.yellow : muted;
    console.log(`  ${pc(`[${t.priority.toUpperCase()}]`)} ${chalk.white(t.title)}`);
    console.log(`         ${muted(t.description)}`);
  });
  console.log('');
  console.log(muted(`  Backlog updated: BACKLOG.md`));
  console.log(muted(`  Session saved:   ${sessionPath}`));
  console.log('');
}
