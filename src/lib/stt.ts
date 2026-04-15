import OpenAI from 'openai';
import { createReadStream } from 'fs';

/**
 * Transcribes an audio file (any format Whisper accepts) via OpenAI.
 * The file is produced by the dashboard's browser MediaRecorder — no
 * native audio capture happens in the CLI itself.
 */
export async function transcribe(audioPath: string): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const transcription = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file: createReadStream(audioPath),
    language: 'en',
  });

  return transcription.text;
}
