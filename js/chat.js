// js/chat.js
// "Ask the Bridge" chatbot panel.
// POSTs to /api/chat and renders the response as chat bubbles.

async function sendChat() {
  const input = document.getElementById('chat-input');
  const query = input.value.trim();
  if (!query) return;

  input.value    = '';
  input.disabled = true;
  document.getElementById('chat-send').disabled = true;

  _appendBubble(query, 'user');
  const thinkId = _appendBubble('BridgeAI is thinking…', 'ai thinking');

  try {
    const res = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ query })
    });

    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const data = await res.json();

    _removeBubble(thinkId);
    _appendBubble(data.answer, 'ai');

  } catch (err) {
    _removeBubble(thinkId);
    _appendBubble(
      `Could not reach the server: ${err.message}`,
      'ai error'
    );
  } finally {
    input.disabled = false;
    document.getElementById('chat-send').disabled = false;
    input.focus();
  }
}

function sendChip(btn) {
  document.getElementById('chat-input').value = btn.textContent.trim();
  sendChat();
}

// ── Bubble helpers ────────────────────────────────────────
let _bc = 0;

function _appendBubble(text, typeStr) {
  const id      = `bubble-${_bc++}`;
  const box     = document.getElementById('chat-messages');
  const div     = document.createElement('div');
  const isUser  = typeStr.includes('user');
  const extra   = typeStr.replace('user', '').replace('ai', '').trim();

  div.id        = id;
  div.className = ['chat-bubble',
                   isUser ? 'bubble-user' : 'bubble-ai',
                   extra].filter(Boolean).join(' ');
  div.textContent = text;

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  return id;
}

function _removeBubble(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}