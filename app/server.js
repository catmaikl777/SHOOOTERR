// ============================================================
// server.js — WebSocket relay + MaxAC
// ============================================================
const { WebSocketServer } = require('ws');
const fs = require('fs');

const port = process.env.PORT || 3000;
const wss = new WebSocketServer({ port, maxPayload: 4096 });

const AC = {
  MAX_PACKET_BYTES: 2000, MAX_MSG_PER_SEC: 60,
  MAX_ROOMS: 200, MAX_CLIENTS_PER_ROOM: 12, MAX_SEQ_GAP: 500,
  STRIKE_DECAY_MS: 60000, STRIKE_KICK: 8, STRIKE_SEVERE: 3,
  BAN_FILE: './bans.json', IP_BAN_MS: 60*60*1000, MAX_BANS_PER_IP: 3,
};

const rooms = new Map();
const roomHost = new Map();
const clients = new Map();
const bannedHashes = new Set();
const ipStrikes = new Map();
const ipBanList = new Map();

function safeParse(raw){
  if (!raw) return null;
  const str = raw.toString();
  if (str.length > AC.MAX_PACKET_BYTES) return null;
  try { return JSON.parse(str); } catch { return null; }
}
function validateVec(v){
  return Array.isArray(v) && v.length===2 &&
    Number.isFinite(v[0]) && Number.isFinite(v[1]) &&
    Math.abs(v[0])<=1.5 && Math.abs(v[1])<=1.5;
}
function validateInputPayload(d){
  if (!d || typeof d !== 'object') return false;
  if (!validateVec(d.m) || !validateVec(d.a)) return false;
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
      console.log(`[AC] loaded ${bannedHashes.size} bans`);
    }
  } catch(e){}
}
function saveBans(){
  try { fs.writeFileSync(AC.BAN_FILE, JSON.stringify([...bannedHashes])); } catch {}
}
loadBans();

function ensureClient(ws, ip){
  let c = clients.get(ws.peerId);
  if (!c){
    c = { peerId: ws.peerId, ws, ip, strikes:0, lastStrike:0,
          msgTimes:[], seq:-1, pubHash:null, verified:false,
          joinedAt:Date.now(), room:null };
    clients.set(ws.peerId, c);
  }
  return c;
}
function decay(c){
  const now = Date.now();
  if (c.strikes>0 && now-c.lastStrike>AC.STRIKE_DECAY_MS){ c.strikes--; c.lastStrike=now; }
}
function strike(c, reason, w=1){
  c.strikes += w; c.lastStrike = Date.now();
  console.warn(`[AC] strike ${c.peerId?.slice(0,8)} "${reason}" (+${w}) = ${c.strikes}`);
  if (c.strikes >= AC.STRIKE_KICK){ banClient(c, `strikes: ${reason}`); return false; }
  return true;
}
function banClient(c, reason){
  if (c.pubHash) { bannedHashes.add(c.pubHash); saveBans(); }
  console.warn(`[AC] BAN peer=${c.peerId?.slice(0,8)} reason="${reason}"`);
  try { c.ws.send(JSON.stringify({ type:'banned', reason })); } catch {}
  try { c.ws.close(1008, 'banned'); } catch {}
}
function checkRate(c){
  const now = Date.now();
  c.msgTimes.push(now);
  while (c.msgTimes.length && now-c.msgTimes[0]>1000) c.msgTimes.shift();
  if (c.msgTimes.length > AC.MAX_MSG_PER_SEC){
    return strike(c, `rate`, AC.STRIKE_SEVERE);
  }
  return true;
}
function cleanupClient(ws, reason){
  const c = clients.get(ws.peerId); if (!c) return;
  const roomId = c.room;
  if (!roomId){ clients.delete(c.peerId); return; }
  const room = rooms.get(roomId);
  if (!room){ clients.delete(c.peerId); return; }
  room.delete(ws);
  for (const peer of room){
    if (peer.readyState === 1){
      try { peer.send(JSON.stringify({ type:'peer-leave', peerId:c.peerId })); } catch {}
    }
  }
  if (roomHost.get(roomId) === c.peerId){
    const remaining = [...room];
    if (remaining.length){
      const newHost = remaining[0].peerId;
      roomHost.set(roomId, newHost);
      for (const p of remaining){
        if (p.readyState===1){
          try { p.send(JSON.stringify({ type:'host-change', host:newHost })); } catch {}
        }
      }
    } else roomHost.delete(roomId);
  }
  if (room.size===0) rooms.delete(roomId);
  clients.delete(c.peerId);
  console.log(`[S] - ${c.peerId.slice(0,8)} (${reason})`);
}

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  if (ws._socket && ws._socket.setNoDelay) ws._socket.setNoDelay(true);

  const banUntil = ipBanList.get(ip);
  if (banUntil && banUntil>Date.now()){
    try { ws.close(1008,'ip banned'); } catch {}
    return;
  }

  ws.peerId = 'peer_' + Math.random().toString(36).slice(2,10);
  ws.isAlive = true;
  const c = ensureClient(ws, ip);
  console.log(`[S] + ${c.peerId.slice(0,8)} from ${ip}`);

  ws.on('message', raw => {
    const msg = safeParse(raw);
    if (!msg){ strike(c,'bad packet',AC.STRIKE_SEVERE); return; }
    if (!checkRate(c)) return;
    decay(c);

    if (msg.type === 'join'){
      if (c.room){ strike(c,'double join'); return; }
      const roomId = String(msg.room||'').slice(0,32);
      if (!roomId){ strike(c,'no room'); return; }
      if (!rooms.has(roomId)) rooms.set(roomId, new Set());
      const room = rooms.get(roomId);
      if (room.size >= AC.MAX_CLIENTS_PER_ROOM){
        try { ws.send(JSON.stringify({type:'error',msg:'room full'})); } catch {}
        try { ws.close(1008,'room full'); } catch {}
        return;
      }
      c.room = roomId; ws.roomId = roomId; room.add(ws);
      if (!roomHost.has(roomId)) roomHost.set(roomId, c.peerId);
      const existingPeers = [...room].map(p=>p.peerId).filter(id=>id && id!==c.peerId);
      try {
        ws.send(JSON.stringify({
          type:'welcome', peerId:c.peerId,
          peers:existingPeers, host:roomHost.get(roomId),
        }));
      } catch {}
      for (const peer of room){
        if (peer!==ws && peer.readyState===1){
          try { peer.send(JSON.stringify({type:'peer-join', peerId:c.peerId})); } catch {}
        }
      }
      console.log(`[Room ${roomId}] + ${c.peerId.slice(0,8)} total=${room.size}`);
      return;
    }

    if (!c.room){ strike(c,'msg before join',AC.STRIKE_SEVERE); return; }

    if (msg.a==='id' && msg.d && msg.d.pubHash){
      const hash = String(msg.d.pubHash).slice(0,64);
      if (bannedHashes.has(hash)){ banClient(c,'persistent ban'); return; }
      c.pubHash = hash;
    }

    if (msg.a==='in' && msg.d){
      const d = msg.d;
      if (!validateInputPayload(d)){ strike(c,'bad input',AC.STRIKE_SEVERE); return; }
      if (d.seq<=c.seq){ strike(c,'replay',AC.STRIKE_SEVERE); return; }
      if (c.seq>=0 && d.seq-c.seq>AC.MAX_SEQ_GAP){ strike(c,'seq gap'); return; }
      c.seq = d.seq;
    }

    if (msg.a==='st'||msg.a==='bl'||msg.a==='hit'||msg.a==='pk'){
      const hostId = roomHost.get(c.room);
      if (hostId!==c.peerId){ strike(c,`${msg.a} from non-host`,AC.STRIKE_SEVERE); return; }
    }

    if (msg.a==='ban'){
      const hostId = roomHost.get(c.room);
      if (hostId!==c.peerId){ strike(c,'ban from non-host',AC.STRIKE_SEVERE); return; }
      const target = msg.d && msg.d.id;
      if (target && target!==c.peerId){
        const tc = clients.get(target);
        if (tc){
          if (msg.d.pubHash){ bannedHashes.add(msg.d.pubHash); saveBans(); }
          try { tc.ws.send(JSON.stringify({type:'banned',reason:msg.d.reason||'banned'})); } catch {}
          try { tc.ws.close(1008,'banned'); } catch {}
        }
      }
    }

    const room = rooms.get(c.room);
    if (!room) return;

    if (msg.to){
      const target = [...room].find(p=>p.peerId===msg.to);
      if (target && target.readyState===1){
        try { target.send(JSON.stringify({...msg.data, from:c.peerId})); } catch {}
      }
    } else if (msg.data){
      for (const peer of room){
        if (peer===ws) continue;
        if (peer.readyState!==1) continue;
        if (msg.data.a==='bl' && msg.data.d && msg.data.d.owner===peer.peerId) continue;
        try { peer.send(JSON.stringify({...msg.data, from:c.peerId})); } catch {}
      }
    }
  });

  ws.on('close', ()=>cleanupClient(ws,'close'));
  ws.on('error', err=>console.error(`[S] err:`, err.message));
  ws.on('pong', ()=>{ ws.isAlive = true; });
});

setInterval(()=>{
  wss.clients.forEach(ws=>{
    if (ws.isAlive===false){ try { ws.terminate(); } catch {} return; }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 10000);

setInterval(()=>{
  const activeIds = new Set([...wss.clients].map(ws=>ws.peerId));
  for (const [peerId, c] of clients){
    if (!activeIds.has(peerId)){
      const roomId = c.room;
      if (roomId){
        const room = rooms.get(roomId);
        if (room){
          for (const peer of room){
            if (peer.readyState===1){
              try { peer.send(JSON.stringify({type:'peer-leave', peerId})); } catch {}
            }
          }
          room.delete(c.ws);
          if (roomHost.get(roomId)===peerId){
            const remaining = [...room];
            if (remaining.length){
              const newHost = remaining[0].peerId;
              roomHost.set(roomId, newHost);
              for (const p of remaining){
                if (p.readyState===1){
                  try { p.send(JSON.stringify({type:'host-change', host:newHost})); } catch {}
                }
              }
            } else roomHost.delete(roomId);
          }
          if (room.size===0) rooms.delete(roomId);
        }
      }
      clients.delete(peerId);
    }
  }
}, 15000);

console.log(`[S] WebSocket relay + MaxAC listening on port ${port}`);
