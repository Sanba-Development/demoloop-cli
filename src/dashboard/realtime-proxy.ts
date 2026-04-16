import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import type { Story } from '../lib/agent-parser.js';

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';

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
      handleSession(browserWs, stories, sprintSummary);
    });
  });
}

function buildSystemPrompt(stories: Story[], sprintSummary?: string): string {
  const storiesText = stories
    .map((s, i) => {
      const files = s.filesChanged.length ? `\nFiles changed: ${s.filesChanged.slice(0, 5).join(', ')}` : '';
      return `Story ${i + 1}: ${s.title}\n${s.description}${files}`;
    })
    .join('\n\n');

  return `You are a technical demo assistant running a sprint review session for a developer.

${sprintSummary ? `Sprint summary: ${sprintSummary}\n\n` : ''}Sprint stories:\n${storiesText}

Your role:
- Walk through each story conversationally, as if presenting a live demo
- Be specific: mention what to look at, what changed, what the user should try
- When the user interrupts or speaks, stop and respond naturally to their question or comment
- If they ask to revisit a story, go back
- Extract and remember any feedback or tasks they mention — at the end, summarize what tasks were captured
- Tone: direct, technical, conversational. No corporate speak.
- Start immediately: greet briefly and begin story 1.`;
}

function handleSession(browserWs: WebSocket, stories: Story[], sprintSummary?: string): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    browserWs.send(JSON.stringify({ type: 'demoloop.error', message: 'OPENAI_API_KEY not set' }));
    browserWs.close();
    return;
  }

  console.log('\n  [realtime] Connecting to OpenAI Realtime API...');

  const openaiWs = new WebSocket(REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  openaiWs.on('open', () => {
    console.log('  [realtime] Connected to OpenAI. Sending session.update...');
    // Configure the session — wait for session.updated before sending anything else
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: buildSystemPrompt(stories, sprintSummary),
        voice: 'alloy',                  // alloy is safest — available on all realtime tiers
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
        },
      },
    }));
  });

  // OpenAI → browser (and log to terminal for debugging)
  openaiWs.on('message', (data) => {
    // Parse and log every event type for visibility
    try {
      const evt = JSON.parse(data.toString());
      console.log(`  [realtime] ← ${evt.type}`);

      if (evt.type === 'session.updated') {
        // Session is confirmed — now kick off the demo and tell browser we're live
        console.log('  [realtime] Session configured. Starting demo...');
        openaiWs.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Start the demo.' }],
          },
        }));
        openaiWs.send(JSON.stringify({ type: 'response.create' }));
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({ type: 'session.ready' }));
        }
      }

      if (evt.type === 'error') {
        const errMsg = evt.error?.message ?? JSON.stringify(evt.error ?? evt);
        console.error('  [realtime] OpenAI error event:', errMsg);
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({ type: 'demoloop.error', message: errMsg }));
        }
      }
    } catch { /* binary frame — forward as-is */ }

    if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data);
  });

  // Browser → OpenAI
  browserWs.on('message', (data) => {
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.send(data);
  });

  browserWs.on('close', () => { if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close(); });
  openaiWs.on('error', (err) => {
    console.error('  [realtime] OpenAI WebSocket error:', err.message);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(JSON.stringify({ type: 'demoloop.error', message: err.message }));
    }
  });

  openaiWs.on('close', (code, reason) => {
    console.log(`  [realtime] OpenAI connection closed: ${code} ${reason.toString()}`);
    if (browserWs.readyState === WebSocket.OPEN) browserWs.close();
  });
}
