/**
 * Live conversation dashboard — uses OpenAI Realtime API via WebSocket proxy.
 * PCM16 audio flows browser ↔ server ↔ OpenAI in real time.
 */
export function getLiveDashboardHTML(productUrl?: string): string {
  const productBanner = productUrl
    ? `<a class="product-link" href="${productUrl}" target="_blank" rel="noopener">
        &rarr; <span>Open product</span> <span class="product-url">${productUrl}</span>
       </a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>DemoLoop — Live Session</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
<style>
  :root{--bg:#0a0a0a;--surface:#141414;--border:#222;--teal:#00e5b0;--text:#f0f0f0;--muted:#888;--red:#ff5050;--yellow:#ffc800;}
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:'Inter',system-ui,sans-serif;font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased;height:100vh;display:flex;flex-direction:column;}
  header{border-bottom:1px solid var(--border);padding:14px 24px;display:flex;align-items:center;gap:12px;flex-shrink:0;}
  .wordmark{font-family:'JetBrains Mono',monospace;font-size:14px;font-weight:500;}.wordmark span{color:var(--teal);}
  .badge{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--red);background:rgba(255,80,80,.1);border:1px solid rgba(255,80,80,.3);padding:3px 10px;border-radius:999px;}
  .badge.connected{color:var(--teal);background:rgba(0,229,176,.08);border-color:rgba(0,229,176,.3);}
  .product-link{display:flex;align-items:center;gap:8px;margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--teal);border:1px solid rgba(0,229,176,.25);border-radius:6px;padding:7px 14px;text-decoration:none;transition:all .15s;}
  .product-link:hover{background:rgba(0,229,176,.08);}
  .product-url{color:var(--muted);}

  .conversation{flex:1;overflow-y:auto;padding:24px;display:flex;flex-direction:column;gap:12px;}
  .msg{max-width:80%;padding:12px 16px;border-radius:10px;font-size:14px;line-height:1.6;}
  .msg.assistant{background:var(--surface);border:1px solid var(--border);align-self:flex-start;border-bottom-left-radius:2px;}
  .msg.user{background:rgba(0,229,176,.1);border:1px solid rgba(0,229,176,.2);align-self:flex-end;border-bottom-right-radius:2px;color:var(--text);}
  .msg.system{background:transparent;border:none;color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:12px;align-self:center;}
  .msg .speaker{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted);margin-bottom:4px;}
  .msg.assistant .speaker{color:var(--teal);}

  /* Voice visualizer */
  .vis-bar{display:flex;align-items:center;justify-content:center;gap:3px;height:40px;}
  .vis-bar .bar{width:3px;border-radius:2px;background:var(--teal);transition:height .05s ease;}

  footer{border-top:1px solid var(--border);padding:16px 24px;flex-shrink:0;}
  .controls{display:flex;align-items:center;gap:14px;}
  .mic-btn{width:52px;height:52px;border-radius:50%;border:2px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;}
  .mic-btn.active{border-color:var(--red);background:rgba(255,80,80,.1);color:var(--red);animation:ring .8s ease infinite;}
  .mic-btn:disabled{opacity:0.3;cursor:not-allowed;}
  @keyframes ring{0%,100%{box-shadow:0 0 0 0 rgba(255,80,80,.4);}50%{box-shadow:0 0 0 8px rgba(255,80,80,0);}}
  .status-text{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--muted);flex:1;}
  .status-text.live{color:var(--teal);}
  .end-btn{font-family:'Inter',sans-serif;font-size:13px;font-weight:500;padding:10px 18px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;transition:all .15s;}
  .end-btn:hover{border-color:var(--red);color:var(--red);}
</style>
</head>
<body>
<header>
  <div class="wordmark"><span>&gt;</span> DemoLoop</div>
  <div class="badge" id="conn-badge">Connecting...</div>
  ${productBanner}
</header>

<div class="conversation" id="conversation">
  <div class="msg system">&gt; Connecting to live session...</div>
</div>

<footer>
  <div class="controls">
    <button class="mic-btn" id="mic-btn" disabled title="Microphone">&#127908;</button>
    <div class="vis-bar" id="visualizer">
      ${Array(8).fill('<div class="bar" style="height:4px"></div>').join('')}
    </div>
    <div class="status-text" id="status-text">Starting session...</div>
    <button class="end-btn" id="end-btn">End session</button>
  </div>
</footer>

<script>
  const conv      = document.getElementById('conversation');
  const micBtn    = document.getElementById('mic-btn');
  const statusTxt = document.getElementById('status-text');
  const connBadge = document.getElementById('conn-badge');
  const endBtn    = document.getElementById('end-btn');
  const vizBars   = document.querySelectorAll('.vis-bar .bar');

  // ── WebSocket ──────────────────────────────────────────────────
  const ws = new WebSocket('ws://localhost:' + location.port + '/api/realtime');
  ws.binaryType = 'arraybuffer';

  let isConnected = false;
  let micStream   = null;
  let audioCtx    = null;
  let workletNode = null;
  let outputQueue = [];
  let isPlaying   = false;

  ws.onopen = () => { /* wait for session.ready */ };

  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'session.ready':
        isConnected = true;
        connBadge.textContent = 'LIVE';
        connBadge.className = 'badge connected';
        statusTxt.textContent = 'Session live — tap mic to speak';
        statusTxt.className = 'status-text live';
        await startMic();
        break;

      case 'response.audio.delta':
        if (msg.delta) queueAudio(msg.delta);
        break;

      case 'response.audio_transcript.delta':
        appendDelta('assistant', msg.delta || '');
        break;

      case 'input_audio_buffer.speech_started':
        statusTxt.textContent = 'Listening...';
        statusTxt.className = 'status-text live';
        break;

      case 'input_audio_buffer.speech_stopped':
        statusTxt.textContent = 'Processing...';
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) appendMessage('user', msg.transcript);
        break;

      case 'response.done':
        statusTxt.textContent = 'Session live — speak anytime';
        statusTxt.className = 'status-text live';
        finalizeAssistantMessage();
        break;

      case 'error':
        appendMessage('system', '> Error: ' + (msg.error?.message || msg.message || 'unknown'));
        break;
    }
  };

  ws.onclose = () => {
    connBadge.textContent = 'Disconnected';
    connBadge.className = 'badge';
    statusTxt.textContent = 'Session ended.';
    micBtn.disabled = true;
  };

  // ── Microphone capture (PCM16 @ 24kHz) ────────────────────────
  async function startMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx  = new AudioContext({ sampleRate: 24000 });

      const workletCode = \`
        class PCM16Processor extends AudioWorkletProcessor {
          process(inputs) {
            const ch = inputs[0][0];
            if (!ch) return true;
            const buf = new Int16Array(ch.length);
            for (let i = 0; i < ch.length; i++)
              buf[i] = Math.max(-32768, Math.min(32767, ch[i] * 32767));
            this.port.postMessage(buf.buffer, [buf.buffer]);
            return true;
          }
        }
        registerProcessor('pcm16', PCM16Processor);
      \`;
      const blob = new Blob([workletCode], { type: 'application/javascript' });
      const url  = URL.createObjectURL(blob);
      await audioCtx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const src = audioCtx.createMediaStreamSource(micStream);
      workletNode = new AudioWorkletNode(audioCtx, 'pcm16');

      workletNode.port.onmessage = (e) => {
        if (!isConnected || ws.readyState !== WebSocket.OPEN) return;
        const b64 = btoa(String.fromCharCode(...new Uint8Array(e.data)));
        ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: b64 }));
        updateViz(new Int16Array(e.data));
      };

      src.connect(workletNode);
      workletNode.connect(audioCtx.destination);
      micBtn.disabled = false;
      micBtn.classList.add('active');
    } catch (err) {
      appendMessage('system', '> Mic access denied — ' + err.message);
    }
  }

  micBtn.addEventListener('click', () => {
    if (!audioCtx) return;
    if (micBtn.classList.contains('active')) {
      // Mute
      workletNode.disconnect();
      micBtn.classList.remove('active');
      statusTxt.textContent = 'Muted — click to unmute';
      statusTxt.className = 'status-text';
    } else {
      // Unmute
      workletNode.connect(audioCtx.destination);
      micBtn.classList.add('active');
      statusTxt.textContent = 'Session live — speak anytime';
      statusTxt.className = 'status-text live';
    }
  });

  // ── Audio output (PCM16 → AudioContext) ───────────────────────
  function queueAudio(b64) {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const pcm16 = new Int16Array(bytes.buffer);
    const float = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float[i] = pcm16[i] / 32768;
    outputQueue.push(float);
    if (!isPlaying) drainQueue();
  }

  function drainQueue() {
    if (!outputQueue.length) { isPlaying = false; return; }
    isPlaying = true;
    const samples  = outputQueue.shift();
    const buf      = audioCtx.createBuffer(1, samples.length, 24000);
    buf.copyToChannel(samples, 0);
    const src      = audioCtx.createBufferSource();
    src.buffer     = buf;
    src.connect(audioCtx.destination);
    src.onended    = drainQueue;
    src.start();
  }

  // ── Conversation rendering ─────────────────────────────────────
  let currentAssistantEl = null;
  let currentAssistantText = '';

  function appendDelta(role, delta) {
    if (role === 'assistant') {
      if (!currentAssistantEl) {
        currentAssistantEl = document.createElement('div');
        currentAssistantEl.className = 'msg assistant';
        currentAssistantEl.innerHTML = '<div class="speaker">&gt; DemoLoop</div><div class="body"></div>';
        conv.appendChild(currentAssistantEl);
      }
      currentAssistantText += delta;
      currentAssistantEl.querySelector('.body').textContent = currentAssistantText;
      conv.scrollTop = conv.scrollHeight;
    }
  }

  function finalizeAssistantMessage() {
    currentAssistantEl = null;
    currentAssistantText = '';
  }

  function appendMessage(role, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + role;
    if (role === 'user') {
      el.innerHTML = '<div class="speaker">You</div><div class="body"></div>';
      el.querySelector('.body').textContent = text;
    } else {
      el.textContent = text;
    }
    conv.appendChild(el);
    conv.scrollTop = conv.scrollHeight;
  }

  // ── Visualizer ─────────────────────────────────────────────────
  function updateViz(pcm16) {
    let sum = 0;
    for (let i = 0; i < pcm16.length; i++) sum += Math.abs(pcm16[i]);
    const rms = Math.sqrt(sum / pcm16.length) / 32768;
    vizBars.forEach((bar, i) => {
      const h = Math.max(4, Math.min(36, rms * 300 * (0.5 + Math.random() * 0.5)));
      bar.style.height = h + 'px';
    });
  }

  // ── End session ────────────────────────────────────────────────
  endBtn.addEventListener('click', () => {
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    ws.close();
  });
</script>
</body>
</html>`;
}
