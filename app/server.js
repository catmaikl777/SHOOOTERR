// ============================================================
// server.js — WebSocket relay + Maximum AntiCheat
// ============================================================
const { WebSocketServer } = require('ws');
const fs = require('fs');

const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port, maxPayload: 2048 });

// ============================================================
// КОНФИГ АНТИЧИТА
// ============================================================
const AC = {
  MAX_PACKET_BYTES:        1024,
  MAX_MSG_PER_SEC:         60,
  MAX_ROOMS:               200,
  MAX_CLIENTS_PER_ROOM:    12,
  MAX_SEQ_GAP:             500,
  STRIKE_DECAY_MS:         60000,
  STRIKE_KICK:             8,
  STRIKE_SEVERE:           3,
  BAN_FILE:                './bans.json',
  IP_BAN_MS:               60 * 60 * 1000,
  MAX_BANS_PER_IP:         3,
};

// ============================================================
// ХРАНИЛИЩЕ
// ============================================================
const rooms         = new Map();
const roomHost      = new Map();
const clients       = new Map();
const bannedHashes  = new Set();
const ipStrikes     = new Map();
const ipBanList     = new Map();

// ============================================================
// УТИЛИТЫ
// ============================================================
function safeParse(raw){
  if (!raw) return null;
  const str = raw.toString();
  if (str.length > AC.MAX_PACKET_BYTES) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function validateVec(v){
  return Array.isArray(v) && v.length === 2 &&
    Number.isFinite(v[0]) && Number.isFinite(v[1]) &&
    Math.abs(v[0]) <= 1.5 && Math.abs(v[1]) <= 1.5;
}

function validateInputPayload(d){
  if (!d || typeof d !== 'object') return false;
  if (!validateVec(d.m)) return false;
  if (!validateVec(d.a)) return false;
  if (d.f !== 0 && d.f !== 1) return false;
  if (typeof d.seq !== 'number' || !Number.isFinite(d.seq)) return false;
  if (d.seq < 0 || d.seq > 1e9) return false;
  return true;
}

function loadBans(){
  try {
    if (fs.existsSync(AC.BAN_FILE)){
      const arr = JSON.parse(fs.readFileSync(AC.BAN_FILE, 'utf8'));
      if (Array.isArray(arr)) for (const h of arr) bannedHashes.add(h);
      console.log(`[AC] loaded ${bannedHashes.size} persistent bans`);
    }
  } catch (e) { console.warn('[AC] loadBans err', e.message); }
}
function saveBans(){
  try { fs.writeFileSync(AC.BAN_FILE, JSON.stringify([...bannedHashes])); }
  catch (e) { console.warn('[AC] saveBans err', e.message); }
}
loadBans();

// ============================================================
// СОСТОЯНИЕ КЛИЕНТА
// ============================================================
function ensureClient(ws, ip){
  let c = clients.get(ws.peerId);
  if (!c){
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
      room: null,
      bytes: 0,
    };
    clients.set(ws.peerId, c);
  }
  return c;
}

function decay(c){
  const now = Date.now();
  if (c.strikes > 0 && now - c.lastStrike > AC.STRIKE_DECAY_MS){
    c.strikes--;
    c.lastStrike = now;
  }
}

function strike(c, reason, w = 1){
  c.strikes += w;
  c.lastStrike = Date.now();
  const ip = c.ip;
  const s = ipStrikes.get(ip) || { count: 0, until: 0 };
  s.count++;
  s.until = Date.now() + 5 * 60 * 1000;
  ipStrikes.set(ip, s);

  console.warn(`[AC] strike ${c.peerId?.slice(0,8)} ip=${ip} "${reason}" (+${w}) = ${c.strikes}`);

  if (c.strikes >= AC.STRIKE_KICK){
    banClient(c, `strikes: ${reason}`);
    return false;
  }
  if (s.count >= AC.MAX_BANS_PER_IP){
    ipBanList.set(ip, Date.now() + AC.IP_BAN_MS);
    console.warn(`[AC] IP BAN ${ip} (too many strikes)`);
  }
  return true;
}

function banClient(c, reason){
  if (c.pubHash) bannedHashes.add(c.pubHash);
  saveBans();
  console.warn(`[AC] BAN peer=${c.peerId?.slice(0,8)} hash=${c.pubHash?.slice(0,8)} reason="${reason}"`);
  try { c.ws.send(JSON.stringify({ type: 'banned', reason })); } catch {}
  try { c.ws.close(1008, 'banned'); } catch {}
}

function checkRate(c){
  const now = Date.now();
  c.msgTimes.push(now);
  while (c.msgTimes.length && now - c.msgTimes[0] > 1000) c.msgTimes.shift();
  if (c.msgTimes.length > AC.MAX_MSG_PER_SEC){
    return strike(c, `rate ${c.msgTimes.length}/s`, AC.STRIKE_SEVERE);
  }
  return true;
}

// 🆕 Централизованная очистка клиента
function cleanupClient(ws, reason){
  const c = clients.get(ws.peerId);
  if (!c) return;
  const roomId = c.room;
  if (!roomId){ clients.delete(c.peerId); return; }
  const room = rooms.get(roomId);
  if (!room){ clients.delete(c.peerId); return; }

  room.delete(ws);

  for (const peer of room){
    if (peer.readyState === 1){
      try { peer.send(JSON.stringify({ type: 'peer-leave', peerId: c.peerId })); } catch {}
    }
  }

  if (roomHost.get(roomId) === c.peerId){
    const remaining = [...room];
    if (remaining.length > 0){
      const newHost = remaining[0].peerId;
      roomHost.set(roomId, newHost);
      for (const p of remaining){
        if (p.readyState === 1){
          try { p.send(JSON.stringify({ type: 'host-change', host: newHost })); } catch {}
        }
      }
      console.log(`[Room ${roomId}] host → ${newHost.slice(0,8)}`);
    } else {
      roomHost.delete(roomId);
    }
  }

  if (room.size === 0) rooms.delete(roomId);
  clients.delete(c.peerId);
  console.log(`[S] - ${c.peerId.slice(0,8)} (${reason})`);
}

// ============================================================
// ГЛАВНЫЙ ОБРАБОТЧИК
// ============================================================
wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();

  if (ws._socket && ws._socket.setNoDelay){
    ws._socket.setNoDelay(true)
  }

  const banUntil = ipBanList.get(ip);
  if (banUntil && banUntil > Date.now()){
    console.log(`[AC] rejected ${ip} (IP banned)`);
    try { ws.close(1008, 'ip banned'); } catch {}
    return;
  }

  ws.peerId = 'peer_' + Math.random().toString(36).slice(2, 10);
  ws.isAlive = true;
  const c = ensureClient(ws, ip);

  console.log(`[S] + ${c.peerId.slice(0,8)} from ${ip}`);

  ws.on('message', raw => {
    c.bytes += raw.length || 0;

    const msg = safeParse(raw);
    if (!msg){
      strike(c, 'bad packet', AC.STRIKE_SEVERE);
      return;
    }
    if (!checkRate(c)) return;
    decay(c);

    // ---- JOIN ----
    if (msg.type === 'join'){
      if (c.room){ strike(c, 'double join'); return; }
      const roomId = String(msg.room || '').slice(0, 32);
      if (!roomId){ strike(c, 'no room'); return; }
      if (rooms.size > AC.MAX_ROOMS && !rooms.has(roomId)){
        strike(c, 'too many rooms', AC.STRIKE_SEVERE); return;
      }

      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);

      if (room.size >= AC.MAX_CLIENTS_PER_ROOM){
        try { ws.send(JSON.stringify({ type: 'error', msg: 'room full' })); } catch {}
        try { ws.close(1008, 'room full'); } catch {}
        return;
      }

      c.room = roomId;
      ws.roomId = roomId;
      room.add(ws);

      if (!roomHost.has(roomId)) roomHost.set(roomId, c.peerId);

      const existingPeers = [...room].map(p => p.peerId).filter(id => id && id !== c.peerId);

      try {
        ws.send(JSON.stringify({
          type: 'welcome',
          peerId: c.peerId,
          peers: existingPeers,
          host: roomHost.get(roomId),
        }));
      } catch {}

      for (const peer of room){
        if (peer !== ws && peer.readyState === 1){
          try { peer.send(JSON.stringify({ type: 'peer-join', peerId: c.peerId })); } catch {}
        }
      }

      console.log(`[Room ${roomId}] + ${c.peerId.slice(0,8)} total=${room.size} host=${roomHost.get(roomId)?.slice(0,8)}`);
      return;
    }

    if (!c.room){
      strike(c, 'msg before join', AC.STRIKE_SEVERE);
      return;
    }

    if (msg.a === 'id' && msg.d && msg.d.pubHash){
      const hash = String(msg.d.pubHash).slice(0, 64);
      if (bannedHashes.has(hash)){
        banClient(c, 'persistent ban');
        return;
      }
      c.pubHash = hash;
    }

    if (msg.a === 'in' && msg.d){
      const d = msg.d;
      if (!validateInputPayload(d)){
        strike(c, 'bad input', AC.STRIKE_SEVERE);
        return;
      }
      if (d.seq <= c.seq){
        strike(c, `replay seq ${d.seq}<=${c.seq}`, AC.STRIKE_SEVERE);
        return;
      }
      if (c.seq >= 0 && d.seq - c.seq > AC.MAX_SEQ_GAP){
        strike(c, `seq gap ${d.seq - c.seq}`);
        return;
      }
      c.seq = d.seq;

      const lenM = Math.hypot(d.m[0], d.m[1]);
      if (lenM > 1.05){ d.m[0] /= lenM; d.m[1] /= lenM; }
      const lenA = Math.hypot(d.a[0], d.a[1]);
      if (lenA > 1.05){ d.a[0] /= lenA; d.a[1] /= lenA; }
    }

    if (msg.a === 'st' || msg.a === 'bl' || msg.a === 'hit'){
      const hostId = roomHost.get(c.room);
      if (hostId !== c.peerId){
        strike(c, `${msg.a} from non-host`, AC.STRIKE_SEVERE);
        return;
      }
    }

    if (msg.a === 'ban'){
      const hostId = roomHost.get(c.room);
      if (hostId !== c.peerId){
        strike(c, 'ban from non-host', AC.STRIKE_SEVERE);
        return;
      }
      const target = msg.d && msg.d.id;
      if (target && target !== c.peerId){
        const tc = clients.get(target);
        if (tc){
          if (msg.d.pubHash) bannedHashes.add(msg.d.pubHash);
          saveBans();
          try { tc.ws.send(JSON.stringify({ type: 'banned', reason: msg.d.reason || 'banned by host' })); } catch {}
          try { tc.ws.close(1008, 'banned'); } catch {}
        }
      }
    }

    const room = rooms.get(c.room);
    if (!room) return;

    if (msg.to){
      const target = [...room].find(p => p.peerId === msg.to);
      if (target && target.readyState === 1){
        try { target.send(JSON.stringify({ ...msg.data, from: c.peerId })); } catch {}
      }
    } else if (msg.data){
      for (const peer of room){
        if (peer !== ws && peer.readyState === 1){
          try { peer.send(JSON.stringify({ ...msg.data, from: c.peerId })); } catch {}
        }
      }
    }
  });

  ws.on('close', () => cleanupClient(ws, 'close'));
  ws.on('error', err => console.error(`[S] err ${c.peerId?.slice(0,8)}:`, err.message));
  ws.on('pong', () => { ws.isAlive = true; });
});

// ============================================================
// HEARTBEAT — 10 секунд (быстро находит мёртвые сокеты)
// ============================================================
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false){
      console.log(`[S] dead socket ${ws.peerId?.slice(0,8)} — terminate`);
      try { ws.terminate(); } catch {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 10000);

// ============================================================
// АВТООЧИСТКА ОСИРОТЕВШИХ КЛИЕНТОВ (раз в 15 сек)
// ============================================================
setInterval(() => {
  const activeIds = new Set([...wss.clients].map(ws => ws.peerId));
  for (const [peerId, c] of clients){
    if (!activeIds.has(peerId)){
      console.log(`[S] orphan client ${peerId.slice(0,8)} — cleanup`);
      const roomId = c.room;
      if (roomId){
        const room = rooms.get(roomId);
        if (room){
          for (const peer of room){
            if (peer.readyState === 1){
              try { peer.send(JSON.stringify({ type: 'peer-leave', peerId })); } catch {}
            }
          }
          room.delete(c.ws);
          if (roomHost.get(roomId) === peerId){
            const remaining = [...room];
            if (remaining.length > 0){
              const newHost = remaining[0].peerId;
              roomHost.set(roomId, newHost);
              for (const p of remaining){
                if (p.readyState === 1){
                  try { p.send(JSON.stringify({ type: 'host-change', host: newHost })); } catch {}
                }
              }
            } else {
              roomHost.delete(roomId);
            }
          }
          if (room.size === 0) rooms.delete(roomId);
        }
      }
      clients.delete(peerId);
    }
  }
}, 15000);

// ============================================================
// МЕТРИКИ (каждые 60 сек)
// ============================================================
setInterval(() => {
  console.log(`[M] rooms=${rooms.size} clients=${clients.size} bans=${bannedHashes.size} ipBans=${ipBanList.size}`);
}, 60000);

console.log(`[S] WebSocket relay + MaxAC listening on port ${port}`);
