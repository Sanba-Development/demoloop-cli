import { join } from 'path';
import { createInterface } from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { parseAgentOutput } from '../lib/agent-parser.js';
import { speak, playAudio, buildDemoScript } from '../lib/tts.js';
import { transcribe, recordUntilEnter, cleanupRecording } from '../lib/stt.js';
import { extractTasks, writeToBacklog, saveSession } from '../lib/task-writer.js';
import { startDashboard } from './dashboard.js';

interface StartOptions {
  path: string;
  voice: boolean;
  browser: boolean;
}

export async function startCommand(options: StartOptions): Promise<void> {
  const projectPath = options.path;
  const teal = chalk.hex('#00e5b0');
  const muted = chalk.hex('#888888');

  console.log('');
  console.log(teal('> DemoLoop'));
  console.log(muted('  Analyzing agent output...'));
  console.log('');

  // 1. Parse agent output
  const spinner = ora({ text: 'Summarizing stories...', color: 'cyan' }).start();
  const agentOutput = parseAgentOutput(projectPath);

  if (agentOutput.stories.length === 0) {
    spinner.fail('No agent output found. Make sure you have recent commits or staged changes.');
    console.log(muted('  Run your AI agent first, then demoloop start.'));
    process.exit(1);
  }

  spinner.succeed(`Found ${agentOutput.stories.length} ${agentOutput.stories.length === 1 ? 'story' : 'stories'}`);

  // 2. Show story summary
  console.log('');
  agentOutput.stories.forEach((s, i) => {
    console.log(`  ${muted(`[${i + 1}]`)} ${chalk.white(s.title)}`);
    if (s.filesChanged.length > 0) {
      console.log(`      ${muted(s.filesChanged.slice(0, 3).join(', '))}${s.filesChanged.length > 3 ? muted(` +${s.filesChanged.length - 3} more`) : ''}`);
    }
  });
  console.log('');

  // 3. Start dashboard in background (Option B)
  if (options.browser) {
    startDashboard({ port: '4242', autoOpen: true, stories: agentOutput.stories });
  }

  // 4. Generate and play TTS walkthrough
  if (options.voice) {
    const script = buildDemoScript(agentOutput.stories);
    const audioPath = join(projectPath, '.demoloop', 'demo-session.mp3');

    const ttsSpinner = ora({ text: 'Generating voice walkthrough...', color: 'cyan' }).start();
    try {
      await speak(script, audioPath);
      ttsSpinner.succeed('Voice ready');

      console.log('');
      console.log(teal('> Starting demo session. Press space to pause.'));
      console.log(muted('  Playing audio...'));
      console.log('');

      playAudio(audioPath);
    } catch (err) {
      ttsSpinner.warn('TTS failed — continuing without audio');
      console.log(muted(`  ${err instanceof Error ? err.message : String(err)}`));
    }
  } else {
    // Print transcript mode
    console.log(teal('> Demo transcript'));
    agentOutput.stories.forEach((s, i) => {
      console.log(`  ${teal(`[${i + 1}]`)} ${s.title}`);
      console.log(`      ${muted(s.description)}`);
    });
    console.log('');
  }

  // 5. Record feedback
  console.log(teal('> Your turn.'));
  console.log(muted('  Talk through your feedback. Press Enter when done.'));
  console.log('');

  // Wait for Enter to start recording
  await waitForEnter();

  const recordingPath = recordUntilEnter();

  let transcript = '';

  if (recordingPath) {
    const sttSpinner = ora({ text: 'Transcribing your feedback...', color: 'cyan' }).start();
    try {
      transcript = await transcribe(recordingPath);
      sttSpinner.succeed('Transcribed');
      console.log('');
      console.log(muted('  You said:'));
      console.log(`  "${chalk.white(transcript)}"`);
      cleanupRecording();
    } catch {
      sttSpinner.warn('Transcription failed — enter feedback manually');
      transcript = await promptManualFeedback();
    }
  } else {
    console.log(muted('  Audio recording not available on this system.'));
    transcript = await promptManualFeedback();
  }

  if (!transcript.trim()) {
    console.log(muted('  No feedback recorded. Session saved without tasks.'));
    transcript = '(no feedback)';
  }

  // 6. Extract tasks via GPT-4o
  console.log('');
  const taskSpinner = ora({ text: 'Extracting tasks from your feedback...', color: 'cyan' }).start();
  const tasks = await extractTasks(transcript, agentOutput.stories);
  taskSpinner.succeed(`${tasks.length} task${tasks.length === 1 ? '' : 's'} queued`);

  // 7. Write to BACKLOG.md and session file
  const session = {
    date: new Date().toISOString().replace('T', ' ').slice(0, 19),
    stories: agentOutput.stories.map((s) => ({ id: s.id, title: s.title })),
    transcript,
    tasks,
  };

  writeToBacklog(projectPath, session);
  const sessionPath = saveSession(projectPath, session);

  // 8. Print results
  console.log('');
  console.log(teal('> Next sprint tasks updated.'));
  tasks.forEach((t) => {
    const priorityColor = t.priority === 'high' ? chalk.red : t.priority === 'medium' ? chalk.yellow : muted;
    console.log(`  ${priorityColor(`[${t.priority.toUpperCase()}]`)} ${chalk.white(t.title)}`);
    console.log(`         ${muted(t.description)}`);
  });

  console.log('');
  console.log(muted(`  Backlog updated: BACKLOG.md`));
  console.log(muted(`  Session saved:   ${sessionPath}`));
  console.log('');
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(chalk.hex('#888888')('  Press Enter to start recording...'), () => {
      rl.close();
      resolve();
    });
  });
}

async function promptManualFeedback(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log(chalk.hex('#888888')('  Type your feedback (press Enter twice to submit):'));
    let lines: string[] = [];
    let emptyCount = 0;

    rl.on('line', (line) => {
      if (line === '') {
        emptyCount++;
        if (emptyCount >= 2) {
          rl.close();
          resolve(lines.join(' '));
        }
      } else {
        emptyCount = 0;
        lines.push(line);
      }
    });
  });
}
