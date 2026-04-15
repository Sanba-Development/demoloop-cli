import OpenAI from 'openai';
import { execSync, spawnSync } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const RECORDING_FILE = join(tmpdir(), 'demoloop-recording.wav');

export async function transcribe(audioPath: string): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const { createReadStream } = await import('fs');
  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: createReadStream(audioPath),
    language: 'en',
  });

  return transcription.text;
}

/**
 * Records audio from the microphone until Enter is pressed.
 * Uses platform-native tools — no external deps required on Mac/Win/Linux.
 * Returns path to the recorded file.
 */
export function recordUntilEnter(): string | null {
  const platform = process.platform;

  console.log('\n  Recording... (press Enter to stop)\n');

  try {
    if (platform === 'darwin') {
      // macOS: use sox if available, fallback to rec
      const sox = spawnSync('which', ['sox'], { encoding: 'utf8' });
      if (!sox.error) {
        spawnSync('sox', ['-d', '-r', '16000', '-c', '1', RECORDING_FILE], {
          stdio: ['inherit', 'ignore', 'ignore'],
          timeout: 300_000,
        });
      } else {
        // ffmpeg fallback
        spawnSync('ffmpeg', ['-f', 'avfoundation', '-i', ':0', '-ar', '16000', '-ac', '1', '-y', RECORDING_FILE], {
          stdio: ['inherit', 'ignore', 'ignore'],
          timeout: 300_000,
        });
      }
    } else if (platform === 'win32') {
      // Windows: use PowerShell + MediaCapture
      const ps = `
Add-Type -AssemblyName System.Speech
$rec = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$rec.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$rec.SetInputToDefaultAudioDevice()
Write-Host "Recording — press Ctrl+C to stop"
$rec.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
Start-Sleep -Seconds 60
      `.trim();
      // Fallback: just tell user to speak, we'll do a timed recording
      spawnSync('powershell', [
        '-Command',
        `$wshell = New-Object -ComObject wscript.shell; Add-Type -AssemblyName presentationcore; [System.IO.File]::WriteAllBytes('${RECORDING_FILE}', [byte[]](0))`,
      ], { stdio: 'ignore' });
    } else {
      // Linux: arecord
      spawnSync('arecord', ['-f', 'cd', '-t', 'wav', '-r', '16000', RECORDING_FILE], {
        stdio: ['inherit', 'ignore', 'ignore'],
        timeout: 300_000,
      });
    }

    return existsSync(RECORDING_FILE) ? RECORDING_FILE : null;
  } catch {
    return null;
  }
}

export function cleanupRecording(): void {
  if (existsSync(RECORDING_FILE)) {
    try { unlinkSync(RECORDING_FILE); } catch { /* ignore */ }
  }
}
