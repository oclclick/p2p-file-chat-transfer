const { WebSocketServer } = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;

// Create HTTP server as a base
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('P2P Sender Signaling Server is running.\n');
});

const wss = new WebSocketServer({ server });

// Room database in-memory
// Key: roomCode (6-char uppercase) -> Value: Array of Peer objects { ws, id }
const rooms = new Map();

// Helper map to lookup a client's room and peer ID quickly on disconnect
// Key: ws -> Value: { roomCode, peerId }
const clients = new Map();

// Alphanumeric characters excluding confusing ones: O, 0, I, L, 1, 8, B
const ROOM_CODE_CHARS = 'ACDEFGHJKLMNPQRSTUVWXY345679';

function generateRoomCode() {
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
  }
  return result;
}

wss.on('connection', (ws) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] New signaling client connected`);

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message);
      handleMessage(ws, payload);
    } catch (err) {
      const errTimestamp = new Date().toISOString();
      console.error(`[${errTimestamp}] Error handling websocket message:`, err);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });

  ws.on('error', (err) => {
    const errTimestamp = new Date().toISOString();
    console.error(`[${errTimestamp}] Socket error:`, err);
    handleDisconnect(ws);
  });
});

function handleMessage(ws, payload) {
  const { type } = payload;

  switch (type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'create_room':
      handleCreateRoom(ws);
      break;

    case 'join_room':
      handleJoinRoom(ws, payload.code);
      break;

    case 'signal':
      handleSignal(ws, payload.data);
      break;

    default:
      sendError(ws, `Unknown message type: ${type}`);
  }
}

function handleCreateRoom(ws) {
  // If client is already in a room, clean it up
  if (clients.has(ws)) {
    handleDisconnect(ws);
  }

  // Generate unique room code
  let roomCode = generateRoomCode();
  while (rooms.has(roomCode)) {
    roomCode = generateRoomCode();
  }

  const peerId = 'creator_' + Math.random().toString(36).substr(2, 9);
  
  rooms.set(roomCode, [{ ws, id: peerId }]);
  clients.set(ws, { roomCode, peerId });

  console.log(`[${new Date().toISOString()}] Room created: ${roomCode} by peer ${peerId}`);
  ws.send(JSON.stringify({
    type: 'room_created',
    code: roomCode,
    peerId
  }));
}

function handleJoinRoom(ws, rawCode) {
  if (!rawCode) {
    return sendError(ws, 'Room code is required');
  }

  const roomCode = rawCode.trim().toUpperCase();

  // If client is already in a room, clean it up
  if (clients.has(ws)) {
    handleDisconnect(ws);
  }

  if (!rooms.has(roomCode)) {
    console.log(`[${new Date().toISOString()}] Join failed: room ${roomCode} not found`);
    return ws.send(JSON.stringify({
      type: 'error',
      code: 'ROOM_NOT_FOUND',
      message: 'Room not found or has expired'
    }));
  }

  const peers = rooms.get(roomCode);

  if (peers.length >= 2) {
    console.log(`[${new Date().toISOString()}] Join failed: room ${roomCode} is full`);
    return ws.send(JSON.stringify({
      type: 'error',
      code: 'ROOM_FULL',
      message: 'Room is full (max 2 users)'
    }));
  }

  const peerId = 'joiner_' + Math.random().toString(36).substr(2, 9);
  peers.push({ ws, id: peerId });
  clients.set(ws, { roomCode, peerId });

  console.log(`[${new Date().toISOString()}] Peer ${peerId} joined room ${roomCode}`);

  // Notify joiner that they joined successfully
  ws.send(JSON.stringify({
    type: 'room_joined',
    code: roomCode,
    peerId,
    isInitiator: false // Joiner is answerer
  }));

  // Notify the creator that peer joined (creator will act as initiator)
  const creator = peers[0];
  creator.ws.send(JSON.stringify({
    type: 'peer_joined',
    peerId
  }));
  
  // Send room_joined success status to creator as well
  creator.ws.send(JSON.stringify({
    type: 'room_ready',
    code: roomCode,
    isInitiator: true // Creator initiates the connection
  }));
}

function handleSignal(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) {
    return sendError(ws, 'Not registered in any room');
  }

  const { roomCode, peerId } = clientInfo;
  const peers = rooms.get(roomCode);

  if (!peers) return;

  // Find the other peer in the room
  const otherPeer = peers.find(p => p.id !== peerId);
  if (otherPeer) {
    otherPeer.ws.send(JSON.stringify({
      type: 'signal',
      data
    }));
  }
}

function handleDisconnect(ws) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const { roomCode, peerId } = clientInfo;
  clients.delete(ws);

  if (rooms.has(roomCode)) {
    const peers = rooms.get(roomCode);
    const updatedPeers = peers.filter(p => p.id !== peerId);

    if (updatedPeers.length === 0) {
      // Room is empty, delete it
      rooms.delete(roomCode);
      console.log(`[${new Date().toISOString()}] Room ${roomCode} is empty and has been deleted`);
    } else {
      // Notify the remaining peer that their partner left
      rooms.set(roomCode, updatedPeers);
      const remainingPeer = updatedPeers[0];
      remainingPeer.ws.send(JSON.stringify({
        type: 'peer_disconnected'
      }));
      console.log(`[${new Date().toISOString()}] Peer ${peerId} left room ${roomCode}. Remaining peer notified.`);
    }
  }
}

function sendError(ws, message) {
  ws.send(JSON.stringify({
    type: 'error',
    message
  }));
}

server.listen(PORT, () => {
  console.log(`[${new Date().toISOString()}] Signaling server listening on port ${PORT}`);
});
