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

  // Block mic input from the very start — before response.created arrives there is
  // a race window where the AudioWorklet can already be streaming, which causes a
  // server_error.  Cleared only after response.done / response.cancelled.
  let aiSpeaking = true;

  const openaiWs = new WebSocket(REALTIME_URL, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'realtime=v1',
    },
  });

  // ── OpenAI → browser ─────────────────────────────────────────
  openaiWs.on('open', () => {
    console.log('  [realtime] Connected. Configuring session...');
    openaiWs.send(JSON.stringify({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        voice: 'alloy',
        instructions: buildSystemPrompt(stories, sprintSummary),
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

  openaiWs.on('message', (data) => {
    let asText: string | null = null;

    try {
      const evt = JSON.parse(data.toString());
      asText = data.toString(); // it was a text frame — keep as string for forwarding
      console.log(`  [realtime] ← ${evt.type}`);

      // Track AI speaking state so we can gate mic input
      if (evt.type === 'response.created')                        aiSpeaking = true;
      if (evt.type === 'response.done' || evt.type === 'response.cancelled') {
        // Flush any audio buffered during the AI's turn, then re-enable mic after
        // a short grace period so echo / ambient noise doesn't immediately trigger VAD.
        openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        setTimeout(() => {
          aiSpeaking = false;
          console.log('  [realtime] AI finished — mic input enabled');
        }, 500);
      }

      if (evt.type === 'session.updated') {
        console.log('  [realtime] Session ready. Starting demo...');
        // Clear any audio that slipped in before session was fully configured,
        // then kick off the initial AI greeting.
        openaiWs.send(JSON.stringify({ type: 'input_audio_buffer.clear' }));
        openaiWs.send(JSON.stringify({ type: 'response.create' }));
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({ type: 'session.ready' }));
        }
      }

      if (evt.type === 'error') {
        console.error('  [realtime] OpenAI error:', JSON.stringify(evt.error ?? evt, null, 2));
      }
    } catch { /* binary audio frame */ }

    // Forward to browser.
    // IMPORTANT: send JSON events as strings (text WS frame), not Buffer (binary frame).
    // The browser uses JSON.parse(event.data) — if we send a Buffer it arrives as
    // ArrayBuffer and parse fails silently, dropping all audio/transcript events.
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(asText ?? data);
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
    if (openaiWs.readyState !== WebSocket.OPEN) return;

    // Drop mic audio while the AI is speaking.
    // Chrome auto-grants mic on localhost — the AudioWorklet starts sending
    // input_audio_buffer.append within milliseconds of session.ready, which
    // races with the AI's ongoing audio generation and causes a server_error.
    try {
      const msg = JSON.parse(data.toString());
      if (aiSpeaking && msg.type === 'input_audio_buffer.append') return;
    } catch { /* binary frame from browser — forward as-is */ }

    openaiWs.send(data);
  });

  browserWs.on('close', () => {
    if (openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });
}
