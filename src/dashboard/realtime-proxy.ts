import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import type { Story } from '../lib/agent-parser.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Query the OpenAI models list and return the best available Realtime model.
 * Prefers full gpt-4o (not mini), newest date snapshot, falls back to alias.
 */
async function findRealtimeModel(apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json() as { data: Array<{ id: string }> };

    const ids = data.data
      .map((m) => m.id)
      .filter((id) => id.includes('realtime'))
      .sort()
      .reverse(); // newest date suffix first

    console.log('  [realtime] Available realtime models:', ids.join(', ') || '(none)');

    // Prefer full gpt-4o with a date stamp (most stable)
    const dated = ids.find((id) => !id.includes('mini') && /\d{4}-\d{2}-\d{2}/.test(id));
    if (dated) return dated;

    // Fall back to undated alias
    const alias = ids.find((id) => !id.includes('mini'));
    if (alias) return alias;

    // Last resort: whatever is there
    return ids[0] ?? 'gpt-4o-realtime-preview';
  } catch (err) {
    console.warn('  [realtime] Could not fetch model list:', String(err));
    return 'gpt-4o-realtime-preview';
  }
}

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

  let openaiWs: WebSocket | null = null;
  let retryCount = 0;
  let sessionEverStarted = false;
  let browserClosed = false;
  let realtimeUrl: string | null = null;  // resolved once, reused on retry

  // ── Browser → OpenAI (set up once, stays alive across reconnects) ──
  browserWs.on('message', (data) => {
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.send(data);
  });

  browserWs.on('close', () => {
    browserClosed = true;
    if (openaiWs && openaiWs.readyState === WebSocket.OPEN) openaiWs.close();
  });

  async function connect() {
    if (browserClosed) return;

    // Discover model on first connect only
    if (!realtimeUrl) {
      const model = await findRealtimeModel(apiKey!);
      realtimeUrl = `wss://api.openai.com/v1/realtime?model=${model}`;
      console.log(`  [realtime] Using model: ${model}`);
    }

    console.log(`\n  [realtime] Connecting to OpenAI Realtime API... (attempt ${retryCount + 1})`);

    openaiWs = new WebSocket(realtimeUrl, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    openaiWs.on('open', () => {
      console.log('  [realtime] Connected. Sending session.update...');
      openaiWs!.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: buildSystemPrompt(stories, sprintSummary),
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 600,
          },
        },
      }));
    });

    // ── OpenAI → browser ──
    openaiWs.on('message', (data) => {
      try {
        const evt = JSON.parse(data.toString());
        console.log(`  [realtime] ← ${evt.type}`);

        if (evt.type === 'session.updated') {
          console.log('  [realtime] Session configured. Starting demo...');
          const startText = sessionEverStarted
            ? 'The connection was briefly interrupted. Please continue the demo.'
            : 'Start the demo.';
          sessionEverStarted = true;

          openaiWs!.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: startText }],
            },
          }));
          openaiWs!.send(JSON.stringify({
            type: 'response.create',
            response: { modalities: ['text', 'audio'] },
          }));

          if (browserWs.readyState === WebSocket.OPEN) {
            browserWs.send(JSON.stringify({ type: 'session.ready' }));
          }
        }

        if (evt.type === 'error') {
          console.error('  [realtime] OpenAI error:\n' + JSON.stringify(evt.error ?? evt, null, 2));
          // If model_not_found, clear cached URL so next retry re-discovers
          if (evt.error?.code === 'model_not_found') {
            console.error('  [realtime] Model not found — will re-discover on next attempt');
            realtimeUrl = null;
          }
        }
      } catch { /* binary frame — forward as-is */ }

      if (browserWs.readyState === WebSocket.OPEN) browserWs.send(data);
    });

    openaiWs.on('error', (err) => {
      console.error('  [realtime] WebSocket error:', err.message);
    });

    openaiWs.on('close', (code, reason) => {
      console.log(`  [realtime] Connection closed: ${code} ${reason.toString()}`);
      if (browserClosed) return;

      if (retryCount < MAX_RETRIES) {
        retryCount++;
        console.log(`  [realtime] Retrying in ${RETRY_DELAY_MS}ms... (${retryCount}/${MAX_RETRIES})`);
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({
            type: 'demoloop.reconnecting',
            attempt: retryCount,
            max: MAX_RETRIES,
          }));
        }
        setTimeout(connect, RETRY_DELAY_MS);
      } else {
        console.error('  [realtime] Max retries reached. Closing browser session.');
        if (browserWs.readyState === WebSocket.OPEN) {
          browserWs.send(JSON.stringify({
            type: 'demoloop.error',
            message: `Lost connection to OpenAI after ${MAX_RETRIES} retries. Please restart the session.`,
          }));
          browserWs.close();
        }
      }
    });
  }

  connect();
}
