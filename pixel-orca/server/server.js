/* ============================================================
   PIXEL ORCA — сервер (Node.js, ноль зависимостей)
   • статика клиента из ../ (index.html, css, js)
   • WebSocket /ws: аккаунты, облачные сейвы, лидерборд,
     кланы, PvP-лобби, рейды 3x3, сезонный ивент
   Запуск:  node server/server.js        (по умолчанию порт 8787)
            PORT=3000 node server/server.js
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = process.env.STATIC_DIR ? path.resolve(process.env.STATIC_DIR) : path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DEFAULT_DB_FILE = path.join(DATA_DIR, 'db.json');
const DB_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : DEFAULT_DB_FILE;
const DB_DIR = path.dirname(DB_FILE);
/* публичный адрес сервиса: платформы передают его по-разному.
   Внимание: без скобок '||' перебивает '?:' по приоритету, и при заданном
   PUBLIC_URL/RENDER_EXTERNAL_URL (без FLY_APP_NAME) печатался бы
   https://undefined.fly.dev. */
const FLY_URL = process.env.FLY_APP_NAME ? 'https://' + process.env.FLY_APP_NAME + '.fly.dev' : null;
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || FLY_URL || null;
const MAX_SAVE_BYTES = 512 * 1024;
const SEASON_MS = +(process.env.SEASON_MS || 30 * 86400000);
const PVP_MS = +(process.env.PVP_MS || 30000);
const RAID_MS = +(process.env.RAID_MS || 60000);
const TICK = +(process.env.TICK || 250);

/* ================= Хранилище ================= */
const db = {
  accounts: {},   /* id -> acc */
  tokens: {},     /* token -> id */
  clans: {},      /* id -> clan */
  byName: {},     /* lower(name) -> id */
  clanByCode: {}, /* code -> id */
  seq: 1,
  seasonEnd: Date.now() + SEASON_MS
};

function loadDb() {
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    Object.assign(db, raw);
    if (!db.seasonEnd || db.seasonEnd < Date.now()) db.seasonEnd = Date.now() + SEASON_MS;
    console.log(`[db] загружено: ${Object.keys(db.accounts).length} аккаунтов, ${Object.keys(db.clans).length} кланов`);
  } catch (e) {
    console.log('[db] новая база', e.code === 'ENOENT' ? '' : '(' + e.message + ')');
    saveDb(true);
  }
}
let saveTimer = null;
let dbBrokenWarned = false;
function saveDb(now) {
  if (now) return writeDb();
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; writeDb(); }, 4000);
}
function writeDb() {
  try {
    /* каталог берём от DATA_FILE: на PaaS база часто лежит на смонтированном
       диске (/data/db.json), и DATA_DIR тут ни при чём */
    fs.mkdirSync(DB_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);       /* атомарно: рестарт не оставит битую базу */
    dbBrokenWarned = false;
  } catch (e) {
    console.error('[db] ошибка записи:', e.message);
    if (!dbBrokenWarned) {
      dbBrokenWarned = true;
      console.error('[db] ВНИМАНИЕ: база не сохраняется — прогресс игроков будет потерян.');
      console.error('[db] Проверь, что каталог ' + DB_DIR + ' существует и доступен на запись (volume/disk).');
    }
  }
}

/* ================= Утилиты ================= */
const rnd = (n) => crypto.randomBytes(n).toString('hex');
function norm(s) { return String(s == null ? '' : s).trim().slice(0, 24); }
function hash(pass, salt) {
  return crypto.pbkdf2Sync(String(pass), salt, 60000, 32, 'sha256').toString('hex');
}
function num(v, def) { const n = Number(v); return Number.isFinite(n) ? n : (def || 0); }
function sanitizeState(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  let json;
  try { json = JSON.stringify(s); } catch (e) { return null; }
  if (json.length > MAX_SAVE_BYTES) return null;
  return s;
}
function accPub(a) {
  if (!a) return null;
  return { id: a.id, name: a.name, clan: a.clanId || null };
}
function clanBonus(cl) {
  if (!cl) return 0;
  return (cl.bonus || 0) + (cl.treasury >= 1e6 ? Math.min(0.25, Math.floor(cl.treasury / 1e6) * 0.01) : 0);
}
function clanState(cl, role) {
  if (!cl) return null;
  return {
    id: cl.id, name: cl.name, code: cl.code, role: role || null,
    members: cl.members.length, treasury: Math.floor(cl.treasury),
    bonus: clanBonus(cl), score: Math.floor(cl.score || 0)
  };
}

/* ================= Статика ================= */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2'
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  /* базовые заголовки: игра отдаётся и как статика, и как api */
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Access-Control-Allow-Origin': '*'
  };
  if (url === '/api/health') {
    const body = JSON.stringify({
      ok: true, uptime: Math.round(process.uptime()),
      players: clients.size, accounts: Object.keys(db.accounts).length,
      clans: Object.keys(db.clans).length,
      lobbies: lobbies.size, teams: teams.size,
      seasonLeft: Math.max(0, db.seasonEnd - Date.now())
    });
    res.writeHead(closing ? 503 : 200, Object.assign({}, base, { 'Content-Type': 'application/json; charset=utf-8' }));
    return res.end(body);
  }
  let p = decodeURIComponent(url);
  if (p === '/') p = '/index.html';
  /* наружу отдаём только клиентские файлы: /server/* и dot-файлы скрыты */
  const low = p.toLowerCase();
  if (low.startsWith('/server') || low.includes('/.') || low.endsWith('.db') ||
      low.endsWith('.json.tmp') || low.includes('node_modules')) {
    res.writeHead(403, Object.assign({}, base, { 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('403 — закрыто');
  }
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403, Object.assign({}, base, { 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('403');
  }
  fs.stat(file, (stErr, st) => {
    if (stErr || !st.isFile()) {
      res.writeHead(404, Object.assign({}, base, { 'Content-Type': 'text/plain; charset=utf-8' }));
      return res.end('404 — не найдено. Сайт лежит на GitHub Pages, бэкенд отдаёт только /ws и /api/health.');
    }
    /* ETag по размеру и времени: дешёвая ревалидация, мобильный трафик не тратится впустую */
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const ext = path.extname(file).toLowerCase();
    const headers = Object.assign({}, base, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      /* код и разметку всегда ревалидируем, картинки/шрифты можно кэшировать */
      'Cache-Control': (ext === '.html' || ext === '.js' || ext === '.webmanifest')
        ? 'no-cache' : 'public, max-age=604800',
      'Last-Modified': new Date(st.mtime).toUTCString(),
      'ETag': etag
    });
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': headers['Cache-Control'] });
      return res.end();
    }
    headers['Content-Length'] = st.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

/* ================= WebSocket (RFC 6455, вручную) ================= */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();

server.on('upgrade', (req, socket, head) => {
  if (closing) {           /* идёт деплой: новых игроков не берём */
    try { socket.destroy(); } catch (e) { /* ignore */ }
    return;
  }
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);

  const c = {
    socket, buf: Buffer.alloc(0), alive: true,
    acc: null, msgCount: 0, msgWindow: Date.now(),
    lobbyId: null, teamId: null,
    frag: null, fragOp: 0,          /* накопитель фрагментированных сообщений */
    overrun: false
  };
  clients.add(c);
  if (head && head.length) c.buf = Buffer.from(head);

  socket.on('data', (d) => { c.buf = c.buf.length ? Buffer.concat([c.buf, d]) : d; parse(c); });
  socket.on('error', () => drop(c));
  socket.on('close', () => drop(c));
  send(c, { t: 'hello', v: 1, seasonEnd: db.seasonEnd, players: clients.size });
});

function drop(c) {
  if (!clients.has(c)) return;
  clients.delete(c);
  leaveLobby(c, true);
  leaveTeam(c, true);
  if (c.acc) { c.acc.lastSeen = Date.now(); saveDb(); }
  try { c.socket.destroy(); } catch (e) { /* ignore */ }
}

function parse(c) {
  for (;;) {
    const b = c.buf;
    if (b.length < 2) return;
    const fin = (b[0] & 0x80) !== 0;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) {
      if (b.length < 10) return;
      const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
      len = hi * 4294967296 + lo; off = 10;
    }
    let mask = null;
    if (masked) { if (b.length < off + 4) return; mask = b.slice(off, off + 4); off += 4; }
    if (b.length < off + len) return;
    let pay = b.slice(off, off + len);
    if (mask) for (let i = 0; i < pay.length; i++) pay[i] ^= mask[i & 3];
    c.buf = b.slice(off + len);

    if (op === 0x8) { drop(c); return; }
    if (op === 0x9) { frame(c, pay, 0xA); continue; }
    if (op === 0xA) { c.alive = true; continue; }
    if (op === 0x0 || op === 0x1 || op === 0x2) {
      /* сообщение может прийти фрагментами (op 0x0 — продолжение):
         копим их и отдаём в handle только после финального фрагмента */
      if (op !== 0x0) c.fragOp = op;
      c.frag = c.frag && c.frag.length ? Buffer.concat([c.frag, pay]) : pay;
      if (c.frag.length > MAX_SAVE_BYTES) { c.frag = null; c.fragOp = 0; drop(c); return; }
      if (!fin) continue;
      const full = c.frag;
      const fullOp = c.fragOp;
      c.frag = null; c.fragOp = 0;
      if (fullOp !== 0x2) handle(c, full.toString('utf8'));   /* 0x2 — бинарный, не используем */
    }
  }
}

function frame(c, payload, op) {
  const len = payload.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2);
    head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4);
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[1] = 127;
    head.writeUInt32BE(Math.floor(len / 4294967296), 2);
    head.writeUInt32BE(len >>> 0, 6);
  }
  head[0] = 0x80 | (op == null ? 0x1 : op);
  try { c.socket.write(Buffer.concat([head, payload])); } catch (e) { drop(c); }
}
function send(c, obj) { if (c && clients.has(c)) frame(c, Buffer.from(JSON.stringify(obj))); }
function err(c, t, msg) { send(c, { t: t + ':err', rid: c.lastId, msg: msg }); }

function broadcastLobby(l) {
  const view = lobbyView(l);
  for (const p of l.players) if (p.c) send(p.c, { t: 'pvp:joined', lobby: view, id: p.c.lastId });
  pvpLobbyList();
}
function pvpLobbyList() {
  const rows = [...lobbies.values()].map(lobbyView);
  for (const c of clients) {
    const l = c.lobbyId ? lobbies.get(c.lobbyId) : null;
    send(c, { t: 'pvp:lobbies', rows, my: l ? lobbyView(l) : null });
  }
}
function raidTeamList() {
  const rows = [...teams.values()].map(teamView);
  for (const c of clients) {
    const tm = c.teamId ? teams.get(c.teamId) : null;
    send(c, { t: 'raid:teams', rows, my: tm ? teamView(tm) : null });
  }
}

/* ================= Протокол ================= */
function handle(c, raw) {
  if (raw.length > MAX_SAVE_BYTES) return;
  let m;
  try { m = JSON.parse(raw); } catch (e) { return; }
  if (!m || !m.t) return;
  /* rid — идентификатор запроса (данные могут содержать свой id) */
  c.lastId = m.rid != null ? m.rid : m.id;
  const t = m.t;

  /* антифлуд: 40 сообщений/сек; для кликов боя — 200 (это основной геймплей,
     кликер удерживает 20-30 кликов/с, а клиент шлёт их пачками) */
  const now = Date.now();
  const isClicks = t === 'pvp:clicks' || t === 'raid:clicks';
  const limit = isClicks ? 200 : 40;
  if (now - c.msgWindow > 1000) { c.msgWindow = now; c.msgCount = 0; }
  if (++c.msgCount > limit) {
    /* раньше сообщение просто молча терялось и клиент висел до таймаута —
       теперь отвечаем ошибкой, чтобы запрос не выглядел зависшим */
    if (c.msgCount === limit + 1) {
      console.warn('[flood]', t);
      err(c, t, 'слишком много запросов — подожди секунду');
    }
    return;
  }

  const t0 = process.hrtime.bigint();
  try { route(c, t, m); }
  catch (e) { console.error('[ws]', t, e); err(c, t, 'внутренняя ошибка сервера'); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (ms > 200) console.warn(`[slow] ${t} ${ms.toFixed(1)}ms`);
}

function route(c, t, m) {
  /* ---- авторизация ---- */
  if (t === 'auth:register') return authRegister(c, m);
  if (t === 'auth:login') return authLogin(c, m);
  if (t === 'auth:logout') return authLogout(c, m);
  if (t === 'resume') return authResume(c, m);

  const open = t === 'lb' || t === 'clans' || t === 'pvp:lobbies' || t === 'raid:teams' || t === 'event:info';

  if (t === 'save') return saveState(c, m);
  if (t === 'load') return loadState(c);
  if (t === 'lb') return leaderboard(c, m.sort);
  if (t === 'event:info') return eventInfo(c);
  if (t === 'event:exchange') return eventExchange(c, m);

  if (t.indexOf('clan') === 0) return clanRoute(c, t, m, open);
  if (t.indexOf('pvp') === 0) return pvpRoute(c, t, m, open);
  if (t.indexOf('raid') === 0) return raidRoute(c, t, m, open);

  err(c, t, 'неизвестная команда: ' + t);
}

/* ---------- аккаунты ---------- */
function authRegister(c, m) {
  const name = norm(m.name);
  const pass = String(m.pass || '');
  if (name.length < 2) return err(c, 'auth:register', 'ник минимум 2 символа');
  if (pass.length < 4) return err(c, 'auth:register', 'пароль минимум 4 символа');
  const key = name.toLowerCase();
  if (db.byName[key]) return err(c, 'auth:register', 'такой ник уже занят');
  const salt = rnd(8);
  const acc = {
    id: db.seq++, name, salt, pass: hash(pass, salt), token: rnd(24),
    created: Date.now(), lastSeen: Date.now(), state: null, clanId: null,
    seasonScore: 0, skin: 'normal'
  };
  db.accounts[acc.id] = acc;
  db.byName[key] = acc.id;
  db.tokens[acc.token] = acc.id;
  login(c, acc);
  console.log(`[auth] регистрация @${acc.name}`);
  saveDb();
}
function authLogin(c, m) {
  const name = norm(m.name);
  const id = db.byName[name.toLowerCase()];
  const acc = id && db.accounts[id];
  if (!acc || acc.pass !== hash(String(m.pass || ''), acc.salt)) {
    return err(c, 'auth:login', 'неверный ник или пароль');
  }
  acc.token = rnd(24);
  db.tokens[acc.token] = acc.id;
  login(c, acc);
  saveDb();
}
function authResume(c, m) {
  const id = db.tokens[String(m.token || '')];
  const acc = id && db.accounts[id];
  if (!acc) return err(c, 'resume', 'сессия истекла — войди заново');
  login(c, acc);
}
function login(c, acc) {
  c.acc = acc;
  acc.lastSeen = Date.now();
  send(c, { t: 'auth:ok', rid: c.lastId, token: acc.token, account: accPub(acc) });
  const cl = acc.clanId ? db.clans[acc.clanId] : null;
  send(c, { t: 'clan:state', clan: cl ? clanState(cl, roleIn(cl, acc.id)) : null });
  send(c, { t: 'event:info', rid: c.lastId, left: Math.max(0, db.seasonEnd - Date.now()), topScore: topSeasonScore() });
}
function authLogout(c, m) {
  const a = c.acc;
  if (a) { delete db.tokens[a.token]; a.token = null; }
  c.acc = null;
  send(c, { t: 'auth:ok', rid: c.lastId, account: null, loggedOut: true });
  saveDb();
}

/* ---------- сейвы ---------- */
function saveState(c, m) {
  if (!c.acc) return err(c, 'save', 'сначала войди в аккаунт');
  const s = sanitizeState(m.state);
  if (!s) return err(c, 'save', 'сейв отклонён (битый или слишком большой)');
  c.acc.state = s;
  c.acc.skin = norm(s.skin) || 'normal';
  c.acc.seasonScore = Math.max(0, num(s.eventSeasonScore, 0));
  c.acc.savedAt = Date.now();
  if (s.clan && s.clan.id && !c.acc.clanId) c.acc.clanId = +s.clan.id;
  saveDb();
  send(c, { t: 'save:ok', rid: c.lastId, savedAt: c.acc.savedAt });
}
function loadState(c) {
  if (!c.acc) return err(c, 'load', 'сначала войди в аккаунт');
  send(c, { t: 'load:ok', rid: c.lastId, state: c.acc.state, savedAt: c.acc.savedAt || 0 });
}

/* ---------- лидерборд ---------- */
function topSeasonScore() {
  let max = 0;
  for (const k in db.accounts) if (db.accounts[k].seasonScore > max) max = db.accounts[k].seasonScore;
  return max;
}
function eventInfo(c) {
  send(c, {
    t: 'event:info', rid: c.lastId,
    left: Math.max(0, db.seasonEnd - Date.now()),
    topScore: topSeasonScore(), players: Object.keys(db.accounts).length
  });
}
/* обмен билетов сезона на очки своего клана (1 билет = 10 очков) */
function eventExchange(c, m) {
  if (!c.acc) return err(c, 'event:exchange', 'сначала войди в аккаунт');
  const cl = c.acc.clanId && db.clans[c.acc.clanId];
  if (!cl) return err(c, 'event:exchange', 'обмен доступен только в клане');
  const s = c.acc.state;
  if (!s) return err(c, 'event:exchange', 'сначала загрузи прогресс');
  const want = Math.max(1, Math.floor(num(m.n, 1)));
  const have = Math.max(0, Math.floor(num(s.eventTickets, 0)));
  const n = Math.min(want, have);
  if (n < 1) return err(c, 'event:exchange', 'у тебя нет билетов');
  s.eventTickets = have - n;
  const points = n * 10;
  for (const mid of cl.members) {
    const a = db.accounts[mid];
    if (a) a.seasonScore = (a.seasonScore || 0) + points;
  }
  cl.score = (cl.score || 0) + points;
  pushClan(cl);
  saveDb();
  send(c, {
    t: 'event:exchange:ok', rid: c.lastId, tickets: s.eventTickets, points,
    seasonScore: c.acc.seasonScore, clan: clanState(cl, roleIn(cl, c.acc.id))
  });
}
function leaderboard(c, sort) {
  const rows = Object.values(db.accounts).map(a => {
    const s = a.state || {};
    return {
      id: a.id, name: a.name,
      coins: num(s.totalCoins, 0),
      clicks: num(s.stats && s.stats.clicks, 0),
      wins: num(s.stats && s.stats.pvpWins, 0) + num(s.stats && s.stats.raidWins, 0),
      level: num(s.level, 1),
      seasonScore: a.seasonScore || 0,
      clan: a.clanId && db.clans[a.clanId] ? db.clans[a.clanId].name : null
    };
  });
  const key = sort === 'event' ? 'seasonScore' : (sort === 'clicks' ? 'clicks' : (sort === 'wins' ? 'wins' : 'coins'));
  rows.sort((a, b) => b[key] - a[key] || b.coins - a.coins);
  send(c, { t: 'lb:ok', rid: c.lastId, rows: rows.slice(0, 50), sort: key });
}

/* ---------- кланы ---------- */
function roleIn(cl, id) {
  if (cl.owner === id) return 'owner';
  return cl.members.indexOf(id) >= 0 ? 'member' : null;
}
function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let i = 0; i < 50; i++) {
    let c = '';
    for (let k = 0; k < 5; k++) c += A[crypto.randomInt(A.length)];
    if (!db.clanByCode[c]) return c;
  }
  return 'C' + rnd(4).toUpperCase();
}
function clanRoute(c, t, m, open) {
  if (t === 'clans') {
    const rows = Object.values(db.clans).map(cl => ({
      id: cl.id, name: cl.name, members: cl.members.length,
      coins: Math.floor(cl.treasury), score: Math.floor(cl.score || 0),
      bonus: clanBonus(cl)
    })).sort((a, b) => b.score - a.score || b.coins - a.coins);
    return send(c, { t: 'clans:ok', rid: c.lastId, rows });
  }
  if (!c.acc) return err(c, t, 'сначала войди в аккаунт');

  if (t === 'clan:create') {
    const name = norm(m.name);
    if (name.length < 2) return err(c, t, 'название слишком короткое');
    for (const k in db.clans) {
      if (db.clans[k].name.toLowerCase() === name.toLowerCase()) return err(c, t, 'клан с таким именем уже есть');
    }
    if (c.acc.clanId) return err(c, t, 'ты уже в клане');
    const cl = {
      id: db.seq++, name, code: newCode(), owner: c.acc.id,
      members: [c.acc.id], treasury: 0, bonus: 0, score: 0, created: Date.now()
    };
    db.clans[cl.id] = cl;
    db.clanByCode[cl.code] = cl.id;
    c.acc.clanId = cl.id;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:create:ok', rid: c.lastId, clan: clanState(cl, 'owner') });
  }
  if (t === 'clan:join') {
    const code = String(m.code || '').toUpperCase().trim();
    const cid = db.clanByCode[code];
    const cl = cid && db.clans[cid];
    if (!cl) return err(c, t, 'клан с таким кодом не найден');
    if (c.acc.clanId) return err(c, t, 'ты уже в клане');
    if (cl.members.length >= 50) return err(c, t, 'клан переполнен');
    cl.members.push(c.acc.id);
    c.acc.clanId = cl.id;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:join:ok', rid: c.lastId, clan: clanState(cl, 'member') });
  }
  if (t === 'clan:leave') {
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (!cl) return err(c, t, 'ты не в клане');
    if (cl.owner === c.acc.id) return err(c, t, 'владелец не может выйти — удали клан или передай владение');
    cl.members = cl.members.filter(x => x !== c.acc.id);
    c.acc.clanId = null;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:leave:ok', rid: c.lastId, clan: null });
  }
  if (t === 'clan:delete') {
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (!cl) return err(c, t, 'ты не в клане');
    if (cl.owner !== c.acc.id) return err(c, t, 'удалить клан может только владелец');
    for (const mid of cl.members) { const a = db.accounts[mid]; if (a) a.clanId = null; }
    delete db.clans[cl.id];
    delete db.clanByCode[cl.code];
    saveDb();
    return send(c, { t: 'clan:delete:ok', rid: c.lastId });
  }
  if (t === 'clan:donate') {
    const cl = c.acc.clanId && db.clans[c.acc.clanId];
    if (!cl) return err(c, t, 'ты не в клане');
    const coins = Math.max(0, Math.floor(num(m.coins, 0)));
    const s = c.acc.state || {};
    if (num(s.coins, 0) < coins) return err(c, t, 'не хватает косаток');
    s.coins = num(s.coins, 0) - coins;
    c.acc.state = s;
    cl.treasury += coins;
    pushClan(cl);
    saveDb();
    return send(c, { t: 'clan:donate:ok', rid: c.lastId, coins, clan: clanState(cl, roleIn(cl, c.acc.id)), left: s.coins });
  }
  err(c, t, 'неизвестная команда клана');
}
function pushClan(cl) {
  for (const mid of cl.members) {
    const a = db.accounts[mid];
    if (!a) continue;
    for (const c of clients) if (c.acc === a) send(c, { t: 'clan:state', clan: clanState(cl, roleIn(cl, a.id)) });
  }
}

/* ---------- PvP ---------- */
const lobbies = new Map();

function lobbyView(l) {
  return {
    id: l.id, code: l.code, type: l.type, owner: l.ownerName,
    ready: l.players.length > 1 && l.players.every(p => p.ready),
    opponent: l.players[1] ? l.players[1].name : null,
    players: l.players.map(p => p.name)
  };
}
function lobbyOf(c) { return c.lobbyId ? lobbies.get(c.lobbyId) : null; }
function pvpRoute(c, t, m, open) {
  if (t === 'pvp:lobbies') return pvpLobbyList();
  if (!c.acc) return err(c, t, 'сначала войди в аккаунт');
  const l = lobbyOf(c);

  if (t === 'pvp:create') {
    if (l) return err(c, t, 'ты уже в лобби');
    const type = m.type === 'closed' ? 'closed' : 'open';
    const lb = {
      id: db.seq++, code: type === 'closed' ? newCode() : null, type,
      ownerId: c.acc.id, ownerName: c.acc.name, ownerSkin: c.acc.skin || 'normal',
      players: [{ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal', ready: false }],
      state: 'wait', scoreA: 0, scoreB: 0, clicksA: 0, clicksB: 0, endAt: 0
    };
    lobbies.set(lb.id, lb);
    c.lobbyId = lb.id;
    pvpLobbyList();
    return send(c, { t: 'pvp:create:ok', rid: c.lastId, lobby: lobbyView(lb) });
  }
  if (t === 'pvp:join' || t === 'pvp:joinCode') {
    if (l) return err(c, t, 'выйди из текущего лобби');
    let lb = null;
    if (t === 'pvp:join') lb = lobbies.get(+m.id);
    else {
      const code = String(m.code || '').toUpperCase().trim();
      lb = [...lobbies.values()].find(x => x.code === code);
    }
    if (!lb) return err(c, t, 'лобби не найдено');
    if (lb.state !== 'wait') return err(c, t, 'бой уже начался');
    if (lb.players.length >= 2) return err(c, t, 'в лобби нет мест');
    lb.players.push({ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal', ready: false });
    c.lobbyId = lb.id;
    broadcastLobby(lb);
    return send(c, { t: 'pvp:join:ok', rid: c.lastId, lobby: lobbyView(lb) });
  }
  if (t === 'pvp:ready') {
    if (!l) return err(c, t, 'ты не в лобби');
    const me = l.players.find(p => p.c === c);
    if (me) me.ready = !!m.ready;
    broadcastLobby(l);
    return send(c, { t: 'pvp:ready:ok', rid: c.lastId });
  }
  if (t === 'pvp:start') {
    if (!l) return err(c, t, 'ты не в лобби');
    if (l.ownerId !== c.acc.id) return err(c, t, 'начать бой может только владелец лобби');
    if (l.players.length < 2) return err(c, t, 'нужен соперник');
    if (l.state !== 'wait') return err(c, t, 'бой уже идёт');
    if (!l.players.every(p => p.ready)) return err(c, t, 'оба игрока должны быть готовы');
    startPvp(l);
    return send(c, { t: 'pvp:start:ok', rid: c.lastId });
  }
  if (t === 'pvp:clicks') {
    if (!l || l.state !== 'play') return send(c, { t: 'pvp:clicks:ok', rid: c.lastId, you: 0, foe: 0, ignored: true });
    const i = l.players.findIndex(p => p.c === c);
    if (i < 0) return;
    const n = Math.max(0, Math.min(50, Math.floor(num(m.n, 1))));
    if (i === 0) { l.scoreA += n; l.clicksA += n; } else { l.scoreB += n; l.clicksB += n; }
    clTickets(c, n);
    return send(c, {
      t: 'pvp:clicks:ok', rid: c.lastId,
      you: i === 0 ? l.scoreA : l.scoreB,
      foe: i === 0 ? l.scoreB : l.scoreA
    });
  }
  if (t === 'pvp:leave') return doLeaveLobby(c, l);
  err(c, t, 'неизвестная команда pvp');
}
function leaveLobby(c) {
  const l = lobbyOf(c);
  if (l) doLeaveLobby(c, l);
}
function startPvp(l) {
  l.state = 'play';
  l.scoreA = l.scoreB = l.clicksA = l.clicksB = 0;
  l.endAt = Date.now() + PVP_MS;
  const [a, b] = l.players;
  send(a.c, { t: 'pvp:start', duration: PVP_MS / 1000, foe: b.name, foeSkin: b.skin, mySkin: a.skin });
  send(b.c, { t: 'pvp:start', duration: PVP_MS / 1000, foe: a.name, foeSkin: a.skin, mySkin: b.skin });
  pvpLobbyList();
  console.log(`[pvp] старт #${l.id}: ${a.name} vs ${b.name}`);
}
function doLeaveLobby(c, l) {
  if (!l) return send(c, { t: 'pvp:leave:ok', rid: c.lastId });
  l.players = l.players.filter(p => p.c !== c);
  c.lobbyId = null;
  if (l.state === 'play') { endPvp(l, true); }
  else {
    if (!l.players.length) lobbies.delete(l.id);
    else if (l.ownerId !== l.players[0].id) { l.ownerId = l.players[0].id; l.ownerName = l.players[0].name; }
    for (const p of l.players) send(p.c, { t: 'pvp:left', lobby: lobbyView(l) });
  }
  pvpLobbyList();
  return send(c, { t: 'pvp:leave:ok', rid: c.lastId });
}
function endPvp(l, aborted) {
  const winA = l.scoreA >= l.scoreB;
  for (let i = 0; i < 2; i++) {
    const p = l.players[i];
    if (!p || !p.c) continue;
    const mine = i === 0 ? l.scoreA : l.scoreB;
    const theirs = i === 0 ? l.scoreB : l.scoreA;
    const win = (i === 0 ? winA : !winA);
    send(p.c, {
      t: 'pvp:end', you: mine, foe: theirs, win: aborted ? false : win,
      yourClicks: i === 0 ? l.clicksA : l.clicksB,
      reward: aborted ? 0 : Math.floor((win ? 2000 : 400) * 10)
    });
    p.c.lobbyId = null;
  }
  lobbies.delete(l.id);
  pvpLobbyList();
}
function leaveLobby(c, silent) {
  const l = lobbyOf(c);
  if (!l) return;
  doLeaveLobby(c, l);
}
function clTickets(c, n) {
  /* 1 билет за каждые 100 кликов в PvP — начисляем в облачном сейве */
  const a = c.acc;
  if (!a || !a.state) return;
  const s = a.state;
  s.pvpTicketAcc = (s.pvpTicketAcc || 0) + n;
  const DIV = 100;
  while (s.pvpTicketAcc >= DIV) {
    s.pvpTicketAcc -= DIV;
    s.eventTickets = (s.eventTickets || 0) + 1;
  }
}

/* ---------- Рейды 3x3 ---------- */
const teams = new Map();

function teamView(t) {
  return {
    id: t.id, owner: t.owner, open: t.open,
    players: t.players.length, names: t.players.map(p => p.name),
    searching: !!t.searching, score: Math.floor(t.score || 0)
  };
}
function teamMembers(t) { return t.players.map(p => p.name); }
function teamOf(c) { return c.teamId ? teams.get(c.teamId) : null; }
function raidRoute(c, t, m, open) {
  if (t === 'raid:teams') return raidTeamList();
  if (!c.acc) return err(c, t, 'сначала войди в аккаунт');
  const tm = teamOf(c);

  if (t === 'raid:create') {
    if (tm) return err(c, t, 'ты уже в команде');
    const team = {
      id: db.seq++, owner: c.acc.name, ownerId: c.acc.id, open: m.open !== false,
      players: [{ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal' }],
      score: 0, clicks: 0, searching: false, state: 'wait', foeId: 0, endAt: 0
    };
    teams.set(team.id, team);
    c.teamId = team.id;
    raidTeamList();
    return send(c, { t: 'raid:create:ok', rid: c.lastId, team: teamView(team) });
  }
  if (t === 'raid:join') {
    if (tm) return err(c, t, 'выйди из текущей команды');
    const team = teams.get(+m.id);
    if (!team) return err(c, t, 'команда не найдена');
    if (team.state !== 'wait') return err(c, t, 'рейд уже начался');
    if (team.players.length >= 3) return err(c, t, 'в команде уже 3 игрока');
    team.players.push({ c, id: c.acc.id, name: c.acc.name, skin: c.acc.skin || 'normal' });
    c.teamId = team.id;
    pushTeam(team);
    return send(c, { t: 'raid:join:ok', rid: c.lastId, team: teamView(team) });
  }
  if (t === 'raid:search') {
    if (!tm) return err(c, t, 'создай или вступи в команду');
    if (tm.state === 'play') return send(c, { t: 'raid:search:ok', rid: c.lastId, status: 'searching' });
    const foe = [...teams.values()].find(x => x.id !== tm.id && x.open && x.state === 'wait' && !x.foeId);
    if (!foe) {
      tm.searching = true;
      raidTeamList();
      return send(c, { t: 'raid:search:ok', rid: c.lastId, status: 'searching' });
    }
    startRaid(tm, foe);
    return send(c, { t: 'raid:search:ok', rid: c.lastId, status: 'found', foe: teamView(foe) });
  }
  if (t === 'raid:clicks') {
    if (!tm || tm.state !== 'play') return send(c, { t: 'raid:clicks:ok', rid: c.lastId, you: 0, foe: 0, ignored: true });
    const n = Math.max(0, Math.min(50, Math.floor(num(m.n, 1))));
    tm.clicks += n;
    tm.score += n * 3;
    const foe = tm.foeId ? teams.get(tm.foeId) : null;
    return send(c, {
      t: 'raid:clicks:ok', rid: c.lastId,
      you: Math.floor(tm.score), foe: foe ? Math.floor(foe.score) : 0
    });
  }
  if (t === 'raid:leave') return doLeaveTeam(c, tm);
  err(c, t, 'неизвестная команда рейда');
}
function pushTeam(t) {
  for (const p of t.players) if (p.c) send(p.c, { t: 'raid:team', team: teamView(t) });
}
function startRaid(a, b) {
  a.state = b.state = 'play';
  a.foeId = b.id; b.foeId = a.id;
  a.searching = b.searching = false;
  a.score = b.score = 0;
  a.endAt = b.endAt = Date.now() + RAID_MS;
  sendRaidStart(a, b);
  sendRaidStart(b, a);
  raidTeamList();
  console.log(`[raid] старт #${a.id} vs #${b.id}`);
}
function sendRaidStart(self, foe) {
  for (const p of self.players) {
    if (!p.c) continue;
    send(p.c, {
      t: 'raid:start', duration: RAID_MS / 1000,
      foe: { owner: foe.owner, skin: foe.players[0] ? foe.players[0].skin : 'pirate', players: foe.players.length },
      mates: teamMembers(self)
    });
  }
}
function doLeaveTeam(c, t) {
  if (!t) return;
  t.players = t.players.filter(p => p.c !== c);
  c.teamId = null;
  if (t.state === 'play') { endRaid(t, true); return; }
  if (!t.players.length) teams.delete(t.id);
  else { fixRaidOwner(t); pushTeam(t); }
  raidTeamList();
}
function endRaid(t, aborted) {
  const foe = t.foeId ? teams.get(t.foeId) : null;
  const myScore = Math.floor(t.score), foeScore = foe ? Math.floor(foe.score) : 0;
  for (const p of t.players) {
    if (!p.c) continue;
    send(p.c, { t: 'raid:end', you: myScore, foe: foeScore, win: aborted ? false : myScore >= foeScore, myClicks: t.clicks });
    p.c.teamId = null;
  }
  if (foe) {
    for (const p of foe.players) {
      if (!p.c) continue;
      send(p.c, { t: 'raid:end', you: foeScore, foe: myScore, win: aborted ? false : foeScore > myScore, myClicks: foe.clicks });
      p.c.teamId = null;
    }
    foe.foeId = 0; foe.state = 'wait'; foe.endAt = 0;
    pushTeam(foe);
  }
  t.foeId = 0; t.state = 'wait'; t.endAt = 0;
  if (!t.players.length) teams.delete(t.id);
  else { pushTeam(t); }
  raidTeamList();
}
function leaveTeam(c) { const t = teamOf(c); if (t) doLeaveTeam(c, t); }

/* ================= Таймеры ================= */
setInterval(() => {
  const now = Date.now();
  /* оба готовы → бой начинается сам (как в королевских баттлах) */
  for (const l of [...lobbies.values()]) {
    if (l.state === 'wait' && l.players.length === 2 && l.players.every(p => p.ready)) startPvp(l);
  }
  for (const l of [...lobbies.values()]) {
    if (l.state !== 'play') continue;
    const secs = Math.max(0, Math.min(PVP_MS / 1000, Math.ceil((l.endAt - now) / 1000)));
    for (let i = 0; i < 2; i++) {
      const p = l.players[i];
      if (!p || !p.c) continue;
      send(p.c, {
        t: 'pvp:tick',
        you: i === 0 ? l.scoreA : l.scoreB,
        foe: i === 0 ? l.scoreB : l.scoreA,
        time: secs
      });
    }
    if (now >= l.endAt) endPvp(l, false);
  }
  for (const t of [...teams.values()]) {
    if (t.state !== 'play') continue;
    const foe = t.foeId ? teams.get(t.foeId) : null;
    if (!foe) { endRaid(t, true); continue; }
    const secs = Math.max(0, Math.min(RAID_MS / 1000, Math.ceil((t.endAt - now) / 1000)));
    for (const p of t.players) {
      if (!p.c) continue;
      send(p.c, { t: 'raid:tick', you: Math.floor(t.score), foe: Math.floor(foe.score), time: secs });
    }
    if (now >= t.endAt) { endRaid(t, false); }
  }
  /* матчмейкинг: соединяем ищущие команды */
  const seeking = [...teams.values()].filter(t => t.searching && t.state === 'wait' && !t.foeId);
  for (let i = 0; i + 1 < seeking.length; i += 2) startRaid(seeking[i], seeking[i + 1]);
  if (now > db.seasonEnd) db.seasonEnd = now + SEASON_MS;
}, TICK).unref();

setInterval(() => {
  for (const c of [...clients]) {
    if (!c.alive) { drop(c); continue; }
    c.alive = false;
    try { frame(c, Buffer.alloc(0), 0x9); } catch (e) { drop(c); }
  }
}, 25000);

/* ================= Матчмейкинг живых игроков ================= */
/* Никаких ботов на сервере: ищем только настоящих соперников.
   Правило: как только двое ждущих игроков отметились «готов»,
   переносим соперника в лобби и сразу стартуем бой.            */
setInterval(() => {
  const waiting = [...lobbies.values()].filter(l =>
    l.state === 'wait' && l.players.length === 1 && l.players[0].ready && l.players[0].c);
  for (let i = 0; i + 1 < waiting.length; i += 2) {
    const a = waiting[i], b = waiting[i + 1];
    if (a.id === b.id) continue;
    /* переносим игрока из лобби a в лобби b */
    const mover = a.players[0];
    a.players = [];
    lobbies.delete(a.id);
    mover.c.lobbyId = b.id;
    b.players.push(mover);
    b.ownerId = b.players[0].id;
    b.ownerName = b.players[0].name;
    broadcastLobby(b);
    console.log(`[mm] ${b.players[0].name} ↔ ${b.players[1].name}`);
    startPvp(b);
  }
}, 2000).unref();

/* смена владельца лобби при выходе первого игрока (для рейдов) */
function fixRaidOwner(t) {
  if (t.players.length && t.ownerId !== t.players[0].id) {
    t.ownerId = t.players[0].id;
    t.owner = t.players[0].name;
  }
}

loadDb();
server.listen(PORT, HOST, () => {
  const ext = PUBLIC_URL || (HOST === '0.0.0.0' || HOST === '::' ? null : HOST);
  console.log('');
  console.log('  🐋  PIXEL ORCA — сервер запущен');
  console.log('      http://localhost:' + PORT);
  console.log('      ws://localhost:' + PORT + '/ws');
  if (ext) console.log('      публично: ' + ext.replace(/\/+$/, ''));
  console.log('      база: ' + DB_FILE + (DB_FILE === DEFAULT_DB_FILE ? '  ← ЭФЕМЕРНО' : ''));
  if ((DB_FILE === DEFAULT_DB_FILE && process.env.RENDER) ||
      (DB_FILE === DEFAULT_DB_FILE && /fly\.dev|up\.railway/.test(ext || ''))) {
    console.log('');
    console.log('  ⚠  Файловая база на этой платформе исчезнет при пересоздании сервиса.');
    console.log('     Задай DATA_FILE на постоянном диске (Render: disk, Fly: volume,');
    console.log('     Railway: volume) — иначе аккаунты и кланы пропадут.');
  }
  console.log('      Ctrl+C — остановить');
  console.log('');
});

/* ================= Мягкое завершение (PaaS деплоит через SIGTERM) =================
   Пока идёт деплой, новые соединения не принимаем, существующие рвём, базу пишем. */
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n[boot] ${signal}: останавливаемся, сохраняем базу…`);
  try { server.close(); } catch (e) { /* ignore */ }
  for (const c of [...clients]) { try { c.socket.destroy(); } catch (e) { /* ignore */ } }
  clients.clear();
  try { writeDb(); } catch (e) { console.error('[db] не сохранилась:', e.message); }
  console.log('[boot] готово, до свидания.');
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (e) => {
  console.error('[fatal] необработанная ошибка:', e && e.stack ? e.stack : e);
  try { writeDb(); } catch (x) { /* ignore */ }
  process.exit(1);
});
