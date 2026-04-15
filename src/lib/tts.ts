import OpenAI from 'openai';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { execSync, spawnSync } from 'child_process';

const VOICE = (process.env.DEMOLOOP_VOICE as OpenAI.Audio.Speech.SpeechCreateParams['voice']) || 'onyx';

// WAV on Windows (SoundPlayer is native, no extra tools needed).
// MP3 on Mac/Linux (afplay/paplay handle it fine).
const FORMAT: OpenAI.Audio.Speech.SpeechCreateParams['response_format'] =
  process.platform === 'win32' ? 'wav' : 'mp3';

export const AUDIO_EXT = FORMAT === 'wav' ? 'wav' : 'mp3';

export async function speak(text: string, outputPath: string): Promise<void> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.audio.speech.create({
    model: 'tts-1',
    voice: VOICE,
    input: text,
    response_format: FORMAT,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);
}

export function playAudio(filePath: string): void {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // WAV-only SoundPlayer — works on every Windows 10/11 machine, no installs needed.
      const escaped = filePath.replace(/\\/g, '\\\\');
      spawnSync('powershell', [
        '-NoProfile', '-NonInteractive', '-Command',
        `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`,
      ], { stdio: 'ignore' });
    } else if (platform === 'darwin') {
      spawnSync('afplay', [filePath], { stdio: 'ignore' });
    } else {
      // Linux: try paplay (PulseAudio) then aplay (ALSA)
      const pa = spawnSync('paplay', [filePath], { stdio: 'ignore' });
      if (pa.status !== 0) spawnSync('aplay', [filePath], { stdio: 'ignore' });
    }
  } catch {
    // Playback failed silently — transcript is still shown in dashboard.
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
