/* ============================================================
   PIXEL ORCA — end-to-end тест сервера с ДВУМЯ реальными клиентами
   Проверяет: статику, регистрацию, вход, облачный сейв, лидерборд,
   кланы (создание/вступление/пожертвование), PvP-лобби с живым
   соперником, тики боя и рейд 3x3.

   Запуск:  node tools/smoke-server.mjs
   ============================================================ */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const PORT = 8791 + (process.pid % 50);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + name + (extra ? ' → ' + extra : '')); }
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---- минимальный WS-клиент поверх глобального WebSocket ---- */
class TestClient {
  constructor(tag) {
    this.tag = tag;
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.pending = new Map();
    this.handlers = new Map();
    this.log = [];
    this.id = 1;
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error(tag + ': ws error'));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      this.log.push(m.t);
      if (m.rid != null && this.pending.has(m.rid)) {
        const p = this.pending.get(m.rid);
        this.pending.delete(m.rid);
        if (m.t.includes(':err') || m.err) p.rej(new Error(m.msg || 'err'));
        else p.res(m);
      }
      const hs = this.handlers.get(m.t) || [];
      for (const h of hs) h(m);
    };
  }
  on(t, fn) { this.handlers.set(t, (this.handlers.get(t) || []).concat(fn)); }
  send(t, data = {}, timeout = 4000) {
    return new Promise((res, rej) => {
      const id = this.id++;
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ ...data, t, rid: id }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('таймаут ' + t)); }
      }, timeout);
    });
  }
  waitFor(t, ms = 6000) {
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(this.tag + ': не дождался ' + t)), ms);
      const h = (m) => { clearTimeout(timer); res(m); };
      this.handlers.set(t, [h]);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

/* ---- запуск сервера ---- */
const dbFile = path.join(ROOT, 'server', 'data', 'smoke-db.json');
fs.mkdirSync(path.dirname(dbFile), { recursive: true });
if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

const srv = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_FILE: dbFile, SEASON_MS: '86400000' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let srvLog = '';
srv.stdout.on('data', d => { srvLog += d; });
srv.stderr.on('data', d => { srvLog += d; process.stderr.write('[srv] ' + d); });

process.on('exit', () => { try { srv.kill(); } catch {} });
if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

async function main() {
  /* ждём подъёма */
  let up = false;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) { up = true; break; } } catch {}
    await sleep(100);
  }
  if (!up) throw new Error('сервер не поднялся:\n' + srvLog);
  ok('сервер поднялся и /api/health отвечает', true);

  /* 1. статика */
  const html = await fetch(BASE + '/').then(r => r.text());
  ok('index.html отдаётся сервером', html.includes('КОСАТКА-КЛИК'));
  const css = await fetch(BASE + '/css/pixel.css');
  ok('css/pixel.css доступен', css.ok);
  const mainjs = await fetch(BASE + '/js/main.js');
  ok('js/main.js доступен', mainjs.ok);
  const trav = await fetch(BASE + '/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd');
  const travTxt = await trav.text();
  ok('path traversal не проходит', !travTxt.includes('root:'), travTxt.slice(0, 40));
  const dbLeak = await fetch(BASE + '/server/data/smoke-db.json');
  ok('база сервера не отдаётся статикой', dbLeak.status === 403, String(dbLeak.status));
  const srvLeak = await fetch(BASE + '/server/server.js');
  ok('исходники сервера не отдаются', srvLeak.status === 403, String(srvLeak.status));

  /* 2. два клиента */
  const A = new TestClient('A');
  const B = new TestClient('B');
  await Promise.all([A.ready, B.ready]);
  ok('оба клиента подключились по WebSocket', true);

  /* 3. аккаунты */
  const uniq = Date.now().toString(36);
  const reg = await A.send('auth:register', { name: 'Косатка' + uniq, pass: 'pass1234' });
  ok('регистрация A', reg.t === 'auth:ok' && !!reg.token, reg.t);
  const regB = await B.send('auth:register', { name: 'Дельфин' + uniq, pass: 'pass1234' });
  ok('регистрация B', regB.t === 'auth:ok', regB.t);
  const dup = await B.send('auth:register', { name: 'Косатка' + uniq, pass: 'pass1234' }).catch(e => e);
  ok('дубль ника отклонён', dup instanceof Error, String(dup));
  const badPass = await B.send('auth:login', { name: 'Косатка' + uniq, pass: 'неверный' }).catch(e => e);
  ok('неверный пароль отклонён', badPass instanceof Error, String(badPass));
  const relogin = await B.send('auth:login', { name: 'Дельфин' + uniq, pass: 'pass1234' });
  ok('повторный вход B', relogin.t === 'auth:ok');

  /* 4. облачный сейв */
  const bigState = {
    coins: 12345, totalCoins: 999999, level: 12, skin: 'lava',
    stats: { clicks: 4200, pvpWins: 2, raidWins: 1, bestCps: 15 },
    eventTickets: 25, eventSeasonScore: 0, clan: {}
  };
  const saved = await A.send('save', { state: bigState });
  ok('сейв A принят', saved.t === 'save:ok');
  const loaded = await A.send('load');
  ok('сейв A загружен обратно', loaded.state.totalCoins === 999999 && loaded.state.skin === 'lava');

  /* 5. лидерборд */
  const lb = await A.send('lb', { sort: 'coins' });
  ok('лидерборд содержит A', lb.rows.some(r => r.name === 'Косатка' + uniq), JSON.stringify(lb.rows.slice(0, 2)));
  const lbEv = await A.send('lb', { sort: 'event' });
  ok('лидерборд по очкам сезона работает', Array.isArray(lbEv.rows));

  /* 6. кланы: A создаёт, B вступает по коду */
  const created = await A.send('clan:create', { name: 'Глубь' + uniq.slice(-4) });
  ok('клан создан', created.t === 'clan:create:ok' && !!created.clan.code, JSON.stringify(created.clan));
  const clanStateB = B.waitFor('clan:state', 5000);
  const joined = await B.send('clan:join', { code: created.clan.code });
  ok('B вступил в клан по коду', joined.t === 'clan:join:ok', JSON.stringify(joined));
  const st = await clanStateB;
  ok('B получил clan:state', st.clan && st.clan.name === created.clan.name, JSON.stringify(st.clan));
  const badJoin = await B.send('clan:join', { code: 'ZZZZZ' }).catch(e => e);
  ok('вход по неверному коду отклонён', badJoin instanceof Error, String(badJoin));
  const clans = await A.send('clans');
  ok('список кланов содержит наш', clans.rows.some(r => r.id === created.clan.id));
  const don = await A.send('clan:donate', { coins: 1000 });
  ok('пожертвование в казну', don.t === 'clan:donate:ok' && don.left === 11345, JSON.stringify(don.left));
  const tooMuch = await A.send('clan:donate', { coins: 999999 }).catch(e => e);
  ok('пожертвование больше баланса отклонено', tooMuch instanceof Error, String(tooMuch));

  /* 7. ивент: обмен билетов на очки сезона */
  const ev = await A.send('event:info');
  ok('event:info отдаётSeason', ev.t === 'event:info' && ev.left > 0);
  const ex = await A.send('event:exchange', { n: 10 });
  ok('10 билетов → 100 очков сезона', ex.t === 'event:exchange:ok' && ex.points === 100 && ex.tickets === 15, JSON.stringify(ex));
  const lbEv2 = await A.send('lb', { sort: 'event' });
  ok('очки сезона попали в лидерборд', lbEv2.rows[0].seasonScore === 100, JSON.stringify(lbEv2.rows[0]));

  /* 8. PvP: A создаёт открытое лобби, B вступает, оба готовы → бой */
  const lp = await A.send('pvp:create', { type: 'open' });
  ok('A создал PvP-лобби', lp.t === 'pvp:create:ok' && !!lp.lobby.id);
  const joinP = B.send('pvp:join', { id: lp.lobby.id });
  const joinedB = await joinP;
  ok('B вступил в лобби', joinedB.t === 'pvp:join:ok', joinedB.t);
  const startA = A.waitFor('pvp:start', 9000);
  const startB = B.waitFor('pvp:start', 9000);
  await A.send('pvp:ready', { ready: true });
  await B.send('pvp:ready', { ready: true });
  const [sA, sB] = await Promise.all([startA, startB]);
  ok('бой начался: A видит соперника B', sA.foe === 'Дельфин' + uniq, sA.foe);
  ok('бой начался: B видит соперника A', sB.foe === 'Косатка' + uniq, sB.foe);
  ok('передана длительность боя', sA.duration === 30, String(sA.duration));

  /* ждём тик, в котором счёт уже обновлён */
  const untilTick = (cl, pred, ms = 4000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const check = (m) => { if (pred(m)) { cl.handlers.set('pvp:tick', []); res(m); } };
    cl.handlers.set('pvp:tick', [check]);
    setTimeout(() => { cl.handlers.set('pvp:tick', []); rej(new Error(cl.tag + ': тик не дождался')); }, ms);
  });
  const tickA = untilTick(A, m => m.you === 15);
  for (let i = 0; i < 5; i++) await A.send('pvp:clicks', { n: 3 });
  const t1 = await tickA;
  ok('тик боя: счёт A = 15', t1.you === 15 && t1.foe === 0, JSON.stringify(t1));
  const tickB = untilTick(B, m => m.foe === 15 && m.you === 2);
  await B.send('pvp:clicks', { n: 2 });
  const t2 = await tickB;
  ok('тик боя: B видит счёт A', t2.foe === 15 && t2.you === 2, JSON.stringify(t2));
  ok('таймер идёт вниз', t1.time <= 30 && t1.time > 0, String(t1.time));

  /* 9. рейд 3x3: команда A+B против команды C */
  const C = new TestClient('C');
  await C.ready;
  await C.send('auth:register', { name: 'Кашалот' + uniq, pass: 'pass1234' });

  const teamEventA = A.waitFor('raid:team', 5000);
  const ta = await A.send('raid:create', { open: true });
  ok('A создал команду', ta.t === 'raid:create:ok');
  const jb = await B.send('raid:join', { id: ta.team.id });
  ok('B вступил в команду', jb.t === 'raid:join:ok' && jb.team.players === 2, JSON.stringify(jb.team));
  const tA = await teamEventA;
  ok('A увидел состав команды по raid:team', tA.team.players === 2, JSON.stringify(tA.team));
  const over = await B.send('raid:join', { id: ta.team.id }).catch(e => e);
  ok('повторный вход в команду отклонён', over instanceof Error, String(over));

  const tc = await C.send('raid:create', { open: true });
  ok('C создал вторую команду', tc.t === 'raid:create:ok');

  const rsA = A.waitFor('raid:start', 6000);
  const rsB = B.waitFor('raid:start', 6000);
  const rsC = C.waitFor('raid:start', 6000);
  const search = await A.send('raid:search');
  ok('матчмейкинг рейдов нашёл соперника', search.status === 'found', JSON.stringify(search));
  const [rA, rB, rC] = await Promise.all([rsA, rsB, rsC]);
  ok('рейд начался для всех 3 игроков', !!rA && !!rB && !!rC);
  ok('в рейде видно имя команды соперника', rA.foe.owner === 'Кашалот' + uniq, JSON.stringify(rA.foe));
  ok('состав своей команды передан', Array.isArray(rA.mates) && rA.mates.length === 2, JSON.stringify(rA.mates));

  const rtA = A.waitFor('raid:tick', 3000);
  const rc = await A.send('raid:clicks', { n: 4 });
  ok('рейд: клики засчитаны (4 клика × 3 очка = 12)', rc.you === 12, JSON.stringify(rc));
  const rt1 = await rtA;
  ok('рейд: тик синхронизирует счёт', rt1.you === 12, JSON.stringify(rt1));
  const rcB = await B.send('raid:clicks', { n: 2 });
  ok('очки команды суммируются от обоих игроков', rcB.you === 18, JSON.stringify(rcB));

  /* 10. защита от флуда и неизвестных команд */
  const unknown = await A.send('что:то', {}).catch(e => e);
  ok('неизвестная команда отклонена', unknown instanceof Error, String(unknown));
  const noAuth = await new TestClient('G').ready.then(() => {
    const g = new TestClient('G2');
    return g.ready.then(() => g.send('clan:create', { name: 'X' }).catch(e => e));
  });
  ok('без входа в кланы не пускает', noAuth instanceof Error, String(noAuth));

  /* 11. сохранение базы на диск */
  const health = await fetch(BASE + '/api/health').then(r => r.json());
  ok('health показывает игроков онлайн', health.players >= 3, JSON.stringify(health));
  ok('health показывает аккаунты', health.accounts >= 3, String(health.accounts));

  srv.kill('SIGINT');
  await sleep(600);
  const dbs = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : null;
  ok('база сохранена на диск', !!(dbs && Object.keys(dbs.accounts).length >= 3), dbFile);
  ok('в базе сохранился клан', !!(dbs && Object.keys(dbs.clans).length === 1), dbFile);
  ok('пароли не хранятся в открытом виде',
    dbs && Object.values(dbs.accounts).every(a => !('pass' in a && String(a.pass).length < 20)) &&
    dbs && Object.values(dbs.accounts).every(a => typeof a.pass === 'string' && a.pass.length === 64));

  A.close(); B.close(); C.close();
}

main().then(() => {
  console.log('');
  console.log(`  Пройдено: ${pass}, провалено: ${fail}`);
  process.exit(fail ? 1 : 0);
}).catch((e) => {
  console.log('  \x1b[31mФЕЙЛ:\x1b[0m ' + e.message);
  console.log('--- лог сервера ---');
  console.log(srvLog.split('\n').slice(-25).join('\n'));
  process.exit(1);
});
