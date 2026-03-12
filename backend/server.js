const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');

const app = express();
app.use(express.json());
app.use(express.static('../'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// In-memory chat history (last 50 messages)
const chatHistory = [];
let viewerCount = 0;

// Broadcast to all connected clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

// WebSocket
wss.on('connection', (ws) => {
  viewerCount++;
  broadcast({ type: 'viewers', count: viewerCount });

  // Send chat history to new joiner
  ws.send(JSON.stringify({ type: 'history', messages: chatHistory }));

  ws.on('close', () => {
    viewerCount--;
    broadcast({ type: 'viewers', count: viewerCount });
  });
});

// POST /api/chat
app.post('/api/chat', (req, res) => {
  const { username, text } = req.body;
  if (!username || !text) return res.status(400).json({ error: 'Missing fields' });

  const msg = { username, text };
  chatHistory.push(msg);
  if (chatHistory.length > 50) chatHistory.shift();

  broadcast({ type: 'chat', ...msg });
  res.json({ ok: true });
});

// GET /api/stream-status
app.get('/api/stream-status', (req, res) => {
  res.json({ live: false, viewers: viewerCount, title: 'Live Stream' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
