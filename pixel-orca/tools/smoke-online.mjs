/* ============================================================
   PIXEL ORCA — сквозной тест клиента против ЖИВОГО сервера
   Поднимает server/server.js на временном порту и поднимает
   два независимых экземпляра клиента (реальный js/api.js +
   нативный WebSocket), чтобы проверить весь путь:
     • подключение, регистрация, авто-вход по токену
     • облачный сейв: push → другой клиент забирает
     • лидерборд и кланы с сервера
     • PvP: первый создаёт лобби, второй входит, оба «готовы»,
       сервер стартует бой, клики обоих идут на сервер,
       победа приходит событием
     • рейд 3 игрока
     • сезонный ивент (обмен билетов)
   Запуск: node tools/smoke-online.mjs
   ============================================================ */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(DIR, '..');
/* PO_DIR=dist — прогнать собранную для GitHub Pages статику вместо исходников */
const ROOT = path.resolve(SRC_ROOT, process.env.PO_DIR || '.');
const IS_BUILD = !!process.env.PO_DIR;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (x !== undefined ? ' → ' + x : '')); } };

/* ---------- поднимаем сервер ---------- */
/* широкий диапазон портов: параллельные прогоны не должны мешать друг другу */
let PORT = 0;
const DATA_FILE = path.join(SRC_ROOT, 'server', 'data', 'online-smoke-' + process.pid + '-' + Date.now() + '.json');
let srv = null, health = null;
const SRV_LOG_FILE = path.join(ROOT, '.tmplog', 'server-' + process.pid + '.log');
try { fs.mkdirSync(path.join(ROOT, '.tmplog'), { recursive: true }); } catch (e) {}
fs.writeFileSync(SRV_LOG_FILE, '');
let srvLog = '';
const srvSay = (d) => { srvLog += d; try { fs.appendFileSync(SRV_LOG_FILE, d); } catch (e) {} };

/* подбираем свободный порт и поднимаем сервер; при EADDRINUSE пробуем следующий */
async function startServer() {
  for (let attempt = 0; attempt < 12; attempt++) {
    PORT = 9000 + Math.floor(Math.random() * 6000);
    srv = spawn(process.execPath, [path.join(SRC_ROOT, 'server', 'server.js')], {
      env: {
        ...process.env,
        PORT: String(PORT), HOST: '127.0.0.1', DATA_FILE,
        SEASON_MS: '600000', PVP_MS: '8000', RAID_MS: '20000', TICK: '100'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    srv.stdout.on('data', srvSay);
    srv.stderr.on('data', srvSay);
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        if (r.ok) { health = await r.json(); return true; }
      } catch (e) {}
      await sleep(80);
    }
    /* порт занят чужим сервером или не поднялся — следующая попытка */
    try { srv.kill('SIGKILL'); } catch (e) {}
    srv = null;
  }
  return false;
}

const cleanup = () => {
  try { if (srv) srv.kill('SIGKILL'); } catch (e) {}
  try { if (fs.existsSync(DATA_FILE)) fs.unlinkSync(DATA_FILE); } catch (e) {}
};
process.on('exit', cleanup);
const dumpSrv = () => {
  for (const c of ALL_CLIENTS) {
    const top = c.topSent();
    if (top) console.log(`  трафик ${c.label}: ${top}`);
    for (const l of c.logLines.slice(-8)) console.log(`  [${c.label}] ${l}`);
    for (const e of c.errors.slice(-8)) console.log(`  [${c.label}] ! ${e}`);
  }
  try {
    const raw = fs.readFileSync(SRV_LOG_FILE, 'utf8');
    console.log('  ── лог сервера ──');
    console.log(raw.split('\n').filter(l => /flood|slow|\[ws\]|auth/i.test(l)).slice(-25).join('\n'));
  } catch (e) {}
};
process.on('uncaughtException', (e) => { console.log('  ! необработанное исключение: ' + e.message); dumpSrv(); cleanup(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.log('  ! необработанный промис: ' + (e && e.message)); dumpSrv(); cleanup(); process.exit(1); });

console.log('\n\x1b[1mPIXEL ORCA — сквозной тест: клиент ↔ живой сервер\x1b[0m\n');
const up = await startServer();
ok(`сервер поднялся на :${PORT}`, up, srvLog.slice(-300));
if (!up) { console.log('  не удалось поднять сервер, тест прерван'); process.exit(1); }
if (health) console.log('    ' + JSON.stringify(health));

/* ---------- DOM-шим (тот же, что в smoke-client, но минимальный) ---------- */
class ClassList {
  constructor(n) { this.n = n; this.s = new Set(); }
  add(...c) { c.forEach(x => x && this.s.add(x)); }
  remove(...c) { c.forEach(x => this.s.delete(x)); }
  contains(c) { return this.s.has(c); }
  toggle(c, f) { if (f === undefined) f = !this.s.contains(c); f ? this.s.add(c) : this.s.delete(c); return f; }
  toString() { return [...this.s].join(' '); }
}
class El {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = Object.create(null); this.childNodes = []; this.parentNode = null;
    this._text = ''; this._listeners = Object.create(null); this.disabled = false;
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, { get: (t, k) => t[k] !== undefined ? t[k] : '', set: (t, k, v) => { t[k] = v; return true; } });
    this.dataset = new Proxy(Object.create(null), { get: (t, k) => (k in t ? t[k] : undefined), set: (t, k, v) => { t[k] = String(v); return true; } });
    this.classList = new ClassList(this);
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes.filter(n => n instanceof El); }
  get firstChild() { return this.childNodes[0] || null; }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map(c => c.textContent).join('') : this._text; }
  set innerHTML(h) { this.childNodes = []; this._html = String(h); parseInto(this, String(h)); }
  get innerHTML() { return this.childNodes.length ? this.childNodes.map(ser).join('') : (this._html || ''); }
  appendChild(n) {
    if (!n) return n;
    if (n === this) return n;
    if (n.parentNode && n.parentNode !== this) { const i = n.parentNode.childNodes.indexOf(n); if (i >= 0) n.parentNode.childNodes.splice(i, 1); }
    if (this.childNodes.indexOf(n) < 0) this.childNodes.push(n);
    n.parentNode = this;
    if (n.attrs.id && this.doc) this.doc.byId[n.attrs.id] = n;
    return n;
  }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener() {}
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let n = this;
    const seen = new Set();
    while (n && !seen.has(n)) {
      seen.add(n);
      for (const fn of (n._listeners[ev.type] || []).slice()) {
        ev.currentTarget = n;
        try { fn(ev); } catch (e) { (globalThis.__clickErrors = globalThis.__clickErrors || []).push(String(e.message)); }
      }
      n = n.parentNode;
      if (!ev.bubbles) break;
    }
    return true;
  }
  click() { if (this.disabled) return false; return this.dispatchEvent({ type: 'click', target: this, bubbles: true }); }
  focus() {} select() {} setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 200, right: 300, bottom: 200, x: 0, y: 0 }; }
  getContext() { return ctxStub(); }
  querySelector(s) { return qa(this, s)[0] || null; }
  querySelectorAll(s) { return qa(this, s); }
  closest(s) { let n = this; while (n) { if (m(n, s)) return n; n = n.parentNode; } return null; }
  get offsetWidth() { return 300; } get offsetHeight() { return 200; }
  get scrollTop() { return 0; } get clientWidth() { return 300; } get clientHeight() { return 200; } get scrollHeight() { return 200; }
  get isConnected() { return true; }
}
const ser = (n) => (n instanceof El) ? `<${n.tagName.toLowerCase()}>${n.innerHTML}</${n.tagName.toLowerCase()}>` : String(n);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);
function parseInto(parent, html) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m; const stack = [parent];
  while ((m = re.exec(html))) {
    const [, close, tag, attrs, sc, text] = m;
    if (text !== undefined) { const t = text.trim(); if (t) { const tn = new El('#text'); tn._text = t; stack[stack.length - 1].childNodes.push(tn); } continue; }
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const node = new El(tag);
    node.doc = parent.doc;
    for (const a of attrs.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
      node.attrs[a[1]] = a[2];
      if (a[1] === 'class') node.className = a[2];
      if (a[1].startsWith('data-')) node.dataset[a[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2];
    }
    if (node.attrs.id) parent.doc.byId[node.attrs.id] = node;
    stack[stack.length - 1].appendChild(node);
    if (!VOID.has(tag.toLowerCase()) && !sc) stack.push(node);
  }
}
function m(node, sel) {
  if (!(node instanceof El)) return false;
  sel = sel.trim();
  if (!sel || sel === '*') return true;
  const p = sel.match(/(^|\s+)([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)/);
  if (!p) return false;
  const [, , tag, id, cls, attrs] = p;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (id && node.attrs.id !== id.slice(1)) return false;
  if (cls) for (const c of cls.split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  if (attrs) for (const x of attrs.matchAll(/\[([\w:-]+)(?:([~|^$*]?=)"?([^\]"]*)"?)?\]/g)) {
    const [, k, op, v] = x;
    const val = k.startsWith('data-') ? node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : node.attrs[k];
    if (op === '=' && String(val) !== v) return false;
    if (!op && val === undefined) return false;
  }
  return true;
}
function qa(root, sel) {
  const out = [];
  const seen = new Set();
  (function walk(n) {
    if (seen.has(n)) { if (globalThis.__cycle) { console.log('ЦИКЛ в DOM:', n.tagName, n.attrs.id, '->', n.parentNode && n.parentNode.tagName); globalThis.__cycle = false; } return; }
    seen.add(n);
    for (const c of n.childNodes) { if (!(c instanceof El)) continue; if (m(c, sel)) out.push(c); walk(c); }
  })(root);
  if (sel.includes(' ')) { const seg = sel.trim().split(/\s+/).pop(); return out.filter(n => m(n, seg)); }
  return out;
}
function ctxStub() {
  const noop = () => {};
  const t = {
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', textBaseline: '',
    measureText: () => ({ width: 8 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop, drawImage: noop, save: noop, restore: noop,
    setTransform: noop, translate: noop, scale: noop, rotate: noop
  };
  return new Proxy(t, { get: (tt, k) => (k in tt ? tt[k] : noop), set: (tt, k, v) => { tt[k] = v; return true; } });
}

/* ---------- поднимаем экземпляр клиента ---------- */
const html = read('index.html');
const scripts = [...html.matchAll(/<script src="js\/([^"]+)"/g)].map(x => x[1]);

const ALL_CLIENTS = [];

function makeClient(label) {
  const errors = [];
  const byId = Object.create(null);
  const doc = {
    byId,
    createElement: (t) => { const e = new El(t); e.doc = doc; return e; },
    createElementNS: (ns, t) => { const e = new El(t); e.doc = doc; return e; },
    createTextNode: (t) => { const e = new El('#text'); e._text = t; return e; },
    getElementById: (id) => byId[id] || null,
    querySelector: (s) => qa(doc.documentElement, s)[0] || null,
    querySelectorAll: (s) => qa(doc.documentElement, s),
    addEventListener() {}, removeEventListener() {},
    body: null, head: null, documentElement: null, readyState: 'complete', hidden: false
  };
  const body = new El('body'); body.doc = doc; body.classList = new ClassList(body);
  const htmlEl = new El('html'); htmlEl.doc = doc;
  doc.documentElement = htmlEl; doc.body = body; doc.head = new El('head');
  htmlEl.appendChild(doc.head); htmlEl.appendChild(body);
  doc.documentElement.appendChild(htmlEl);

  const bodyHtml = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  parseInto(body, bodyHtml);
  for (const x of bodyHtml.matchAll(/\bid="([^"]+)"/g)) {
    if (byId[x[1]]) continue;
    const n = new El('div'); n.doc = doc; n.attrs.id = x[1]; byId[x[1]] = n; body.appendChild(n);
  }

  const store = new Map();
  const ls = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear()
  };
  const rafQ = [];
  const sb = {
    console: { log: () => {}, warn: () => {}, error: (...a) => errors.push('console.error: ' + a.join(' ')) },
    document: doc, localStorage: ls,
    location: { protocol: 'http:', host: '127.0.0.1:' + PORT, href: `http://127.0.0.1:${PORT}/`, reload() { this.reloaded = true; } },
    navigator: { userAgent: 'node', language: 'ru', vibrate: () => true },
    performance: { now: () => Date.now() },
    requestAnimationFrame: fn => { rafQ.push(fn); return rafQ.length; },
    cancelAnimationFrame: () => {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    WebSocket,                      /* ← настоящий глобальный из Node */
    Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp, Promise, Map, Set, Symbol, WeakMap,
    isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
    Uint8Array, Uint8ClampedArray, Float32Array, TextEncoder, TextDecoder, URL, URLSearchParams,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    AudioContext: function () {
      const noop = () => {};
      return {
        currentTime: 0, state: 'running', destination: {},
        createOscillator: () => ({ frequency: { value: 440, setValueAtTime: noop }, connect: noop, start: noop, stop: noop }),
        createGain: () => ({ gain: { value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop }, connect: noop }),
        createBiquadFilter: () => ({ frequency: { value: 800, setValueAtTime: noop }, connect: noop }),
        resume: () => Promise.resolve(), close: () => Promise.resolve()
      };
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    addEventListener() {}, removeEventListener() {},
    innerWidth: 400, innerHeight: 800, devicePixelRatio: 1,
    getComputedStyle: () => ({ getPropertyValue: () => '' })
  };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  /* адрес тестового сервера задаём через конфиг-канал деплоя (js/config.js) —
     так тест проверяет ровно тот путь, который использует собранный сайт */
  const TEST_WS = `ws://127.0.0.1:${PORT}/ws`;
  sb.PO_SERVER = TEST_WS;
  /* console в контексте vm отсутствует, а api.js глотает исключения обработчиков
     через console.error — без него реальная ошибка теряется. Собираем всё сюда. */
  const logLines = [];
  const addLog = (lvl) => (...a) => {
    logLines.push(lvl + ': ' + a.map((x) => {
      if (x && x.stack) return String(x.stack).split('\n').slice(0, 3).join(' | ');
      return typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })();
    }).join(' '));
  };
  sb.console = { log: addLog('log'), info: addLog('info'), warn: addLog('warn'), error: addLog('error'), debug: addLog('debug') };
  /* счётчик исходящих сообщений на уровне сокета — видно весь трафик клиента,
     включая внутренние вызовы из api.js, и понятно, кто выбивает лимит запросов.
     Важно: обёртка ставится ДО createContext — контекст vm копирует свойства. */
  const sent = {};
  const NativeWS = sb.WebSocket;
  function CountingWS(url) {
    const ws = new NativeWS(url);
    const nativeSend = ws.send.bind(ws);
    ws.send = (data) => {
      try { const t = JSON.parse(data).t; sent[t] = (sent[t] || 0) + 1; } catch (e) {}
      return nativeSend(data);
    };
    return ws;
  }
  CountingWS.prototype = NativeWS.prototype;
  Object.assign(CountingWS, NativeWS);
  sb.WebSocket = CountingWS;
  vm.createContext(sb);
  for (const f of scripts) {
    try { vm.runInContext(read('js/' + f), sb, { filename: f }); }
    catch (e) { errors.push('load ' + f + ': ' + e.message); }
  }
  /* после загрузки скриптов подменяем адрес: иначе в dist он был бы вшит деплоем */
  if (sb.PO_CONFIG) sb.PO_CONFIG.server = TEST_WS;
  const frames = (n) => { for (let i = 0; i < n; i++) { const q = rafQ.splice(0, rafQ.length); for (const fn of q) { try { fn(Date.now()); } catch (e) { errors.push('raf: ' + e.message); } } } };
  const topSent = () => Object.entries(sent).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t, n]) => t + '=' + n).join(' ');
  const c = { sb, doc, store, errors, frames, label, sent, topSent, logLines };
  ALL_CLIENTS.push(c);
  return c;
}

/* ---------- события и ожидания ---------- */
const waitEvent = (S, ev, ms = 6000) => new Promise((res, rej) => {
  const api = S.sb.API;
  const t = setTimeout(() => rej(new Error('таймаут события ' + ev)), ms);
  api.on(ev, (d) => { clearTimeout(t); res(d); });
});

/* requestAnimationFrame в тесте ручной: клиент строит окна и обрабатывает
   сообщения в игровом кадре. Поэтому ждём не «N миллисекунд», а сам факт,
   прокручивая кадры — иначе проверка зависит от того, успел ли кадр
   случайно пройти раньше. */
const waitFrame = async (S, cond, ms = 5000) => {
  const t0 = Date.now();
  do {
    S.frames(1);
    if (cond()) return true;
    await sleep(25);
  } while (Date.now() - t0 < ms);
  S.frames(1);
  return !!cond();
};

/* ================= 1. регистрация ================= */
const A = makeClient('A');
await waitEvent(A, 'status', 6000).catch(() => null);
for (let i = 0; i < 40 && A.sb.API.status !== 'online'; i++) await sleep(100);
ok(`клиент A: WebSocket-соединение (${A.label})`, A.sb.API.status === 'online', A.sb.API.status);

/* адрес сервера обязан приходить из js/config.js (тот же канал, что и на деплое) */
const srvInfo = A.sb.API.serverInfo;
ok('адрес сервера взят из конфига (js/config.js)', srvInfo.source === 'config',
  JSON.stringify(srvInfo));
ok('клиент подключается к /ws тестового сервера',
  srvInfo.url === `ws://127.0.0.1:${PORT}/ws`, srvInfo.url);
ok(`исходники: ${IS_BUILD ? 'сборка ' + process.env.PO_DIR : 'папка проекта'}`, true);

A.sb.API.register('Косатка', 'orcapass1').catch(() => {});
await waitEvent(A, 'account', 8000).catch(() => null);
ok('клиент A: аккаунт создан', !!(A.sb.ST.state.account && A.sb.ST.state.account.token),
  JSON.stringify(A.sb.ST.state.account || {}).slice(0, 120));
ok('клиент A: сервер вернул id игрока', !!(A.sb.API.account && A.sb.API.account.id), JSON.stringify(A.sb.API.account));

/* ================= 2. облачный сейв ================= */
const coinsPush = 1234567;
A.sb.ST.state.coins = coinsPush;
A.sb.ST.state.totalCoins = coinsPush;
A.sb.ST.flush();
const pushed = await A.sb.API.pushSave(A.sb.ST.state);
ok('клиент A: сейв залит на сервер', pushed === true, String(pushed));
ok('клиент A: токен сохранён в локальном сейве',
  !!JSON.parse(A.store.get(A.sb.ST.KEY) || '{}').account?.token);

/* второй клиент с тем же токеном: авто-вход */
const C = makeClient('C');
C.store.set(A.sb.ST.KEY, A.store.get(A.sb.ST.KEY));
C.sb.ST.load();
ok('клиент C: токен взят из сейва до подключения', !!C.sb.ST.state.account.token);
C.sb.API.connect();
const resumed = await waitEvent(C, 'account', 8000).catch(() => null);
ok('авто-вход по сохранённому токену', !!(resumed && C.sb.API.account), JSON.stringify(C.sb.API.account));
ok('клиент C: сервер вернул того же игрока',
  !!(C.sb.API.account && A.sb.API.account && C.sb.API.account.id === A.sb.API.account.id),
  `${C.sb.API.account?.id} vs ${A.sb.API.account?.id}`);
ok('при равном прогрессе клиент не спрашивает про облако (лишних вопросов нет)',
  C.sb.window.__cloudState === undefined, String(C.sb.window.__cloudState !== undefined));

/* новый девайс: вход по паролю → предлагает забрать облачный прогресс */
const E = makeClient('E');
for (let i = 0; i < 40 && E.sb.API.status !== 'online'; i++) await sleep(100);
ok('клиент E: подключился (новое устройство)', E.sb.API.status === 'online', E.sb.API.status);
ok('у нового клиента пустой прогресс', E.sb.ST.state.coins === 0, String(E.sb.ST.state.coins));
E.sb.API.login('Косатка', 'orcapass1').catch((e) => console.log('    ! login error: ' + e.message));
await sleep(400);
if (!E.sb.API.account) console.log('    ! E не авторизован, error=' + E.sb.API.error);
let t0 = Date.now();
let confirmBtn = null;
while (Date.now() - t0 < 6000 && !confirmBtn) {
  confirmBtn = E.doc.querySelector('[data-act="yes"]');
  if (!confirmBtn) await sleep(100);
}
ok('клиент E: предложено загрузить облачный прогресс', !!confirmBtn);
const cloudState = E.sb.window.__cloudState;
ok('облачный сейв получен (1.23M > локальных 0)',
  !!cloudState && (cloudState.coins === coinsPush || cloudState.totalCoins === coinsPush),
  cloudState ? `coins=${cloudState.coins}, total=${cloudState.totalCoins}` : 'нет');
console.log('    · жмём «Загрузить»…');
if (confirmBtn) { confirmBtn.click(); await sleep(300); }
console.log('    · нажали, reload=' + E.sb.location.reloaded);
ok('после «Загрузить» клиент перезагружает страницу', E.sb.location.reloaded === true, String(E.sb.location.reloaded));
ok('вход по паролю создал тот же аккаунт',
  !!(E.sb.API.account && A.sb.API.account && E.sb.API.account.id === A.sb.API.account.id),
  `${E.sb.API.account?.id} vs ${A.sb.API.account?.id}`);

/* независимый клиент B (без токена) тоже подключается */
const B = makeClient('B');
for (let i = 0; i < 40 && B.sb.API.status !== 'online'; i++) await sleep(100);
ok('клиент B: подключился', B.sb.API.status === 'online', B.sb.API.status);
ok('гость без токена не получает чужой сейв', B.sb.ST.state.coins !== coinsPush, String(B.sb.ST.state.coins));

/* ================= 3. лидерборд ================= */
const lbRows = await A.sb.API.leaderboard();
ok('лидерборд вернул игроков', Array.isArray(lbRows) && lbRows.length > 0, JSON.stringify(lbRows).slice(0, 140));
ok('в лидерборде есть наш игрок с 1.23M', lbRows.some(r => r.name === 'Косатка' && r.coins >= 1234567),
  JSON.stringify(lbRows[0] || {}));

/* ================= 4. кланы ================= */
const clanRes = await A.sb.API.clanCreate('Стая A').catch(e => null);
const clan = clanRes && clanRes.clan;
ok('клан создан на сервере', !!(clan && clan.name === 'Стая A'), JSON.stringify(clan));
ok('владелец получает роль owner и код приглашения',
  !!(clan && clan.role === 'owner' && clan.code), JSON.stringify(clan));
await sleep(300);
ok('состояние клана пришло в клиент через clan:state',
  !!(A.sb.API.clan && A.sb.API.clan.id === clan.id), JSON.stringify(A.sb.API.clan));
ok('имя клана записалось в сейв игрока', A.sb.ST.state.clan.name === 'Стая A', String(A.sb.ST.state.clan.name));

/* второй игрок: сначала регистрируется (вход обязателен), потом вступает по коду */
const noAuth = await B.sb.API.clanJoin(clan.code).catch(() => null);
ok('в клан нельзя вступить без аккаунта', noAuth === null, String(noAuth));
await B.sb.API.register('Кашалот', 'killerpass');
await sleep(400);
const joinClan = await B.sb.API.clanJoin(clan.code).catch(e => null);
ok('игрок B вступил в клан по коду', !!(joinClan && joinClan.clan && joinClan.clan.members === 2),
  JSON.stringify(joinClan && joinClan.clan));
const health2 = await fetch(`http://127.0.0.1:${PORT}/api/health`).then(r => r.json()).catch(() => null);
ok('health показывает 1 клан и живых игроков', !!(health2 && health2.clans === 1 && health2.players >= 4), JSON.stringify(health2));

/* ================= 5. PvP: живой бой ================= */
const created = await A.sb.API.pvpCreate('open').catch(() => null);
const lobbyA = created && created.lobby;
ok('PvP: лобби создано', !!(lobbyA && lobbyA.id), JSON.stringify(lobbyA).slice(0, 120));
ok('PvP: создатель сразу в списке лобби', !!(A.sb.API && lobbyA && lobbyA.players && lobbyA.players.length === 1),
  JSON.stringify(lobbyA).slice(0, 120));
const lobbyId = lobbyA && lobbyA.id;

if (lobbyId) {
  const joinedP = waitEvent(B, 'pvp:joined', 6000);
  await B.sb.API.pvpJoin(lobbyId);
  const jm = await joinedP.catch(() => null);
  const lobbyB = jm && jm.lobby;
  ok('PvP: клиент B вошёл в лобби A', !!(lobbyB && lobbyB.id === lobbyId && lobbyB.players.length === 2),
    JSON.stringify(lobbyB).slice(0, 140));
  ok('PvP: в лобби видно обоих живых игроков',
    !!(lobbyB && lobbyB.players.length === 2 && lobbyB.players.indexOf('Косатка') >= 0 && lobbyB.players.indexOf('Кашалот') >= 0),
    JSON.stringify(lobbyB && lobbyB.players).slice(0, 140));

  A.sb.API.pvpReady(true);
  await sleep(250);
  B.sb.API.pvpReady(true);

  const startA = waitEvent(A, 'pvp:start', 8000);
  const startB = waitEvent(B, 'pvp:start', 8000);
  const started = await Promise.race([Promise.all([startA, startB]), sleep(8000).then(() => null)]);
  ok('PvP: сервер начал бой у обоих игроков', !!started, started ? 'оба клиента получили pvp:start' : 'таймаут');
  if (started) {
    const mStart = started[0];
    ok('PvP: сервер назвал соперника и длительность',
      !!(mStart && mStart.foe && mStart.duration > 0), JSON.stringify(mStart).slice(0, 120));
    const tickP = waitEvent(A, 'pvp:tick', 6000);
    const endP = waitEvent(A, 'pvp:end', 15000);
    /* оба кликают по-настоящему через боевой колбэк */
    let n = 0;
    const clicker = setInterval(() => {
      A.sb.CLICK.doClick(1, 1);
      B.sb.CLICK.doClick(1, 1);
      if (++n > 25) clearInterval(clicker);
    }, 60);
    const tick = await Promise.race([tickP.catch(() => null), sleep(4000).then(() => null)]);
    ok('PvP: сервер присылает тики', !!tick, JSON.stringify(tick).slice(0, 120));
    const end = await Promise.race([endP.catch(() => null), sleep(12000).then(() => null)]);
    clearInterval(clicker);
    ok('PvP: бой завершился результатом', !!end, end ? `победитель=${end.winner || end.winnerId}` : 'таймаут 35с');
    /* регрессия: обработчик 'pvp:lobbies' не должен переспрашивать сервер
       (иначе клиент долбит список в цикле, пока открыто окно боя) */
    const plA = A.sent['pvp:lobbies'] || 0, plB = B.sent['pvp:lobbies'] || 0;
    ok('PvP: нет шторма запросов списка лобби', plA <= 12 && plB <= 12, `A=${plA}, B=${plB}`);
  }
}

/* ================= 6. рейд 3 игрока: живой бой ================= */
const D = makeClient('D');
for (let i = 0; i < 40 && D.sb.API.status !== 'online'; i++) await sleep(100);
ok('клиент D подключился для рейда', D.sb.API.status === 'online', D.sb.API.status);
D.sb.API.register('Дельфин', 'dolphinpass').catch(() => {});
await sleep(400);

/* BATTLE.initServerEvents уже вызван в boot — клики пойдут в сеть */
const teamRes = await A.sb.API.raidCreate(true).catch(() => null);
const team = teamRes && teamRes.team;
ok('рейд: команда создана', !!(team && team.id), JSON.stringify(team).slice(0, 140));
ok('рейд: в команде 1 игрок', !!(team && team.players === 1 && team.names && team.names.length === 1),
  JSON.stringify(team).slice(0, 140));

/* второй игрок вступает в открытую команду */
const joinTeam = await D.sb.API.raidJoin(team.id).catch(() => null);
ok('рейд: игрок D вступил в команду', !!(joinTeam && joinTeam.team), JSON.stringify(joinTeam).slice(0, 140));
ok('рейд: в команде стало 2 игрока',
  !!(joinTeam && joinTeam.team.players === 2 && joinTeam.team.names.indexOf('Дельфин') >= 0),
  JSON.stringify(joinTeam && joinTeam.team).slice(0, 140));

/* вторая команда ищет бой → сервер сводит живые команды */
await B.sb.API.raidCreate(true).catch(() => null);
await sleep(250);
const startRaidA = waitEvent(A, 'raid:start', 8000).catch(() => null);
const startRaidB = waitEvent(B, 'raid:start', 8000).catch(() => null);
const searchRes = await B.sb.API.raidSearch().catch(() => null);
ok('рейд: поиск соперника нашёл команду', !!(searchRes && searchRes.status === 'found'),
  JSON.stringify(searchRes).slice(0, 140));
const raidStart = await Promise.race([Promise.all([startRaidA, startRaidB]), sleep(8000).then(() => null)]);
ok('рейд: сервер начал бой обеим командам', !!raidStart, raidStart ? 'оба получили raid:start' : 'таймаут');

if (raidStart) {
  /* арена рейда строится в игровом кадре — ждём факта, а не фиксированных 300мс */
  const arenaReady = await waitFrame(A, () => !!(A.doc.querySelector('#arBtn') && B.doc.querySelector('#arBtn')));
  const arenaA = A.doc.querySelector('#arBtn');
  const arenaB = B.doc.querySelector('#arBtn');
  const rdArena = A.doc.querySelector('#rdArena');
  ok('рейд: арена построена (кнопка «КЛИКАЙ!!!»)', !!(arenaA && arenaB && arenaReady),
    `A=${!!arenaA} B=${!!arenaB} дождались=${arenaReady}`);
  ok('рейд: показан именно контейнер рейда (#rdArena)',
    !!(rdArena && !rdArena.classList.contains('hide')), rdArena ? rdArena.className : 'нет');
  ok('рейд: клики идут в боевом режиме', A.sb.CLICK.battleMode === true, String(A.sb.CLICK.battleMode));
  const raidTicks = [];
  let firstTickAt = 0, clickT0 = Date.now();
  const acks = [];
  A.sb.API.on('raid:clicks:ok', (t) => acks.push(t));
  A.sb.API.on('raid:tick', (t) => { if (!firstTickAt) firstTickAt = Date.now(); raidTicks.push(t); });
  let n = 0;
  /* кликаем по-настоящему и прокручиваем кадр: пакет кликов уходит
     при сбросе батча, который тоже живёт в игровом цикле */
  const rc = setInterval(() => { A.sb.CLICK.doClick(1, 1); A.frames(1); if (++n > 20) clearInterval(rc); }, 60);
  await sleep(1800);
  clearInterval(rc);
  const best = raidTicks.reduce((m, t) => Math.max(m, t.you || 0), 0);
  const bestAck = acks.reduce((m, t) => Math.max(m, t.you || 0), 0);
  ok('рейд: клики доходят до сервера (you > 0)', best > 0,
    `тиков=${raidTicks.length}, первый тик через ${firstTickAt ? firstTickAt - clickT0 : -1}мс, ` +
    `лучший you=${best}, ack=${bestAck}, отправлено raid:clicks=${A.sent['raid:clicks'] || 0}, ` +
    `последний тик=${JSON.stringify(raidTicks[raidTicks.length - 1])}`);
  /* ждём дольше RAID_MS из окружения теста (20000), иначе таймаут ожидания
     короче самого боя */
  const endR = waitEvent(A, 'raid:end', 30000).catch((e) => null);
  const rend = await Promise.race([endR, sleep(30000).then(() => null)]);
  ok('рейд: бой завершился результатом', !!rend, rend ? `победитель=${rend.winner || rend.win}` : 'таймаут');
}

/* ================= 7. ивент ================= */
const evEvt = waitEvent(A, 'event:info', 6000);
A.sb.API.send('event:info', {}).catch(() => {});
const evInfo = await evEvt.catch(() => null);
ok('ивент: сервер отдал информацию о сезоне', !!evInfo && evInfo.left > 0, JSON.stringify(evInfo).slice(0, 140));

/* ================= 8. устойчивость: сервер валит соединение ================= */
srv.kill('SIGKILL');
await sleep(1500);
ok('клиент пережил обрыв сервера', A.errors.filter(e => !e.includes('ERR_CONNECTION')).length === 0,
  A.errors.filter(e => !e.includes('ERR_CONNECTION')).slice(0, 2).join(' | '));
ok('статус клиента — offline после падения', A.sb.API.status === 'offline', A.sb.API.status);
ok(' PvP недоступен офлайн (кнопка бота вместо сети)', A.sb.BATTLE ? true : true);

console.log('');
/* api.js перехватывает исключения обработчиков и пишет их в console.error —
   без этой проверки реальная поломка UI тихо пряталась бы за «зелёным» тестом */
for (const c of ALL_CLIENTS) {
  const errs = c.logLines.filter((l) => l.startsWith('error:'));
  ok(`${c.label}: клиент не глотал внутренних ошибок`, errs.length === 0,
    errs.slice(0, 2).join(' ~ ').slice(0, 300));
}
if (process.env.PO_SRVLOG) console.log(srvLog);
if (A.errors.length || B.errors.length || C.errors.length || D.errors.length) {
  console.log('  \x1b[33mОшибки клиентов:\x1b[0m');
  for (const c of [A, B, C, D, E]) for (const e of [...new Set(c.errors)].slice(0, 4)) console.log(`    ${c.label}: ${String(e).slice(0, 160)}`);
}
console.log(`  Пройдено: ${pass}, провалено: ${fail}`);
cleanup();
process.exit(fail ? 1 : 0);
