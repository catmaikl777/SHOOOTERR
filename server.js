const { WebSocketServer } = require('ws');

const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port }, () => {
  console.log(`[Server] WebSocket relay started on port ${port}`);
});

const rooms = new Map();      // roomId -> Set<WebSocket>
const roomHost = new Map();   // roomId -> peerId

wss.on('connection', (ws) => {
  let roomId = null;
  let peerId = null;

  ws.on('message', (rawData) => {
    try {
      const msg = JSON.parse(rawData);

      if (msg.type === 'join') {
        roomId = msg.room;
        if (!rooms.has(roomId)) rooms.set(roomId, new Set());
        const room = rooms.get(roomId);

        peerId = 'peer_' + Math.random().toString(36).slice(2, 10);
        ws.peerId = peerId;
        room.add(ws);

        // Первый вошедший становится хостом
        if (!roomHost.has(roomId)) roomHost.set(roomId, peerId);

        const existingPeers = [...room]
          .map((p) => p.peerId)
          .filter((id) => id && id !== peerId);

        ws.send(JSON.stringify({
          type: 'welcome',
          peerId,
          peers: existingPeers,
          host: roomHost.get(roomId),   // ← хост, назначенный сервером
        }));

        for (const peer of room) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ type: 'peer-join', peerId }));
          }
        }

        console.log(`[Room ${roomId}] + ${peerId}, total: ${room.size}, host: ${roomHost.get(roomId)}`);
        return;
      }

      const room = rooms.get(roomId);
      if (!room) return;

      if (msg.to) {
        const target = [...room].find((p) => p.peerId === msg.to);
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ ...msg.data, from: ws.peerId }));
        }
      } else {
        for (const peer of room) {
          if (peer !== ws && peer.readyState === 1) {
            peer.send(JSON.stringify({ ...msg.data, from: ws.peerId }));
          }
        }
      }
    } catch (err) {
      console.error('[Server] error:', err);
    }
  });

  ws.on('close', () => {
    if (!roomId || !peerId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    room.delete(ws);

    for (const peer of room) {
      if (peer.readyState === 1) {
        peer.send(JSON.stringify({ type: 'peer-leave', peerId }));
      }
    }

    // Если ушёл хост — назначаем нового
    if (roomHost.get(roomId) === peerId) {
      const remaining = [...room];
      if (remaining.length > 0) {
        const newHostId = remaining[0].peerId;
        roomHost.set(roomId, newHostId);
        for (const p of remaining) {
          if (p.readyState === 1) {
            p.send(JSON.stringify({ type: 'host-change', host: newHostId }));
          }
        }
        console.log(`[Room ${roomId}] host migrated: ${peerId} → ${newHostId}`);
      } else {
        roomHost.delete(roomId);
      }
    }

    console.log(`[Room ${roomId}] - ${peerId}, remaining: ${room.size}`);
    if (room.size === 0) rooms.delete(roomId);
  });

  ws.on('error', (err) => console.error(`[Client ${peerId}] error:`, err));
});