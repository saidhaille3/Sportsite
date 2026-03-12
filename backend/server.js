const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const { AccessToken } = require('livekit-server-sdk');

const app = express();
app.use(express.json());
app.use(express.static('../'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const chatHistory = [];
let viewerCount = 0;
const spaces = {};

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  viewerCount++;
  broadcast({ type: 'viewers', count: viewerCount });
  ws.send(JSON.stringify({ type: 'history', messages: chatHistory }));
  ws.on('close', () => {
    viewerCount--;
    broadcast({ type: 'viewers', count: viewerCount });
  });
});

app.post('/api/chat', (req, res) => {
  const { username, text } = req.body;
  if (!username || !text) return res.status(400).json({ error: 'Missing fields' });
  const msg = { username, text };
  chatHistory.push(msg);
  if (chatHistory.length > 50) chatHistory.shift();
  broadcast({ type: 'chat', ...msg });
  res.json({ ok: true });
});

app.get('/api/stream-status', (req, res) => {
  res.json({ live: false, viewers: viewerCount, title: 'Live Stream' });
});

app.get('/api/spaces', (req, res) => {
  const list = Object.values(spaces).map(s => ({
    id: s.id,
    name: s.name,
    speakerCount: s.speakers.length,
    listenerCount: s.listeners.length,
  }));
  res.json({ spaces: list });
});

app.get('/api/spaces/:id', (req, res) => {
  const s = spaces[req.params.id];
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ id: s.id, name: s.name, speakerCount: s.speakers.length, listenerCount: s.listeners.length });
});

app.post('/api/spaces/create', async (req, res) => {
  const { name, hostName } = req.body;
  const spaceId = 'space_' + Date.now();
  spaces[spaceId] = { id: spaceId, name, host: hostName, speakers: [hostName], listeners: [] };
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: hostName });
  token.addGrant({ roomJoin: true, room: spaceId, canPublish: true, canSubscribe: true });
  res.json({ spaceId, token: await token.toJwt(), livekitUrl: LIVEKIT_URL });
});

app.post('/api/spaces/join', async (req, res) => {
  const { spaceId, username, asSpeaker } = req.body;
  const space = spaces[spaceId];
  if (!space) return res.status(404).json({ error: 'Space not found' });
  if (asSpeaker && !space.speakers.includes(username)) space.speakers.push(username);
  if (!asSpeaker && !space.listeners.includes(username)) space.listeners.push(username);
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: username });
  token.addGrant({ roomJoin: true, room: spaceId, canPublish: asSpeaker, canSubscribe: true });
  res.json({ token: await token.toJwt(), livekitUrl: LIVEKIT_URL });
});

app.post('/api/spaces/promote', async (req, res) => {
  const { spaceId, username } = req.body;
  const space = spaces[spaceId];
  if (!space) return res.status(404).json({ error: 'Not found' });
  if (!space.speakers.includes(username)) space.speakers.push(username);
  space.listeners = space.listeners.filter(l => l !== username);
  res.json({ ok: true });
});

// ← server.listen is LAST
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));