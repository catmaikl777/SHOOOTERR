// ============================================================
// server.js — WebSocket relay + MaxAC + Lobbies
// ============================================================
const { WebSocketServer } = require('ws');
const fs = require('fs');

const port = process.env.PORT || 3000;
const wss = new WebSocketServer({
  port,
  maxPayload: 4096
});

const AC = {
  MAX_PACKET_BYTES: 2000,
  MAX_MSG_PER_SEC: 60,
  MAX_ROOMS: 200,
  MAX_CLIENTS_PER_ROOM: 12,
  MAX_SEQ_GAP: 500,

  STRIKE_DECAY_MS: 60000,
  STRIKE_KICK: 8,
  STRIKE_SEVERE: 3,

  BAN_FILE: './bans.json',
  IP_BAN_MS: 60 * 60 * 1000,
  MAX_BANS_PER_IP: 3
};

const rooms = new Map();
const roomHost = new Map();
const clients = new Map();

const bannedHashes = new Set();
const ipStrikes = new Map();
const ipBanList = new Map();

// Данные лобби
const roomMeta = new Map();


// ============================================================
// LOBBIES
// ============================================================

function cleanLobbyName(name) {
  return String(name || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 32) || 'Без названия';
}

function makeRoomId() {
  let id;

  do {
    id = 'room_' + Math.random()
      .toString(36)
      .slice(2, 8);
  } while (rooms.has(id));

  return id;
}

function lobbyList() {
  const out = [];

  for (const [id, room] of rooms) {
    const meta = roomMeta.get(id) || {
      name: id,
      private: false
    };

    out.push({
      id,
      name: meta.name,
      private: !!meta.private,
      players: room.size,
      maxPlayers: AC.MAX_CLIENTS_PER_ROOM
    });
  }

  return out;
}

function sendLobbyList(ws) {
  try {
    ws.send(JSON.stringify({
      type: 'lobbies',
      lobbies: lobbyList()
    }));
  } catch {}
}

function broadcastLobbyList() {
  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      sendLobbyList(ws);
    }
  }
}


// ============================================================
// SECURITY / VALIDATION
// ============================================================

function safeParse(raw) {
  if (!raw) return null;

  const str = raw.toString();

  if (str.length > AC.MAX_PACKET_BYTES) {
    return null;
  }

  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function validateVec(v) {
  return Array.isArray(v) &&
    v.length === 2 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Math.abs(v[0]) <= 1.5 &&
    Math.abs(v[1]) <= 1.5;
}

function validateInputPayload(d) {
  if (!d || typeof d !== 'object') {
    return false;
  }

  if (!validateVec(d.m) || !validateVec(d.a)) {
    return false;
  }

  if (d.f !== 0 && d.f !== 1) {
    return false;
  }

  if (typeof d.seq !== 'number' ||
      !Number.isFinite(d.seq)) {
    return false;
  }

  if (d.seq < 0 || d.seq > 1e9) {
    return false;
  }

  return true;
}


// ============================================================
// BANS
// ============================================================

function loadBans() {
  try {
    if (fs.existsSync(AC.BAN_FILE)) {
      const arr = JSON.parse(
        fs.readFileSync(AC.BAN_FILE, 'utf8')
      );

      if (Array.isArray(arr)) {
        for (const h of arr) {
          bannedHashes.add(h);
        }
      }

      console.log(
        `[AC] loaded ${bannedHashes.size} bans`
      );
    }
  } catch (e) {}
}

function saveBans() {
  try {
    fs.writeFileSync(
      AC.BAN_FILE,
      JSON.stringify([...bannedHashes])
    );
  } catch {}
}

loadBans();


// ============================================================
// CLIENTS
// ============================================================

function ensureClient(ws, ip) {
  let c = clients.get(ws.peerId);

  if (!c) {
    c = {
      peerId: ws.peerId,
      ws,
      ip,

      strikes: 0,
      lastStrike: 0,

      msgTimes: [],

      seq: -1,

      pubHash: null,
      verified: false,

      joinedAt: Date.now(),
      room: null
    };

    clients.set(ws.peerId, c);
  }

  return c;
}

function decay(c) {
  const now = Date.now();

  if (
    c.strikes > 0 &&
    now - c.lastStrike > AC.STRIKE_DECAY_MS
  ) {
    c.strikes--;
    c.lastStrike = now;
  }
}

function strike(c, reason, weight = 1) {
  c.strikes += weight;
  c.lastStrike = Date.now();

  console.warn(
    `[AC] strike ${c.peerId?.slice(0, 8)} ` +
    `"${reason}" (+${weight}) = ${c.strikes}`
  );

  if (c.strikes >= AC.STRIKE_KICK) {
    banClient(c, `strikes: ${reason}`);
    return false;
  }

  return true;
}

function banClient(c, reason) {
  if (c.pubHash) {
    bannedHashes.add(c.pubHash);
    saveBans();
  }

  console.warn(
    `[AC] BAN peer=${c.peerId?.slice(0, 8)} ` +
    `reason="${reason}"`
  );

  try {
    c.ws.send(JSON.stringify({
      type: 'banned',
      reason
    }));
  } catch {}

  try {
    c.ws.close(1008, 'banned');
  } catch {}
}

function checkRate(c) {
  const now = Date.now();

  c.msgTimes.push(now);

  while (
    c.msgTimes.length &&
    now - c.msgTimes[0] > 1000
  ) {
    c.msgTimes.shift();
  }

  if (c.msgTimes.length > AC.MAX_MSG_PER_SEC) {
    return strike(
      c,
      'rate',
      AC.STRIKE_SEVERE
    );
  }

  return true;
}


// ============================================================
// CLEANUP
// ============================================================

function cleanupClient(ws, reason) {
  const c = clients.get(ws.peerId);

  if (!c) return;

  const roomId = c.room;

  if (!roomId) {
    clients.delete(c.peerId);
    broadcastLobbyList();
    return;
  }

  const room = rooms.get(roomId);

  if (!room) {
    clients.delete(c.peerId);
    broadcastLobbyList();
    return;
  }

  room.delete(ws);

  // Сообщаем остальным, что игрок вышел
  for (const peer of room) {
    if (peer.readyState === 1) {
      try {
        peer.send(JSON.stringify({
          type: 'peer-leave',
          peerId: c.peerId
        }));
      } catch {}
    }
  }

  // Если вышел хост — назначаем нового
  if (roomHost.get(roomId) === c.peerId) {
    const remaining = [...room];

    if (remaining.length) {
      const newHost = remaining[0].peerId;

      roomHost.set(roomId, newHost);

      for (const p of remaining) {
        if (p.readyState === 1) {
          try {
            p.send(JSON.stringify({
              type: 'host-change',
              host: newHost
            }));
          } catch {}
        }
      }
    } else {
      roomHost.delete(roomId);
    }
  }

  // Пустое лобби удаляем
  if (room.size === 0) {
    rooms.delete(roomId);
    roomMeta.delete(roomId);
  }

  clients.delete(c.peerId);

  broadcastLobbyList();

  console.log(
    `[S] - ${c.peerId.slice(0, 8)} (${reason})`
  );
}


// ============================================================
// WEBSOCKET
// ============================================================

wss.on('connection', (ws, req) => {

  const ip = (
    req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress ||
    'unknown'
  )
    .split(',')[0]
    .trim();

  if (
    ws._socket &&
    ws._socket.setNoDelay
  ) {
    ws._socket.setNoDelay(true);
  }

  // Проверка IP-бана
  const banUntil = ipBanList.get(ip);

  if (
    banUntil &&
    banUntil > Date.now()
  ) {
    try {
      ws.close(1008, 'ip banned');
    } catch {}

    return;
  }

  // ID игрока
  ws.peerId =
    'peer_' +
    Math.random()
      .toString(36)
      .slice(2, 10);

  ws.isAlive = true;

  const c = ensureClient(ws, ip);

  console.log(
    `[S] + ${c.peerId.slice(0, 8)} from ${ip}`
  );


  // ==========================================================
  // MESSAGE
  // ==========================================================

  ws.on('message', raw => {

    const msg = safeParse(raw);

    if (!msg) {
      strike(
        c,
        'bad packet',
        AC.STRIKE_SEVERE
      );
      return;
    }

    if (!checkRate(c)) {
      return;
    }

    decay(c);


    // ========================================================
    // СПИСОК ЛОББИ
    // ========================================================

    if (msg.type === 'list') {
      sendLobbyList(ws);
      return;
    }


    // ========================================================
    // СОЗДАНИЕ ЛОББИ
    // ========================================================

    if (msg.type === 'create') {

      if (rooms.size >= AC.MAX_ROOMS) {
        try {
          ws.send(JSON.stringify({
            type: 'error',
            msg: 'too many rooms'
          }));
        } catch {}

        return;
      }

      const isPrivate = !!msg.private;

      const password = isPrivate
        ? String(msg.password || '').slice(0, 64)
        : '';

      if (isPrivate && !password) {
        try {
          ws.send(JSON.stringify({
            type: 'error',
            msg: 'password required'
          }));
        } catch {}

        return;
      }

      const roomId = makeRoomId();

      rooms.set(
        roomId,
        new Set()
      );

      roomMeta.set(roomId, {
        name: cleanLobbyName(msg.name),
        private: isPrivate,
        password
      });

      try {
        ws.send(JSON.stringify({
          type: 'created',
          room: roomId,
          name: roomMeta.get(roomId).name,
          private: isPrivate
        }));
      } catch {}

      broadcastLobbyList();

      console.log(
        `[Lobby] created ${roomId} ` +
        `"${roomMeta.get(roomId).name}" ` +
        `private=${isPrivate}`
      );

      return;
    }


    // ========================================================
    // ВХОД В ЛОББИ
    // ========================================================

    if (msg.type === 'join') {

      if (c.room) {
        strike(c, 'double join');
        return;
      }

      const roomId =
        String(msg.room || '').slice(0, 32);

      if (!roomId) {
        strike(c, 'no room');
        return;
      }

      // Для совместимости создаём отсутствующую комнату
      if (!rooms.has(roomId)) {
        rooms.set(
          roomId,
          new Set()
        );

        roomMeta.set(roomId, {
          name: roomId,
          private: false,
          password: ''
        });
      }

      const meta =
        roomMeta.get(roomId) || {
          name: roomId,
          private: false,
          password: ''
        };


      // Проверяем пароль
      if (
        meta.private &&
        String(msg.password || '') !== meta.password
      ) {

        try {
          ws.send(JSON.stringify({
            type: 'error',
            msg: 'wrong password'
          }));
        } catch {}

        return;
      }


      const room = rooms.get(roomId);

      // Комната заполнена
      if (
        room.size >=
        AC.MAX_CLIENTS_PER_ROOM
      ) {

        try {
          ws.send(JSON.stringify({
            type: 'error',
            msg: 'room full'
          }));
        } catch {}

        try {
          ws.close(
            1008,
            'room full'
          );
        } catch {}

        return;
      }


      // Добавляем игрока
      c.room = roomId;
      ws.roomId = roomId;

      room.add(ws);


      // Назначаем хоста
      if (!roomHost.has(roomId)) {
        roomHost.set(
          roomId,
          c.peerId
        );
      }


      const existingPeers =
        [...room]
          .map(p => p.peerId)
          .filter(
            id =>
              id &&
              id !== c.peerId
          );


      // Ответ подключившемуся
      try {
        ws.send(JSON.stringify({
          type: 'welcome',

          peerId: c.peerId,

          peers: existingPeers,

          host:
            roomHost.get(roomId),

          lobbyName:
            meta.name,

          private:
            !!meta.private
        }));
      } catch {}


      // Уведомляем остальных
      for (const peer of room) {

        if (
          peer !== ws &&
          peer.readyState === 1
        ) {

          try {
            peer.send(JSON.stringify({
              type: 'peer-join',
              peerId: c.peerId
            }));
          } catch {}
        }
      }


      console.log(
        `[Room ${roomId}] + ` +
        `${c.peerId.slice(0, 8)} ` +
        `total=${room.size}`
      );

      broadcastLobbyList();

      return;
    }


    // ========================================================
    // ДАЛЬШЕ НУЖНО БЫТЬ В ЛОББИ
    // ========================================================

    if (!c.room) {
      strike(
        c,
        'msg before join',
        AC.STRIKE_SEVERE
      );

      return;
    }


    // ========================================================
    // PLAYER ID / BAN HASH
    // ========================================================

    if (
      msg.a === 'id' &&
      msg.d &&
      msg.d.pubHash
    ) {

      const hash =
        String(msg.d.pubHash)
          .slice(0, 64);

      if (bannedHashes.has(hash)) {
        banClient(
          c,
          'persistent ban'
        );

        return;
      }

      c.pubHash = hash;
    }


    // ========================================================
    // INPUT
    // ========================================================

    if (
      msg.a === 'in' &&
      msg.d
    ) {

      const d = msg.d;

      if (!validateInputPayload(d)) {
        strike(
          c,
          'bad input',
          AC.STRIKE_SEVERE
        );

        return;
      }

      if (d.seq <= c.seq) {
        strike(
          c,
          'replay',
          AC.STRIKE_SEVERE
        );

        return;
      }

      if (
        c.seq >= 0 &&
        d.seq - c.seq > AC.MAX_SEQ_GAP
      ) {

        strike(
          c,
          'seq gap'
        );

        return;
      }

      c.seq = d.seq;
    }


    // ========================================================
    // HOST ONLY ACTIONS
    // ========================================================

    if (
      msg.a === 'st' ||
      msg.a === 'bl' ||
      msg.a === 'hit' ||
      msg.a === 'pk'
    ) {

      const hostId =
        roomHost.get(c.room);

      if (
        hostId !== c.peerId
      ) {

        strike(
          c,
          `${msg.a} from non-host`,
          AC.STRIKE_SEVERE
        );

        return;
      }
    }


    // ========================================================
    // BAN
    // ========================================================

    if (msg.a === 'ban') {

      const hostId =
        roomHost.get(c.room);

      if (
        hostId !== c.peerId
      ) {

        strike(
          c,
          'ban from non-host',
          AC.STRIKE_SEVERE
        );

        return;
      }

      const target =
        msg.d &&
        msg.d.id;

      if (
        target &&
        target !== c.peerId
      ) {

        const tc =
          clients.get(target);

        if (tc) {

          if (msg.d.pubHash) {
            bannedHashes.add(
              msg.d.pubHash
            );

            saveBans();
          }

          try {
            tc.ws.send(
              JSON.stringify({
                type: 'banned',
                reason:
                  msg.d.reason ||
                  'banned'
              })
            );
          } catch {}

          try {
            tc.ws.close(
              1008,
              'banned'
            );
          } catch {}
        }
      }
    }


    // ========================================================
    // RELAY GAME DATA
    // ========================================================

    const room =
      rooms.get(c.room);

    if (!room) {
      return;
    }


    // Сообщение конкретному игроку
    if (msg.to) {

      const target =
        [...room].find(
          p => p.peerId === msg.to
        );

      if (
        target &&
        target.readyState === 1
      ) {

        try {
          target.send(
            JSON.stringify({
              ...msg.data,
              from: c.peerId
            })
          );
        } catch {}
      }

    }

    // Broadcast всем остальным
    else if (msg.data) {

      for (const peer of room) {

        if (peer === ws) {
          continue;
        }

        if (
          peer.readyState !== 1
        ) {
          continue;
        }


        // Не отправляем broadcast
        // обратно владельцу события
        if (
          msg.data.a === 'bl' &&
          msg.data.d &&
          msg.data.d.owner === peer.peerId
        ) {
          continue;
        }


        try {
          peer.send(
            JSON.stringify({
              ...msg.data,
              from: c.peerId
            })
          );
        } catch {}
      }
    }
  });


  // ==========================================================
  // CLOSE
  // ==========================================================

  ws.on(
    'close',
    () => cleanupClient(ws, 'close')
  );


  // ==========================================================
  // ERROR
  // ==========================================================

  ws.on(
    'error',
    err =>
      console.error(
        `[S] err:`,
        err.message
      )
  );


  // ==========================================================
  // PONG
  // ==========================================================

  ws.on(
    'pong',
    () => {
      ws.isAlive = true;
    }
  );
});


// ============================================================
// PING
// ============================================================

setInterval(() => {

  wss.clients.forEach(ws => {

    if (ws.isAlive === false) {
      try {
        ws.terminate();
      } catch {}

      return;
    }

    ws.isAlive = false;

    try {
      ws.ping();
    } catch {}
  });

}, 10000);


// ============================================================
// CLEANUP DEAD CLIENTS
// ============================================================

setInterval(() => {

  const activeIds =
    new Set(
      [...wss.clients]
        .map(ws => ws.peerId)
    );

  for (
    const [peerId, c]
    of clients
  ) {

    if (
      !activeIds.has(peerId)
    ) {

      const roomId = c.room;

      if (roomId) {

        const room =
          rooms.get(roomId);

        if (room) {

          // Сообщаем игрокам
          for (const peer of room) {

            if (
              peer.readyState === 1
            ) {

              try {
                peer.send(
                  JSON.stringify({
                    type: 'peer-leave',
                    peerId
                  })
                );
              } catch {}
            }
          }

          room.delete(c.ws);


          // Новый хост
          if (
            roomHost.get(roomId) ===
            peerId
          ) {

            const remaining =
              [...room];

            if (remaining.length) {

              const newHost =
                remaining[0].peerId;

              roomHost.set(
                roomId,
                newHost
              );

              for (
                const p of remaining
              ) {

                if (
                  p.readyState === 1
                ) {

                  try {
                    p.send(
                      JSON.stringify({
                        type: 'host-change',
                        host: newHost
                      })
                    );
                  } catch {}
                }
              }

            } else {
              roomHost.delete(roomId);
            }
          }


          // Удаляем пустую комнату
          if (room.size === 0) {
            rooms.delete(roomId);
            roomMeta.delete(roomId);
          }
        }
      }

      clients.delete(peerId);

      broadcastLobbyList();
    }
  }

}, 15000);


// ============================================================
// START
// ============================================================

console.log(
  `[S] WebSocket relay + MaxAC + Lobbies ` +
  `listening on port ${port}`
);
