import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { parseAgentOutput } from '../lib/agent-parser.js';
import { generateDemoScript, speak, AUDIO_EXT } from '../lib/tts.js';
import { extractTasks, writeToBacklog, saveSession } from '../lib/task-writer.js';
import { startDashboard, getFeedbackFromDashboard, markAudioReady } from './dashboard.js';

interface StartOptions {
  path: string;
  voice: boolean;
  browser: boolean;
  url?: string;
}

const teal  = chalk.hex('#00e5b0');
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

  agentOutput.stories.forEach((s, i) => {
    console.log(`  ${muted(`[${i + 1}]`)} ${chalk.white(s.title)}`);
    if (s.filesChanged.length) {
      const preview = s.filesChanged.slice(0, 3).join(', ');
      const more = s.filesChanged.length > 3 ? muted(` +${s.filesChanged.length - 3} more`) : '';
      console.log(`       ${muted(preview)}${more}`);
    }
  });
  console.log('');

  const port = parseInt(process.env.DEMOLOOP_PORT ?? '4242', 10);
  const audioPath = join(projectPath, '.demoloop', `demo-session.${AUDIO_EXT}`);

  // Delete stale audio from previous sessions so the browser doesn't load a bad file
  for (const ext of ['mp3', 'wav']) {
    const stale = join(projectPath, '.demoloop', `demo-session.${ext}`);
    if (existsSync(stale)) { try { unlinkSync(stale); } catch { /* ignore */ } }
  }

  // 2. Start dashboard immediately — browser opens while audio generates in background
  const server = startDashboard({
    port: String(port),
    autoOpen: options.browser,
    stories: agentOutput.stories,
    projectPath,
    productUrl: options.url,
    audioPath: options.voice ? audioPath : undefined,
  });

  // 3. Generate demo script + TTS in background (dashboard polls /api/audio/status)
  if (options.voice) {
    (async () => {
      const scriptSpinner = ora({ text: 'Writing demo script...', color: 'cyan' }).start();
      try {
        const script = await generateDemoScript(agentOutput.stories, options.url);
        scriptSpinner.succeed('Demo script ready');

        const ttsSpinner = ora({ text: 'Generating voice walkthrough...', color: 'cyan' }).start();
        await speak(script, audioPath);
        markAudioReady();
        ttsSpinner.succeed('Voice ready — playing in browser');
      } catch (err) {
        scriptSpinner.fail(`Voice skipped — ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    })();
  }

  // 4. Wait for feedback from browser
  console.log('');
  console.log(teal('> Waiting for your feedback in the browser...'));
  console.log(muted(`  http://localhost:${port}  — record or type, then hit Submit.`));
  if (options.url) console.log(muted(`  Product open at: ${options.url}`));
  console.log('');

  const { transcript, storyFeedback } = await getFeedbackFromDashboard(port);

  console.log('');
  if (storyFeedback && storyFeedback.length > 0) {
    storyFeedback.forEach(f => {
      console.log(`  ${teal(`[${f.storyTitle}]`)} ${chalk.white(f.transcript)}`);
    });
  } else {
    console.log(muted('  Feedback received:'));
    console.log(`  "${chalk.white(transcript)}"`);
  }

  // 5. Extract tasks
  console.log('');
  const taskSpinner = ora({ text: 'Extracting tasks from feedback...', color: 'cyan' }).start();
  const tasks = await extractTasks(
    storyFeedback && storyFeedback.length > 0 ? storyFeedback : transcript,
    agentOutput.stories
  );
  taskSpinner.succeed(`${tasks.length} task${tasks.length === 1 ? '' : 's'} queued`);

  // 6. Persist
  const session = {
    date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    stories: agentOutput.stories.map(s => ({ id: s.id, title: s.title })),
    transcript,
    storyFeedback,
    tasks,
  };

  writeToBacklog(projectPath, session);
  const sessionPath = saveSession(projectPath, session);

  server.close();

  // 7. Print summary
  console.log('');
  console.log(teal('> Next sprint tasks:'));
  tasks.forEach(t => {
    const pc = t.priority === 'high' ? chalk.red : t.priority === 'medium' ? chalk.yellow : muted;
    console.log(`  ${pc(`[${t.priority.toUpperCase()}]`)} ${chalk.white(t.title)}`);
    console.log(`         ${muted(t.description)}`);
  });
  console.log('');
  console.log(muted(`  Backlog: BACKLOG.md`));
  console.log(muted(`  Session: ${sessionPath}`));
  console.log('');
}
