import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Story } from '../lib/agent-parser.js';
import type { SessionRecord } from '../lib/task-writer.js';

export function createDashboardServer(stories: Story[], projectPath: string) {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    if (url === '/api/stories') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stories));
      return;
    }

    if (url === '/api/sessions') {
      const sessionsDir = join(projectPath, '.demoloop', 'sessions');
      if (!existsSync(sessionsDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
        return;
      }
      const sessions: SessionRecord[] = readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .slice(0, 20)
        .map((f) => {
          try {
            return JSON.parse(readFileSync(join(sessionsDir, f), 'utf8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(sessions));
      return;
    }

    // Serve the dashboard HTML
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardHTML());
  });
}

function getDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DemoLoop — Session Dashboard</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root { --bg:#0a0a0a; --surface:#141414; --border:#222; --teal:#00e5b0; --text:#f0f0f0; --muted:#888; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--text); font-family:'Inter',system-ui,sans-serif; font-size:15px; line-height:1.6; -webkit-font-smoothing:antialiased; }
  header { border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; gap:12px; }
  .wordmark { font-family:'JetBrains Mono',monospace; font-size:14px; }
  .wordmark span { color:var(--teal); }
  .badge { font-family:'JetBrains Mono',monospace; font-size:11px; color:var(--muted); background:var(--surface); border:1px solid var(--border); padding:3px 10px; border-radius:999px; }
  main { max-width:900px; margin:0 auto; padding:32px 24px; }
  h2 { font-size:13px; color:var(--muted); font-family:'JetBrains Mono',monospace; text-transform:uppercase; letter-spacing:0.1em; margin-bottom:16px; }
  .stories { display:grid; gap:12px; margin-bottom:40px; }
  .story-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:16px 20px; }
  .story-title { font-weight:600; margin-bottom:4px; }
  .story-files { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--muted); }
  .sessions { display:grid; gap:16px; }
  .session-card { background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:20px; }
  .session-date { font-family:'JetBrains Mono',monospace; font-size:12px; color:var(--teal); margin-bottom:12px; }
  .task { padding:8px 0; border-bottom:1px solid var(--border); display:flex; gap:10px; align-items:flex-start; }
  .task:last-child { border-bottom:none; }
  .task-priority { font-family:'JetBrains Mono',monospace; font-size:11px; padding:2px 8px; border-radius:4px; flex-shrink:0; margin-top:2px; }
  .high { background:rgba(255,80,80,0.12); color:#ff5050; }
  .medium { background:rgba(255,200,0,0.12); color:#ffc800; }
  .low { background:rgba(136,136,136,0.12); color:var(--muted); }
  .task-body strong { display:block; font-weight:500; }
  .task-body span { font-size:13px; color:var(--muted); }
  .empty { color:var(--muted); font-family:'JetBrains Mono',monospace; font-size:13px; padding:20px 0; }
</style>
</head>
<body>
<header>
  <div class="wordmark"><span>&gt;</span> DemoLoop</div>
  <div class="badge">dashboard</div>
</header>
<main>
  <h2>Current session — stories</h2>
  <div class="stories" id="stories"><p class="empty">Loading...</p></div>

  <h2>Session history — tasks</h2>
  <div class="sessions" id="sessions"><p class="empty">Loading...</p></div>
</main>
<script>
  async function load() {
    const [stories, sessions] = await Promise.all([
      fetch('/api/stories').then(r => r.json()),
      fetch('/api/sessions').then(r => r.json()),
    ]);

    const stEl = document.getElementById('stories');
    if (!stories.length) { stEl.innerHTML = '<p class="empty">> No stories yet. Run demoloop start.</p>'; }
    else {
      stEl.innerHTML = stories.map(s => \`
        <div class="story-card">
          <div class="story-title">\${s.title}</div>
          \${s.filesChanged.length ? \`<div class="story-files">\${s.filesChanged.slice(0,4).join(' · ')}\${s.filesChanged.length > 4 ? \` +\${s.filesChanged.length-4}\` : ''}</div>\` : ''}
        </div>\`).join('');
    }

    const seEl = document.getElementById('sessions');
    if (!sessions.length) { seEl.innerHTML = '<p class="empty">> No sessions yet.</p>'; }
    else {
      seEl.innerHTML = sessions.map(s => \`
        <div class="session-card">
          <div class="session-date">> Session \${s.date}</div>
          \${s.tasks.length ? s.tasks.map(t => \`
            <div class="task">
              <span class="task-priority \${t.priority}">\${t.priority.toUpperCase()}</span>
              <div class="task-body"><strong>\${t.title}</strong><span>\${t.description}</span></div>
            </div>\`).join('') : '<p class="empty" style="padding:8px 0">No tasks extracted.</p>'}
        </div>\`).join('');
    }
  }
  load();
  setInterval(load, 5000);
</script>
</body>
</html>`;
}
