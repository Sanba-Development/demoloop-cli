import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface Story {
  id: string;
  title: string;
  description: string;
  filesChanged: string[];
  diff?: string;
}

export interface AgentOutput {
  stories: Story[];
  rawDiff: string;
  commitMessages: string[];
  agentLogSnippet?: string;
}

/**
 * Extracts stories from the current git repo by reading recent commits,
 * diffs, and any agent log files (AGENT_LOG.md, .claude/sessions, etc.)
 */
export function parseAgentOutput(projectPath: string): AgentOutput {
  const stories: Story[] = [];
  let rawDiff = '';
  let commitMessages: string[] = [];
  let agentLogSnippet: string | undefined;

  try {
    // Get recent commit messages (since last demoloop session or last 10)
    const log = execSync('git log --oneline -10 --no-merges', {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    commitMessages = log.split('\n').filter(Boolean);
  } catch {
    commitMessages = [];
  }

  try {
    // Get the diff of recent work
    rawDiff = execSync('git diff HEAD~5..HEAD --stat', {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    try {
      rawDiff = execSync('git diff --cached --stat', {
        cwd: projectPath,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch {
      rawDiff = '';
    }
  }

  // Check for agent log files
  const agentLogPaths = [
    join(projectPath, 'AGENT_LOG.md'),
    join(projectPath, '.claude', 'session.md'),
    join(projectPath, 'agent-output.md'),
    join(projectPath, '.demoloop', 'last-run.md'),
  ];
  for (const p of agentLogPaths) {
    if (existsSync(p)) {
      agentLogSnippet = readFileSync(p, 'utf8').slice(0, 3000);
      break;
    }
  }

  // Build stories from commits — each commit = one story candidate
  commitMessages.forEach((line, i) => {
    const [hash, ...messageParts] = line.split(' ');
    const message = messageParts.join(' ');
    if (!message) return;

    stories.push({
      id: hash,
      title: cleanCommitTitle(message),
      description: buildStoryDescription(message, rawDiff),
      filesChanged: extractFilesForCommit(projectPath, hash),
    });
  });

  // Fallback: if no commits, create one story from the diff
  if (stories.length === 0 && rawDiff) {
    stories.push({
      id: 'working-changes',
      title: 'Uncommitted changes',
      description: 'There are staged or unstaged changes in the working directory.',
      filesChanged: [],
      diff: rawDiff,
    });
  }

  return { stories, rawDiff, commitMessages, agentLogSnippet };
}

function cleanCommitTitle(msg: string): string {
  // Remove conventional commit prefixes for natural speech
  return msg
    .replace(/^(feat|fix|chore|docs|refactor|test|style|ci|build|perf)(\(.+\))?:\s*/i, '')
    .replace(/^(add|update|remove|fix|implement|improve)\s+/i, (m) => m)
    .trim();
}

function buildStoryDescription(commitMsg: string, diff: string): string {
  const lines = diff.split('\n').filter((l) => l.includes('|')).slice(0, 5);
  if (lines.length > 0) {
    return `Commit: "${commitMsg}". Files touched: ${lines.map((l) => l.split('|')[0].trim()).join(', ')}.`;
  }
  return `Commit: "${commitMsg}".`;
}

function extractFilesForCommit(projectPath: string, hash: string): string[] {
  try {
    const output = execSync(`git diff-tree --no-commit-id -r --name-only ${hash}`, {
      cwd: projectPath,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return output.split('\n').filter(Boolean).slice(0, 10);
  } catch {
    return [];
  }
}
