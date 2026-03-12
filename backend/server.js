require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
//  In-memory chat store (resets on server restart)
//  For persistence later you can swap in a DB
// ─────────────────────────────────────────────
const chatHistory = [];
const MAX_HISTORY = 100;

// ─────────────────────────────────────────────
//  Mux helpers
// ─────────────────────────────────────────────
const MUX_BASE = 'https://api.mux.com';
const MUX_AUTH = Buffer.from(
  `${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`
).toString('base64');

async function getMuxStreamStatus() {
  try {
    const res = await fetch(
      `${MUX_BASE}/video/v1/live-streams/${process.env.MUX_LIVE_STREAM_ID}`,
      {
        headers: {
          Authorization: `Basic ${MUX_AUTH}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!res.ok) throw new Error(`Mux API error: ${res.status}`);
    const json = await res.json();
    const stream = json.data;
    return {
      live: stream.status === 'active',
      playbackId: stream.playback_ids?.[0]?.id || null,
      title: stream.passthrough || 'Live Stream',
    };
  } catch (err) {
    console.error('Mux fetch error:', err.message);
    return { live: false, playbackId: null, title: 'Live Stream' };
  }
}

// ─────────────────────────────────────────────
//  Viewer tracking via WebSocket connections
// ─────────────────────────────────────────────
function getViewerCount() {
  let count = 0;
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) count++;
  });
  return count;
}

// ─────────────────────────────────────────────
//  REST — Stream status endpoint
//  Your frontend polls this every 8 seconds
// ─────────────────────────────────────────────
app.get('/api/stream-status', async (req, res) => {
  const status = await getMuxStreamStatus();
  res.json({
    live: status.live,
    viewers: getViewerCount(),
    title: status.title,
    playbackId: status.playbackId,
  });
});

// ─────────────────────────────────────────────
//  REST — Post a chat message (called by frontend)
// ─────────────────────────────────────────────
app.post('/api/chat', (req, res) => {
  const { username, text } = req.body;
  if (!username || !text) return res.status(400).json({ error: 'Missing fields' });

  const msg = {
    type: 'chat',
    username: username.slice(0, 24),
    text: text.slice(0, 200),
    ts: Date.now(),
  };

  chatHistory.push(msg);
  if (chatHistory.length > MAX_HISTORY) chatHistory.shift();

  // Broadcast to all connected WebSocket clients
  const payload = JSON.stringify(msg);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });

  res.json({ ok: true });
});

// ─────────────────────────────────────────────
//  WebSocket — real-time chat delivery
// ─────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('Client connected. Viewers:', getViewerCount());

  // Send recent chat history to new joiner
  ws.send(JSON.stringify({
    type: 'history',
    messages: chatHistory.slice(-30),
  }));

  // Broadcast updated viewer count to everyone
  broadcastViewerCount();

  ws.on('close', () => {
    console.log('Client disconnected. Viewers:', getViewerCount());
    broadcastViewerCount();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });
});

function broadcastViewerCount() {
  const payload = JSON.stringify({
    type: 'viewers',
    count: getViewerCount(),
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ─────────────────────────────────────────────
//  Start server
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
