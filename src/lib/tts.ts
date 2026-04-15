import OpenAI from 'openai';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const VOICE = (process.env.DEMOLOOP_VOICE as OpenAI.Audio.Speech.SpeechCreateParams['voice']) || 'onyx';

export async function speak(text: string, outputPath: string): Promise<void> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: VOICE,
    input: text,
    response_format: 'mp3',
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(outputPath.replace(/\/[^/]+$/, ''), { recursive: true });
  writeFileSync(outputPath, buffer);
}

export function playAudio(filePath: string): void {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      execSync(`powershell -c "(New-Object Media.SoundPlayer '${filePath}').PlaySync()"`, {
        stdio: 'ignore',
      });
    } else if (platform === 'darwin') {
      execSync(`afplay "${filePath}"`, { stdio: 'ignore' });
    } else {
      execSync(`aplay "${filePath}" 2>/dev/null || paplay "${filePath}"`, { stdio: 'ignore' });
    }
  } catch {
    // Audio playback failed silently — transcript still shown
  }
}

export function buildDemoScript(stories: Array<{ title: string; description: string }>): string {
  const intro = `Hey. Your agent finished the sprint. Here's what got built — ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}. I'll walk you through each one. Say "next" to move on, "redo" to hear it again, or just talk — I'm recording.`;

  const storyLines = stories
    .map(
      (s, i) =>
        `Story ${i + 1}: ${s.title}. ${s.description}`
    )
    .join(' ... ');

  const outro = `That's everything. When you're done talking, press Enter and I'll write up your feedback as the next sprint's task list.`;

  return [intro, storyLines, outro].join(' ');
}
