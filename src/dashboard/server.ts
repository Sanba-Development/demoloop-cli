import { createServer, IncomingMessage, ServerResponse } from 'http';
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { Story } from '../lib/agent-parser.js';
import type { SessionRecord } from '../lib/task-writer.js';
import { transcribe } from '../lib/stt.js';

let feedbackQueue: string | null = null;
export function getFeedback(): string | null {
  const fb = feedbackQueue;
  feedbackQueue = null;
  return fb;
}

export function createDashboardServer(
  stories: Story[],
  projectPath: string,
  productUrl?: string,
  audioPath?: string
) {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    res.setHeader('Access-Control-Allow-Origin', '*');

    // ── GET /api/stories ────────────────────────────────────────────
    if (url === '/api/stories' && method === 'GET') {
      json(res, stories); return;
    }

    // ── GET /api/sessions ───────────────────────────────────────────
    if (url === '/api/sessions' && method === 'GET') {
      const dir = join(projectPath, '.demoloop', 'sessions');
      if (!existsSync(dir)) { json(res, []); return; }
      const sessions: SessionRecord[] = readdirSync(dir)
        .filter(f => f.endsWith('.json')).sort().reverse().slice(0, 20)
        .map(f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { return null; } })
        .filter(Boolean);
      json(res, sessions); return;
    }

    // ── GET /api/audio ──────────────────────────────────────────────
    // Serves the generated TTS file directly to the browser <audio> element.
    if (url === '/api/audio' && method === 'GET') {
      if (!audioPath || !existsSync(audioPath)) {
        res.writeHead(404); res.end(); return;
      }
      const data = readFileSync(audioPath);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': data.length,
        'Cache-Control': 'no-cache',
      });
      res.end(data); return;
    }

    // ── GET /api/audio/status ────────────────────────────────────────
    if (url === '/api/audio/status' && method === 'GET') {
      json(res, { ready: !!(audioPath && existsSync(audioPath)) }); return;
    }

    // ── GET /api/feedback/poll ───────────────────────────────────────
    if (url === '/api/feedback/poll' && method === 'GET') {
      json(res, { feedback: getFeedback() }); return;
    }

    // ── POST /api/transcribe ─────────────────────────────────────────
    if (url === '/api/transcribe' && method === 'POST') {
      try {
        const buf = await readBody(req);
        const tmpPath = join(tmpdir(), `demoloop-audio-${Date.now()}.webm`);
        writeFileSync(tmpPath, buf);
        const text = await transcribe(tmpPath);
        json(res, { transcript: text });
      } catch (err) {
        error(res, 500, err instanceof Error ? err.message : 'Transcription failed');
      }
      return;
    }

    // ── POST /api/feedback ───────────────────────────────────────────
    if (url === '/api/feedback' && method === 'POST') {
      try {
        const buf = await readBody(req);
        const { feedback } = JSON.parse(buf.toString('utf8'));
        feedbackQueue = feedback ?? '';
        json(res, { ok: true });
      } catch {
        error(res, 400, 'Invalid body');
      }
      return;
    }

    // ── GET / ────────────────────────────────────────────────────────
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getDashboardHTML(productUrl));
  });
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
function error(res: ServerResponse, status: number, msg: string): void {
  json(res, { error: msg }, status);
}
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function getDashboardHTML(productUrl?: string): string {
  const productBanner = productUrl
    ? `<a class="product-link" href="${productUrl}" target="_blank" rel="noopener">
        <span class="product-arrow">&rarr;</span>
        <span>Open product</span>
        <span class="product-url">${productUrl}</span>
       </a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>DemoLoop — Session</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root{--bg:#0a0a0a;--surface:#141414;--border:#222;--teal:#00e5b0;--text:#f0f0f0;--muted:#888;--red:#ff5050;--yellow:#ffc800;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;}

  header{border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:12px;}
  .wordmark{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:500;}
  .wordmark span{color:var(--teal);}
  .badge{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);background:var(--surface);border:1px solid var(--border);padding:3px 10px;border-radius:999px;}
  .product-link{display:flex;align-items:center;gap:8px;margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--teal);border:1px solid rgba(0,229,176,.25);border-radius:6px;padding:7px 14px;text-decoration:none;transition:all .15s;}
  .product-link:hover{background:rgba(0,229,176,.08);border-color:var(--teal);}
  .product-url{color:var(--muted);}

  /* ── Audio player ── */
  .audio-bar{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 24px;display:flex;align-items:center;gap:14px;}
  .audio-label{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);white-space:nowrap;min-width:200px;}
  .audio-label.ready{color:var(--teal);}
  .audio-label.loading{color:var(--yellow);}
  .play-btn{width:36px;height:36px;border-radius:50%;background:var(--teal);border:none;color:var(--bg);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;transition:background .15s;}
  .play-btn:hover{background:#00ffc4;}
  .play-btn:disabled{opacity:0.35;cursor:not-allowed;background:var(--surface);color:var(--muted);}
  .progress-wrap{flex:1;display:flex;align-items:center;gap:10px;}
  .progress{flex:1;height:4px;background:var(--border);border-radius:2px;cursor:pointer;position:relative;}
  .progress-fill{height:100%;background:var(--teal);border-radius:2px;width:0%;transition:width .1s linear;pointer-events:none;}
  .time{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);white-space:nowrap;}

  main{max-width:960px;margin:0 auto;padding:28px 24px;display:grid;grid-template-columns:1fr 1fr;gap:28px;}
  @media(max-width:700px){main{grid-template-columns:1fr;}}
  .panel h2{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;}

  .card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:16px 18px;margin-bottom:10px;}
  .card-title{font-weight:600;margin-bottom:4px;}
  .card-files{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);margin-top:4px;}

  /* ── Recorder ── */
  .recorder{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:22px;}
  .rec-status{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted);margin-bottom:14px;min-height:20px;}
  .rec-status.recording{color:var(--red);}
  .rec-status.transcribing{color:var(--yellow);}
  .rec-status.ready{color:var(--teal);}
  .btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;}
  button{font-family:'Inter',sans-serif;font-size:13px;font-weight:500;padding:9px 16px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;transition:all .15s;}
  button:hover:not(:disabled){border-color:var(--teal);color:var(--teal);}
  button:disabled{opacity:0.35;cursor:not-allowed;}
  button.primary{background:var(--teal);color:var(--bg);border-color:var(--teal);font-weight:600;}
  button.primary:hover:not(:disabled){background:#00ffc4;}
  .pulse{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-right:6px;animation:pulse 1s ease-in-out infinite;}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.4;transform:scale(.8);}}
  textarea{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:12px;color:var(--text);font-family:'Inter',sans-serif;font-size:14px;line-height:1.6;resize:vertical;min-height:100px;margin-bottom:12px;}
  textarea:focus{outline:none;border-color:var(--teal);}
  .submit-note{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted);}

  /* ── History ── */
  .session-card{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:18px;margin-bottom:12px;}
  .session-date{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--teal);margin-bottom:10px;}
  .task{padding:7px 0;border-bottom:1px solid var(--border);display:flex;gap:8px;align-items:flex-start;}
  .task:last-child{border-bottom:none;}
  .task-priority{font-family:'JetBrains Mono',monospace;font-size:10px;padding:2px 7px;border-radius:4px;flex-shrink:0;margin-top:3px;}
  .high{background:rgba(255,80,80,.1);color:var(--red);}
  .medium{background:rgba(255,200,0,.1);color:var(--yellow);}
  .low{background:rgba(136,136,136,.1);color:var(--muted);}
  .task strong{display:block;font-weight:500;font-size:14px;}
  .task span{font-size:13px;color:var(--muted);}
  .empty{color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:13px;padding:12px 0;}
  .submitted-msg{font-family:'JetBrains Mono',monospace;color:var(--teal);font-size:14px;padding:20px 0;text-align:center;}
</style>
</head>
<body>
<header>
  <div class="wordmark"><span>&gt;</span> DemoLoop</div>
  <div class="badge">session</div>
  ${productBanner}
</header>

<!-- Audio player bar -->
<div class="audio-bar" id="audio-bar">
  <span class="audio-label loading" id="audio-label">&gt; Generating walkthrough...</span>
  <button class="play-btn" id="play-btn" disabled title="Play walkthrough">&#9654;</button>
  <div class="progress-wrap">
    <div class="progress" id="progress-bar">
      <div class="progress-fill" id="progress-fill"></div>
    </div>
    <span class="time" id="time-display">0:00 / 0:00</span>
  </div>
  <audio id="audio-player" preload="auto"></audio>
</div>

<main>
  <div class="panel">
    <h2>Stories — this session</h2>
    <div id="stories"><p class="empty">Loading...</p></div>

    <h2 style="margin-top:24px;">Your feedback</h2>
    <div class="recorder" id="recorder-panel">
      <div class="rec-status" id="rec-status">&gt; Ready to record.</div>
      <div class="btn-row">
        <button id="btn-record">&#9679;&nbsp; Record</button>
        <button id="btn-stop" disabled>&#9632;&nbsp; Stop</button>
      </div>
      <textarea id="transcript" placeholder="Transcript will appear here — or type directly..."></textarea>
      <div class="btn-row">
        <button class="primary" id="btn-submit" disabled>Submit feedback &rarr;</button>
        <button id="btn-clear">Clear</button>
      </div>
      <div class="submit-note">Record or type your feedback, then submit to queue tasks.</div>
    </div>
  </div>

  <div class="panel">
    <h2>Session history</h2>
    <div id="sessions"><p class="empty">Loading...</p></div>
  </div>
</main>

<script>
  // ── Audio player ─────────────────────────────────────────────────
  const audioPlayer  = document.getElementById('audio-player');
  const audioLabel   = document.getElementById('audio-label');
  const playBtn      = document.getElementById('play-btn');
  const progressBar  = document.getElementById('progress-bar');
  const progressFill = document.getElementById('progress-fill');
  const timeDisplay  = document.getElementById('time-display');

  function fmt(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  audioPlayer.addEventListener('timeupdate', () => {
    if (!audioPlayer.duration) return;
    const pct = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressFill.style.width = pct + '%';
    timeDisplay.textContent = fmt(audioPlayer.currentTime) + ' / ' + fmt(audioPlayer.duration);
  });

  audioPlayer.addEventListener('ended', () => {
    playBtn.innerHTML = '&#9654;';
    setLabel('> Walkthrough done');
    audioLabel.className = 'audio-label ready';
  });

  playBtn.addEventListener('click', () => {
    if (audioPlayer.paused) {
      audioPlayer.play().then(() => {
        playBtn.innerHTML = '&#10074;&#10074;';
        setLabel('> Playing walkthrough');
        audioLabel.className = 'audio-label ready';
      }).catch(err => {
        setLabel('> Playback error: ' + err.message);
      });
    } else {
      audioPlayer.pause();
      playBtn.innerHTML = '&#9654;';
      setLabel('> Paused');
      audioLabel.className = 'audio-label ready';
    }
  });

  progressBar.addEventListener('click', (e) => {
    if (!audioPlayer.duration) return;
    const rect = progressBar.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    audioPlayer.currentTime = pct * audioPlayer.duration;
  });

  function setLabel(html) { audioLabel.innerHTML = html; }

  // Enable play button only once audio is actually loaded and decodable
  audioPlayer.addEventListener('canplay', () => {
    playBtn.disabled = false;
    setLabel('> Walkthrough ready &mdash; press &#9654;');
    audioLabel.className = 'audio-label ready';
    // Attempt autoplay; browser may block — button is always there as fallback
    audioPlayer.play().then(() => {
      playBtn.innerHTML = '&#10074;&#10074;';
      setLabel('> Playing walkthrough');
    }).catch(() => { /* autoplay blocked — user presses play */ });
  });

  audioPlayer.addEventListener('error', () => {
    const codes = {1:'ABORTED', 2:'NETWORK', 3:'DECODE', 4:'FORMAT_NOT_SUPPORTED'};
    const e = audioPlayer.error;
    const detail = e ? (codes[e.code] || 'ERR_' + e.code) : 'UNKNOWN';
    setLabel('> Audio error (' + detail + ') — refresh once voice is ready');
    audioLabel.className = 'audio-label';
  });

  async function pollAudio() {
    try {
      const { ready } = await fetch('/api/audio/status').then(r => r.json());
      if (ready) {
        // Setting src triggers the load; canplay fires when ready to play
        audioPlayer.src = '/api/audio?t=' + Date.now();
        audioPlayer.load();
        setLabel('> Loading audio...');
        audioLabel.className = 'audio-label loading';
      } else {
        setTimeout(pollAudio, 2000);
      }
    } catch { setTimeout(pollAudio, 2000); }
  }
  pollAudio();

  // ── Stories ──────────────────────────────────────────────────────
  async function loadStories() {
    const stories = await fetch('/api/stories').then(r => r.json()).catch(() => []);
    const el = document.getElementById('stories');
    if (!stories.length) { el.innerHTML = '<p class="empty">&gt; No stories yet.</p>'; return; }
    el.innerHTML = stories.map(s => \`
      <div class="card">
        <div class="card-title">\${esc(s.title)}</div>
        \${s.filesChanged.length ? \`<div class="card-files">\${s.filesChanged.slice(0,5).map(esc).join(' &middot; ')}\${s.filesChanged.length > 5 ? \` +\${s.filesChanged.length-5} more\` : ''}</div>\` : ''}
      </div>\`).join('');
  }

  async function loadSessions() {
    const sessions = await fetch('/api/sessions').then(r => r.json()).catch(() => []);
    const el = document.getElementById('sessions');
    if (!sessions.length) { el.innerHTML = '<p class="empty">&gt; No sessions yet.</p>'; return; }
    el.innerHTML = sessions.map(s => \`
      <div class="session-card">
        <div class="session-date">&gt; \${esc(s.date)}</div>
        \${s.tasks.length ? s.tasks.map(t => \`
          <div class="task">
            <span class="task-priority \${t.priority}">\${t.priority.toUpperCase()}</span>
            <div><strong>\${esc(t.title)}</strong><span>\${esc(t.description)}</span></div>
          </div>\`).join('') : '<p class="empty" style="padding:4px 0">No tasks extracted.</p>'}
      </div>\`).join('');
  }

  loadStories();
  loadSessions();
  setInterval(loadSessions, 5000);

  // ── Recorder ─────────────────────────────────────────────────────
  let mediaRecorder = null, chunks = [];
  const btnRecord = document.getElementById('btn-record');
  const btnStop   = document.getElementById('btn-stop');
  const btnSubmit = document.getElementById('btn-submit');
  const btnClear  = document.getElementById('btn-clear');
  const txArea    = document.getElementById('transcript');
  const status    = document.getElementById('rec-status');

  txArea.addEventListener('input', () => { btnSubmit.disabled = !txArea.value.trim(); });

  btnRecord.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        status.textContent = '> Transcribing...';
        status.className = 'rec-status transcribing';
        btnRecord.disabled = false; btnStop.disabled = true;
        const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        try {
          const res  = await fetch('/api/transcribe', { method:'POST', body: blob });
          const data = await res.json();
          if (data.transcript) {
            txArea.value = (txArea.value ? txArea.value + ' ' : '') + data.transcript;
            btnSubmit.disabled = false;
            status.textContent = '> Transcribed. Edit if needed, then submit.';
            status.className = 'rec-status ready';
          } else {
            status.textContent = '> Nothing detected — try again or type manually.';
            status.className = 'rec-status';
          }
        } catch {
          status.textContent = '> Transcription failed — type feedback manually.';
          status.className = 'rec-status';
        }
      };
      mediaRecorder.start();
      status.innerHTML = '<span class="pulse"></span>Recording... click Stop when done.';
      status.className = 'rec-status recording';
      btnRecord.disabled = true; btnStop.disabled = false; btnSubmit.disabled = true;
    } catch { status.textContent = '> Mic access denied — type feedback manually.'; }
  });

  btnStop.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  });

  btnClear.addEventListener('click', () => {
    txArea.value = ''; btnSubmit.disabled = true;
    status.textContent = '> Ready to record.'; status.className = 'rec-status';
  });

  btnSubmit.addEventListener('click', async () => {
    const feedback = txArea.value.trim();
    if (!feedback) return;
    btnSubmit.disabled = true; btnRecord.disabled = true;
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback }),
      });
      document.getElementById('recorder-panel').innerHTML =
        '<div class="submitted-msg">&gt; Feedback received. Queuing tasks in CLI...</div>';
      setTimeout(loadSessions, 4000);
    } catch {
      status.textContent = '> Submit failed — try again.';
      btnSubmit.disabled = false;
    }
  });

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
</script>
</body>
</html>`;
}
