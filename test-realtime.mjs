/**
 * Standalone Realtime API diagnostic — run with:
 *   node test-realtime.mjs
 *
 * Tests:
 *  1. API key validity (REST /v1/models)
 *  2. Available realtime models
 *  3. Raw WebSocket connect + session.update + response.create
 *     (text-only first, then audio if text works)
 */

import 'dotenv/config';
import { WebSocket } from 'ws';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('❌  OPENAI_API_KEY not set');
  process.exit(1);
}

// ── 1. Verify key & list realtime models ──────────────────────────────────
console.log('── Step 1: checking API key and available realtime models ──');
const modelsRes = await fetch('https://api.openai.com/v1/models', {
  headers: { Authorization: `Bearer ${apiKey}` },
});
if (!modelsRes.ok) {
  console.error(`❌  /v1/models returned ${modelsRes.status} — key may be invalid`);
  process.exit(1);
}
const { data: models } = await modelsRes.json();
const realtimeModels = models.map(m => m.id).filter(id => id.includes('realtime')).sort();
console.log('✔   Key is valid');
console.log('    Realtime models:', realtimeModels.join('\n                    '));

// Pick gpt-4o-realtime-preview-2024-12-17 if available, else oldest dated, else alias
const model =
  realtimeModels.find(id => id === 'gpt-4o-realtime-preview-2024-12-17') ??
  realtimeModels.find(id => id.startsWith('gpt-4o-realtime-preview-') && !id.includes('mini')) ??
  'gpt-4o-realtime-preview';
console.log(`    Will test model: ${model}\n`);

// ── 2. TEXT-ONLY WebSocket test ────────────────────────────────────────────
console.log('── Step 2: WebSocket connect + text-only response ──');
await testWebSocket(model, ['text'], 'Say exactly: "Diagnostic test OK." and nothing else.');

// ── 3. SHORT audio test ─────────────────────────────────────────────────────
console.log('\n── Step 3: Short instruction + audio ──');
await testWebSocket(model, ['text', 'audio'], 'Say exactly: "Diagnostic test OK." and nothing else.');

// ── 4. LONG audio test (mirrors demoloop live) ─────────────────────────────
const longPrompt = `You are a technical demo assistant running a sprint review session.

Sprint stories:
Story 1: Add favicon, OG image, and social share metadata
Description: Added favicon.svg with teal gt symbol, og-image.png for social sharing, updated meta tags for Open Graph and Twitter Cards.

Story 2: Footer: remove Twitter link, point GitHub to repo
Description: Removed Twitter/X link from footer, updated GitHub link to point to Sanba-Development/DemoLoop repository.

Story 3: Wire up Formspree endpoint for waitlist form
Description: Connected the waitlist form to Formspree endpoint xlgagwye for email capture.

Story 4: Initial commit: DemoLoop landing page
Description: Created the full landing page for DemoLoop with hero section, features, how it works, and waitlist form.

Your role:
- Walk through each story conversationally, as if presenting a live demo
- Be specific about what was built and what to look at
- Start immediately: greet briefly and begin story 1.`;

console.log('\n── Step 4: Long instruction + audio (mirrors proxy) ──');
await testWebSocket(model, ['text', 'audio'], longPrompt);

// ─────────────────────────────────────────────────────────────────────────
async function testWebSocket(model, modalities, instructions) {
  const url = `wss://api.openai.com/v1/realtime?model=${model}`;
  return new Promise((resolve) => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });

    let gotSessionUpdated = false;
    const timer = setTimeout(() => {
      console.log('⚠   Timeout — no response.done after 30s');
      ws.close();
      resolve();
    }, 30000);

    ws.on('open', () => {
      console.log(`  ✔ WebSocket connected (${modalities.join('+')})`);
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities,
          voice: 'alloy',
          instructions,
        },
      }));
    });

    ws.on('message', (raw) => {
      let evt;
      try { evt = JSON.parse(raw.toString()); } catch { return; }

      process.stdout.write(`  ← ${evt.type}`);

      if (evt.type === 'session.updated') {
        console.log('  ✔');
        gotSessionUpdated = true;
        ws.send(JSON.stringify({ type: 'response.create' }));
      } else if (evt.type === 'response.text.delta') {
        process.stdout.write(evt.delta ?? '');
      } else if (evt.type === 'response.audio.delta') {
        process.stdout.write(' [audio chunk]');
      } else if (evt.type === 'response.done') {
        console.log('\n  ✔ response.done — SUCCESS');
        clearTimeout(timer);
        ws.close();
        resolve();
      } else if (evt.type === 'error') {
        console.error(`\n  ❌ error: ${JSON.stringify(evt.error, null, 2)}`);
        clearTimeout(timer);
        ws.close();
        resolve();
      } else {
        console.log('');
      }
    });

    ws.on('error', (err) => {
      console.error(`  ❌ WebSocket error: ${err.message}`);
      clearTimeout(timer);
      resolve();
    });

    ws.on('close', (code, reason) => {
      if (code !== 1000 || !gotSessionUpdated) {
        console.log(`  ℹ closed: ${code} ${reason.toString()}`);
      }
      clearTimeout(timer);
      resolve();
    });
  });
}
