import OpenAI from 'openai';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface SessionRecord {
  date: string;
  stories: Array<{ id: string; title: string }>;
  transcript: string;
  tasks: Task[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  source: string; // which story it came from
}

/**
 * Uses GPT-4o to extract structured tasks from spoken feedback transcript.
 */
export async function extractTasks(
  transcript: string,
  stories: Array<{ id: string; title: string; description: string }>
): Promise<Task[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const storySummary = stories
    .map((s) => `- [${s.id}] ${s.title}: ${s.description}`)
    .join('\n');

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a technical project manager. Extract actionable tasks from spoken developer feedback.
Return JSON only — an array of task objects with fields: id (short-slug), title (imperative, ≤8 words), description (1–2 sentences), priority (high/medium/low), source (story id or "general").
Only include concrete, actionable items. Ignore filler speech. Deduplicate.`,
      },
      {
        role: 'user',
        content: `Sprint stories reviewed:\n${storySummary}\n\nSpoken feedback transcript:\n"${transcript}"`,
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const raw = completion.choices[0]?.message?.content ?? '{"tasks":[]}';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.tasks) ? parsed.tasks : parsed;
  } catch {
    return [];
  }
}

/**
 * Appends a session + task list to BACKLOG.md in the project root.
 */
export function writeToBacklog(
  projectPath: string,
  session: SessionRecord
): void {
  const backlogPath = join(projectPath, 'BACKLOG.md');

  const taskLines = session.tasks
    .map((t) => `- [ ] **[${t.priority.toUpperCase()}]** ${t.title} — ${t.description}`)
    .join('\n');

  const block = `
## Session ${session.date}

**Stories reviewed:** ${session.stories.map((s) => s.title).join(', ')}

### Tasks

${taskLines || '_No tasks extracted._'}

<details>
<summary>Full transcript</summary>

> ${session.transcript.replace(/\n/g, '\n> ')}

</details>

---
`;

  if (existsSync(backlogPath)) {
    const existing = readFileSync(backlogPath, 'utf8');
    // Insert after the header
    const insertAt = existing.indexOf('\n---\n') !== -1
      ? existing.indexOf('\n---\n') + 5
      : existing.indexOf('\n\n') + 2;
    const updated = existing.slice(0, insertAt) + block + existing.slice(insertAt);
    writeFileSync(backlogPath, updated, 'utf8');
  } else {
    writeFileSync(backlogPath, `# DemoLoop Backlog\n${block}`, 'utf8');
  }
}

/**
 * Saves the full session JSON to .demoloop/sessions/ for the dashboard.
 */
export function saveSession(projectPath: string, session: SessionRecord): string {
  const dir = join(projectPath, '.demoloop', 'sessions');
  mkdirSync(dir, { recursive: true });
  const filename = `${session.date.replace(/[: ]/g, '-')}.json`;
  const filepath = join(dir, filename);
  writeFileSync(filepath, JSON.stringify(session, null, 2), 'utf8');
  return filepath;
}
