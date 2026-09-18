// server_lobbies.js
const WebSocket = require('ws');
const crypto = require('crypto');
const http = require('http');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

const rooms = new Map();
const roomHost = new Map();
const roomMeta = new Map();
const clients = new Map();

const AC = {
  MAX_CLIENTS: 1000,
  MAX_CLIENTS_PER_ROOM: 12,
  MAX_ROOMS: 100,
  MAX_MSG: 64 * 1024,
};

function cleanLobbyName(s){
  return String(s || '')
    .replace(/[<>&"'`]/g, '')
    .trim()
    .slice(0, 24);
}

function makeRoomId(){
  let id = '';
  do {
    id = 'room_' + Math.random().toString(36).slice(2, 8);
  } while (rooms.has(id));

  return id;
}

function lobbyList(){
  return [...rooms.entries()]
    .map(([id, room]) => {
      const meta = roomMeta.get(id) || {
        name: id,
        private: false
      };

      return {
        id,
        name: meta.name || id,
        private: !!meta.private,
        players: room.size,
        maxPlayers: AC.MAX_CLIENTS_PER_ROOM
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function sendLobbyList(ws){
  try {
    ws.send(JSON.stringify({
      type: 'lobbies',
      lobbies: lobbyList()
    }));
  } catch {}
}

function broadcastLobbyList(){
  for (const ws of wss.clients){
    if (ws.readyState === WebSocket.OPEN){
      sendLobbyList(ws);
    }
  }
}

function send(ws, data){
  if (ws.readyState === WebSocket.OPEN){
    ws.send(JSON.stringify(data));
  }
}

function broadcastRoom(roomId, data, except = null){
  const room = rooms.get(roomId);
  if (!room) return;

  for (const peerId of room){
    const c = clients.get(peerId);

    if (
      c &&
      c.ws.readyState === WebSocket.OPEN &&
      c.ws !== except
    ){
      c.ws.send(JSON.stringify(data));
    }
  }
}

function removeClient(c){
  if (!c) return;

  const roomId = c.room;

  if (roomId && rooms.has(roomId)){
    const room = rooms.get(roomId);

    room.delete(c.peerId);

    if (roomHost.get(roomId) === c.peerId){
      const nextHost = [...room][0];

      if (nextHost){
        roomHost.set(roomId, nextHost);

        broadcastRoom(roomId, {
          type: 'host',
          peerId: nextHost
        });
      } else {
        roomHost.delete(roomId);
      }
    }

    if (room.size === 0){
      rooms.delete(roomId);
      roomHost.delete(roomId);
      roomMeta.delete(roomId);
    }
  }

  clients.delete(c.peerId);
  broadcastLobbyList();
}

wss.on('connection', (ws, req) => {

  if (clients.size >= AC.MAX_CLIENTS){
    send(ws, {
      type: 'error',
      msg: 'server full'
    });

    ws.close();
    return;
  }

  const peerId = crypto.randomBytes(8).toString('hex');

  const c = {
    ws,
    peerId,
    room: null,
    alive: true,
    joinedAt: Date.now()
  };

  clients.set(peerId, c);

  send(ws, {
    type: 'hello',
    peerId
  });

  ws.on('pong', () => {
    c.alive = true;
  });

  ws.on('message', raw => {

    if (raw.length > AC.MAX_MSG){
      ws.close();
      return;
    }

    let msg;

    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, {
        type: 'error',
        msg: 'invalid json'
      });
      return;
    }

    if (!msg || typeof msg.type !== 'string'){
      return;
    }

    /*
     * ============================================================
     * СПИСОК ЛОББИ
     * ============================================================
     */

    if (msg.type === 'list'){
      sendLobbyList(ws);
      return;
    }

    /*
     * ============================================================
     * СОЗДАНИЕ ЛОББИ
     * ============================================================
     */

    if (msg.type === 'create'){

      if (c.room){
        send(ws, {
          type: 'error',
          msg: 'already in room'
        });
        return;
      }

      if (rooms.size >= AC.MAX_ROOMS){
        send(ws, {
          type: 'error',
          msg: 'server room limit'
        });
        return;
      }

      const name = cleanLobbyName(msg.name);
      const isPrivate = !!msg.private;
      const password = String(msg.password || '').slice(0, 32);

      if (!name){
        send(ws, {
          type: 'error',
          msg: 'lobby name required'
        });
        return;
      }

      if (isPrivate && !password){
        send(ws, {
          type: 'error',
          msg: 'private lobby requires password'
        });
        return;
      }

      const roomId = makeRoomId();

      rooms.set(roomId, new Set());

      roomMeta.set(roomId, {
        name,
        private: isPrivate,
        password
      });

      send(ws, {
        type: 'created',
        room: roomId,
        name,
        private: isPrivate
      });

      broadcastLobbyList();

      return;
    }

    /*
     * ============================================================
     * ВХОД В ЛОББИ
     * ============================================================
     */

    if (msg.type === 'join'){

      if (c.room){
        send(ws, {
          type: 'error',
          msg: 'already in room'
        });
        return;
      }

      const roomId = String(msg.room || '').slice(0, 32);

      if (!roomId){
        send(ws, {
          type: 'error',
          msg: 'no room'
        });
        return;
      }

      /*
       * Совместимость со старыми комнатами:
       * если комнаты нет, она создаётся как открытая.
       */

      if (!rooms.has(roomId)){
        rooms.set(roomId, new Set());

        roomMeta.set(roomId, {
          name: roomId,
          private: false,
          password: ''
        });
      }

      const meta =
        roomMeta.get(roomId) ||
        {
          name: roomId,
          private: false,
          password: ''
        };

      /*
       * Проверяем пароль закрытого лобби.
       */

      if (
        meta.private &&
        String(msg.password || '') !==
        String(meta.password || '')
      ){
        send(ws, {
          type: 'error',
          msg: 'wrong lobby password'
        });

        return;
      }

      const room = rooms.get(roomId);

      if (room.size >= AC.MAX_CLIENTS_PER_ROOM){
        send(ws, {
          type: 'error',
          msg: 'room full'
        });

        return;
      }

      /*
       * Список уже находящихся игроков.
       */

      const existingPeers = [...room];

      /*
       * Добавляем игрока.
       */

      room.add(c.peerId);
      c.room = roomId;

      /*
       * Если это первый игрок — он становится хостом.
       */

      if (!roomHost.has(roomId)){
        roomHost.set(roomId, c.peerId);
      }

      const host = roomHost.get(roomId);

      send(ws, {
        type: 'welcome',
        peerId: c.peerId,
        peers: existingPeers,
        host,
        lobby: {
          id: roomId,
          name: meta.name || roomId,
          private: !!meta.private
        }
      });

      /*
       * Сообщаем остальным игрокам о новом игроке.
       */

      broadcastRoom(
        roomId,
        {
          type: 'peer_join',
          peerId: c.peerId
        },
        ws
      );

      console.log(
        `[Room ${roomId}] + ${c.peerId.slice(0, 8)} total=${room.size}`
      );

      broadcastLobbyList();

      return;
    }

    /*
     * ============================================================
     * ИГРОВЫЕ СООБЩЕНИЯ
     * ============================================================
     */

    if (!c.room){
      send(ws, {
        type: 'error',
        msg: 'not in room'
      });

      return;
    }

    /*
     * Остальная игровая логика:
     * сообщения просто передаются другим игрокам комнаты.
     *
     * Здесь сохраняется простая relay-модель,
     * которая использовалась существующей игрой.
     */

    if (
      msg.type === 'input' ||
      msg.type === 'state' ||
      msg.type === 'event' ||
      msg.type === 'snapshot' ||
      msg.type === 'ping' ||
      msg.type === 'chat'
    ){

      broadcastRoom(
        c.room,
        {
          ...msg,
          peerId: c.peerId
        },
        ws
      );

      return;
    }

  });

  ws.on('close', () => {
    removeClient(c);
  });

  ws.on('error', () => {
    removeClient(c);
  });
});


/*
 * ============================================================
 * PING / PONG
 * ============================================================
 */

const heartbeat = setInterval(() => {

  for (const c of clients.values()){

    if (!c.alive){
      try {
        c.ws.terminate();
      } catch {}

      continue;
    }

    c.alive = false;

    try {
      c.ws.ping();
    } catch {}
  }

}, 30000);


/*
 * ============================================================
 * ЗАВЕРШЕНИЕ СЕРВЕРА
 * ============================================================
 */

wss.on('close', () => {
  clearInterval(heartbeat);
});


console.log(`WebSocket server started on port ${PORT}`);
