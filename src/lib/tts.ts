import OpenAI from 'openai';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { Story } from './agent-parser.js';

const VOICE = (process.env.DEMOLOOP_VOICE as OpenAI.Audio.Speech.SpeechCreateParams['voice']) || 'onyx';
const FORMAT: OpenAI.Audio.Speech.SpeechCreateParams['response_format'] = 'mp3';
export const AUDIO_EXT = 'mp3';

/**
 * Uses GPT-4o to write a proper demo narration — not a commit log read-aloud.
 * Describes what was built, what to look at, and why it matters.
 */
export async function generateDemoScript(
  stories: Story[],
  productUrl?: string
): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const storyList = stories
    .map((s, i) => {
      const files = s.filesChanged.length
        ? `Files changed: ${s.filesChanged.slice(0, 6).join(', ')}`
        : '';
      return `Story ${i + 1}: "${s.title}"\n${s.description}\n${files}`.trim();
    })
    .join('\n\n');

  const urlContext = productUrl
    ? `The user will have the product open at ${productUrl} while listening.`
    : 'The user does not have a product URL open.';

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You write spoken demo scripts for AI agent sprint reviews.
Your job: narrate what was built as if you're a developer giving a live demo walkthrough.
Tone: direct, technical, conversational. No filler. No "great job" or corporate speak.
Rules:
- Open with one sentence setting context for the sprint, then go story by story
- For each story: explain WHAT was built, WHY it matters, and WHAT to look at (specific UI elements, files, or behaviors — not just the name)
- If the user has a product URL open, tell them what to look at ("in the top nav", "scroll down to the form", "notice the terminal mockup")
- Don't repeat the story title and description verbatim — interpret and expand them
- Transition naturally between stories. Use phrases like "Moving on..." or "Next up..."
- Close with a single sentence inviting feedback: what worked, what didn't, what to change
- Target 90–150 words per story. Total script: under 4 minutes spoken
- Write for Text-to-Speech: no markdown, no bullet points, just clean prose paragraphs`,
      },
      {
        role: 'user',
        content: `Sprint stories to demo:\n\n${storyList}\n\n${urlContext}`,
      },
    ],
    temperature: 0.4,
  });

  return completion.choices[0]?.message?.content?.trim() ?? fallbackScript(stories);
}

function fallbackScript(stories: Story[]): string {
  const intro = `Alright, let's walk through what got built this sprint. ${stories.length} ${stories.length === 1 ? 'story' : 'stories'} to cover.`;
  const body = stories
    .map((s, i) => `Story ${i + 1}: ${s.title}. ${s.description}`)
    .join(' ... ');
  return `${intro} ${body} That's the sprint. Talk me through your feedback when you're ready.`;
}

/** Converts a script to speech and writes it to outputPath. */
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
