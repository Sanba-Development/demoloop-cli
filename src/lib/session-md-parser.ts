import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Story } from './agent-parser.js';

export interface DemoSession {
  sprintSummary: string;
  stories: Story[];
  source: 'demo-session.md';
}

/**
 * Parses a demo-session.md file written by an AI agent (Claude Code, Cursor, etc.).
 * Format:
 *
 * # DemoLoop Session
 *
 * ## Sprint Summary
 * One paragraph describing what was accomplished.
 *
 * ## Stories
 *
 * ### Story title here
 * **Status:** Complete
 * **What was built:** Description of what was implemented.
 * **What to look at:** Specific UI elements, routes, or behaviors to demo.
 * **Files changed:** file1.ts, file2.ts
 * **Notes:** Any caveats or follow-up items.
 */
export function parseDemoSessionMd(projectPath: string): DemoSession | null {
  const filePath = join(projectPath, 'demo-session.md');
  if (!existsSync(filePath)) return null;

  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');

  let sprintSummary = '';
  const stories: Story[] = [];

  let section: 'none' | 'summary' | 'stories' = 'none';
  let currentStory: Partial<Story & { whatToLookAt: string; notes: string }> | null = null;
  let summaryLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.match(/^## Sprint Summary/i)) { section = 'summary'; continue; }
    if (trimmed.match(/^## Stories/i)) { section = 'stories'; continue; }

    if (section === 'summary') {
      if (trimmed && !trimmed.startsWith('#')) summaryLines.push(trimmed);
      continue;
    }

    if (section === 'stories') {
      // New story heading
      if (trimmed.startsWith('### ')) {
        if (currentStory?.title) stories.push(finalizeStory(currentStory));
        currentStory = {
          id: slugify(trimmed.slice(4)),
          title: trimmed.slice(4).trim(),
          description: '',
          filesChanged: [],
        };
        continue;
      }

      if (!currentStory) continue;

      const builtMatch   = trimmed.match(/^\*\*What was built:\*\*\s*(.+)/i);
      const lookMatch    = trimmed.match(/^\*\*What to look at:\*\*\s*(.+)/i);
      const filesMatch   = trimmed.match(/^\*\*Files changed:\*\*\s*(.+)/i);
      const notesMatch   = trimmed.match(/^\*\*Notes:\*\*\s*(.+)/i);
      const statusMatch  = trimmed.match(/^\*\*Status:\*\*\s*(.+)/i);

      if (builtMatch)  { currentStory.description  = builtMatch[1].trim(); continue; }
      if (lookMatch)   { (currentStory as any).whatToLookAt = lookMatch[1].trim(); continue; }
      if (filesMatch)  { currentStory.filesChanged  = filesMatch[1].split(',').map(f => f.trim()).filter(Boolean); continue; }
      if (notesMatch)  { (currentStory as any).notes = notesMatch[1].trim(); continue; }
      if (statusMatch) continue; // consumed, not stored separately
    }
  }

  if (currentStory?.title) stories.push(finalizeStory(currentStory));
  sprintSummary = summaryLines.join(' ').trim();

  if (stories.length === 0) return null;
  return { sprintSummary, stories, source: 'demo-session.md' };
}

function finalizeStory(s: Partial<Story & { whatToLookAt?: string; notes?: string }>): Story {
  const desc = [s.description, s.whatToLookAt ? `Look at: ${s.whatToLookAt}` : '', s.notes ? `Note: ${s.notes}` : '']
    .filter(Boolean).join(' ');
  return {
    id:           s.id ?? slugify(s.title ?? 'story'),
    title:        s.title ?? 'Untitled story',
    description:  (desc || s.title) ?? '',
    filesChanged: s.filesChanged ?? [],
  };
}

function slugify(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
}
