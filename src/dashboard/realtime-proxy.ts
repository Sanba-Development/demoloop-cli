import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import type { Story } from '../lib/agent-parser.js';

// Confirmed working via test-realtime.mjs — update if this snapshot is deprecated
const MODEL = 'gpt-4o-realtime-preview-2024-12-17';
const REALTIME_URL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;

/**
 * Attaches a WebSocket server to the existing HTTP server.
 * Browser connects to ws://localhost:PORT/api/realtime
 * This proxy forwards to OpenAI Realtime API, keeping the key server-side.
 */
export function attachRealtimeProxy(
  httpServer: Server,
  stories: Story[],
  sprintSummary?: string
): void {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    if (req.url !== '/api/realtime') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (browserWs) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        browserWs.send(JSON.stringify({ type: 'demoloop.error', message: 'OPENAI_API_KEY not set' }));
        browserWs.close();
        return;
      }
      startProxy(browserWs, apiKey, stories, sprintSummary);
    });
  });
}

function buildSystemPrompt(stories: Story[], sprintSummary?: string): string {
  const storiesText = stories
    .map((s, i) => {
      const files = s.filesChanged.length
        ? `\nFiles changed: ${s.filesChanged.slice(0, 5).join(', ')}`
        : '';
      return `Story ${i + 1}: ${s.title}\n${s.description}${files}`;
    })
    .join('\n\n');

  return `You are a technical demo assistant running a sprint review session for a developer.

${sprintSummary ? `Sprint summary: ${sprintSummary}\n\n` : ''}Sprint stories:\n${storiesText}

Your role:
- Walk through each story conversationally, as if presenting a live demo
- Be specific: mention what to look at, what changed, what the user should try
- When the user interrupts or speaks, stop and respond naturally
- If they ask to revisit a story, go back
- Note any feedback or tasks mentioned; summarize them at the end
- Tone: direct, technical, conversational. No corporate speak.
- Start immediately: greet briefly and begin story 1.`;
}

function startProxy(
  browserWs: WebSocket,
  apiKey: string,
  stories: Story[],
  sprintSummary?: string
): void {
  console.log(`\n  [realtime] Connecting (${MODEL})...`);

  // Use a local variable — no closure mutation, mirrors the working test script
  const openaiWs = new WebSocket(REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  // ── OpenAI connection events ─────────────────────────────────
  openaiWs.on('open', () => {
    console.log('  [realtime] Connected. Configuring session...');
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: 'alloy',
        instructions: buildSystemPrompt(stories, sprintSummary),
      },
    }));
  });

  openaiWs.on('message', (data) => {
    // Try to parse JSON events; binary audio frames fall through as-is
    try {
      const evt = JSON.parse(data.toString());
      console.log(`  [realtime] ← ${evt.type}`);

      if (evt.type === 'session.updated') {
        console.log('  [realtime] Session ready. Starting demo...');
        openaiWs.send(JSON.stringify({ type: 'response.create' }));
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({ type: 'session.ready' }));
        }
      }

      if (evt.type === 'error') {
        console.error('  [realtime] OpenAI error:', JSON.stringify(evt.error ?? evt, null, 2));
      }
    } catch { /* binary frame — fall through */ }

    // Forward every frame (text or binary) to the browser
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data);
    }
  });

  openaiWs.on('error', (err) => {
    console.error('  [realtime] WebSocket error:', err.message);
  });

  openaiWs.on('close', (code, reason) => {
    console.log(`  [realtime] Closed: ${code} ${reason.toString()}`);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
  });

  // ── Browser → OpenAI ─────────────────────────────────────────
  browserWs.on('message', (data) => {
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(data);
  });

  browserWs.on('close', () => {
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });
}
