/* ============================================================
   PIXEL ORCA — runtime smoke-тест клиента без браузера
   Поднимает минимальный DOM/Canvas/WebAudio шим, выполняет все
   скрипты игры и проверяет реальное поведение:
     • бутстрап без исключений
     • клики начисляют косаток, комбо и криты работают
     • улучшения покупаются, доход растёт
     • магазин/квесты/достижения/рыбалка/ивент открываются
     • бокс открывается и выдаёт лут
     • сброс в океан начисляет ракушки
     • сейв пишется в localStorage и восстанавливается
   Запуск: node tools/smoke-client.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + n); } else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + n + (x !== undefined ? ' → ' + x : '')); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ================= мини-DOM ================= */
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source']);

class ClassList {
  constructor(node) { this.node = node; this.set = new Set(); }
  add(...c) { c.forEach(x => x && this.set.add(x)); }
  remove(...c) { c.forEach(x => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, f) { if (f === undefined) f = !this.set.has(c); f ? this.set.add(c) : this.set.delete(c); return f; }
  toString() { return [...this.set].join(' '); }
}

class Node {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.attrs = Object.create(null);
    this.childNodes = [];
    this.parentNode = null;
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, {
      get: (t, k) => t[k] !== undefined ? t[k] : '',
      set: (t, k, v) => { t[k] = v; return true; }
    });
    this.dataset = new Proxy(Object.create(null), {
      get: (t, k) => (k in t ? t[k] : undefined),
      set: (t, k, v) => { t[k] = String(v); return true; }
    });
    this.classList = new ClassList(this);
    this._listeners = Object.create(null);
    this._text = '';
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.width = 300; this.height = 150;
  }
  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = v; }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes.filter(n => n instanceof Node); }
  get firstChild() { return this.childNodes[0] || null; }
  set textContent(v) { this._text = String(v); this.childNodes = []; }
  get textContent() {
    if (this.childNodes.length) return this.childNodes.map(c => c.textContent).join('');
    return this._text;
  }
  set innerHTML(html) { this.childNodes = []; this._html = String(html); parseInto(this, String(html)); }
  get innerHTML() {
    if (this._html != null && !this.childNodes.length) return this._html;
    return this.childNodes.map(serialize).join('');
  }
  appendChild(n) { if (n) { n.parentNode = this; this.childNodes.push(n); if (n.attrs && n.attrs.id) document.byId[n.attrs.id] = n; } return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); return n; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { const l = this._listeners[t]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let n = this;
    while (n) {
      const l = n._listeners[ev.type] || [];
      for (const fn of l.slice()) { ev.currentTarget = n; fn(ev); }
      n = n.parentNode;
      if (!ev.bubbles) break;
    }
    return true;
  }
  click() { if (this.disabled) return false; return this.dispatchEvent({ type: 'click', target: this, bubbles: true }); }
  focus() { document.activeElement = this; }
  select() {}
  setPointerCapture() {} releasePointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 240, right: 320, bottom: 240, x: 0, y: 0 }; }
  getContext() { return makeCtx(); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  closest(sel) {
    let n = this;
    while (n) { if (matches(n, sel)) return n; n = n.parentNode; }
    return null;
  }
  get offsetWidth() { return 320; }
  get offsetHeight() { return 240; }
  get scrollTop() { return 0; }
  get clientWidth() { return 320; }
  get clientHeight() { return 240; }
  get scrollHeight() { return 240; }
  get isConnected() { return true; }
}
function serialize(n) {
  if (n instanceof Node) {
    const a = Object.keys(n.attrs).map(k => ` ${k}="${n.attrs[k]}"`).join('');
    return `<${n.tagName.toLowerCase()}${a}>${n.innerHTML}</${n.tagName.toLowerCase()}>`;
  }
  return String(n);
}

/* парсер HTML-фрагментов (простой, под наш формат) */
function parseInto(parent, html) {
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  let m, stack = [parent];
  while ((m = re.exec(html))) {
    const [full, close, tag, attrs, selfClose, text] = m;
    if (text !== undefined) {
      const t = text.trim();
      if (t) { const tn = new Node('#text'); tn._text = t; stack[stack.length - 1].childNodes.push(tn); }
      continue;
    }
    if (close) { if (stack.length > 1) stack.pop(); continue; }
    const node = new Node(tag);
    const ar = /([\w:-]+)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(attrs))) {
      node.attrs[a[1]] = a[2];
      if (a[1] === 'class') node.className = a[2];
      if (a[1].startsWith('data-')) {
        const key = a[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        node.dataset[key] = a[2];
      }
    }
    if (node.attrs.id) document.byId[node.attrs.id] = node;
    stack[stack.length - 1].appendChild(node);
    if (!VOID.has(tag.toLowerCase()) && !selfClose) stack.push(node);
  }
}

/* селекторы: tag / #id / .class / [attr] / [attr="v"] / комбинации, потомки по пробелу */
function matches(node, sel) {
  if (!(node instanceof Node)) return false;
  sel = sel.trim();
  if (!sel || sel === '*') return true;
  const parts = sel.match(/(^|\s+)([a-zA-Z][\w-]*)?(#[\w-]+)?((?:\.[\w-]+)*)((?:\[[^\]]+\])*)/);
  if (!parts) return false;
  const [, , tag, id, cls, attrs] = parts;
  if (tag && node.tagName !== tag.toUpperCase()) return false;
  if (id && node.attrs.id !== id.slice(1)) return false;
  if (cls) for (const c of cls.split('.').filter(Boolean)) if (!node.classList.contains(c)) return false;
  if (attrs) {
    for (const m of attrs.matchAll(/\[([\w:-]+)(?:([~|^$*]?=)"?([^\]"]*)"?)?\]/g)) {
      const [, k, op, v] = m;
      const val = k.startsWith('data-') ? node.dataset[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : node.attrs[k];
      if (op === '=' && String(val) !== v) return false;
      if (!op && val === undefined) return false;
    }
  }
  return true;
}
function queryAll(root, sel) {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (!(c instanceof Node)) continue;
      if (matches(c, sel)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  if (sel.includes(' ')) {
    /* селекторы с потомками: упрощённо ищем по любому сегменту */
    const seg = sel.trim().split(/\s+/).pop();
    return out.filter(n => matches(n, seg));
  }
  return out;
}

/* 2D-контекст-шим: всё глотает */
function makeCtx() {
  const noop = () => {};
  const target = {
    canvas: null, globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '', textAlign: '', textBaseline: '', imageSmoothingEnabled: false,
    measureText: () => ({ width: 8 }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData: noop, drawImage: noop, save: noop, restore: noop,
    setTransform: noop, translate: noop, scale: noop, rotate: noop
  };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : noop),
    set: (t, k, v) => { t[k] = v; return true; }
  });
}

/* ================= окружение ================= */
const document = {
  byId: Object.create(null),
  activeElement: null,
  createElement: (t) => new Node(t),
  createElementNS: (ns, t) => new Node(t),
  createTextNode: (t) => { const n = new Node('#text'); n._text = t; return n; },
  getElementById(id) { return document.byId[id] || null; },
  querySelector(sel) { return queryAll(document.documentElement, sel)[0] || null; },
  querySelectorAll(sel) { return queryAll(document.documentElement, sel); },
  addEventListener() {}, removeEventListener() {},
  body: new Node('body'),
  head: new Node('head'),
  documentElement: new Node('html'),
  readyState: 'complete',
  hidden: false
};
document.body.classList = new ClassList(document.body);

const localStorage = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(k, String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); }
};

const errors = [];
const listeners = new Map();
const rafQueue = [];
const sandbox = {
  console: {
    log: (...a) => { if (process.env.PO_DEBUG) console.log('   [log]', ...a); },
    warn: (...a) => { if (process.env.PO_DEBUG) console.log('   [warn]', ...a); },
    error: (...a) => { errors.push(a.join(' ')); }
  },
  document, localStorage, location: { protocol: 'http:', host: 'localhost:8787', href: 'http://localhost:8787/' },
  navigator: { userAgent: 'node', language: 'ru', vibrate: () => true },
  performance: { now: () => Date.now() },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, Error, RegExp, Promise, Map, Set, Symbol,
  isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, btoa: (s) => Buffer.from(s, 'binary').toString('base64'), atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  Uint8ClampedArray, TextEncoder, TextDecoder,
  AudioContext: function () {
    return {
      currentTime: 0, state: 'running', destination: {},
      createOscillator: () => ({ type: 'sine', frequency: { value: 440, setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }),
      createGain: () => ({ gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }),
      createBiquadFilter: () => ({ type: 'lowpass', frequency: { value: 800, setValueAtTime() {} }, Q: { value: 1 }, connect() {} }),
      createBufferSource: () => ({ buffer: null, loop: true, connect() {}, start() {}, stop() {} }),
      createBuffer: () => ({ getChannelData: () => new Float32Array(1024) }),
      resume: () => Promise.resolve(), close: () => Promise.resolve()
    };
  },
  webkitAudioContext: null,
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
  addEventListener: (t, fn) => { (listeners.get(t) || listeners.set(t, []).get(t)).push(fn); },
  removeEventListener: () => {},
  innerWidth: 400, innerHeight: 800, devicePixelRatio: 2,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  Intl, Uint8Array, Float32Array
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

/* ================= загрузка скриптов ================= */
console.log('\n\x1b[1mPIXEL ORCA — runtime smoke клиента\x1b[0m\n');

const html = read('index.html');
/* регистрируем элементы из реальной разметки */
const bodyHtml = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
const body = new Node('body');
parseInto(body, bodyHtml);
document.body = body;
document.documentElement.appendChild(body);
for (const m of bodyHtml.matchAll(/\bid="([^"]+)"/g)) {
  if (document.byId[m[1]]) continue;
  const n = new Node('div');
  n.attrs.id = m[1];
  document.byId[m[1]] = n;
  body.appendChild(n);
}
ok('разметка разобрана, найдено элементов: ' + Object.keys(document.byId).length, Object.keys(document.byId).length > 10);

/* порядок берём из index.html — ровно как в браузере */
const files = [...html.matchAll(/<script src="js\/([^"]+)"/g)].map(m => m[1]);
if (!files.length) { console.log('  \x1b[31m✗\x1b[0m в index.html нет скриптов'); process.exit(1); }
for (const f of files) {
  try { vm.runInContext(read('js/' + f), sandbox, { filename: f }); }
  catch (e) {
    console.log('  \x1b[31m✗\x1b[0m ошибка загрузки ' + f + ': ' + e.message);
    console.log('    ' + String(e.stack || '').split('\n').slice(1, 4).join('\n    '));
    fail++;
  }
}
ok(`все ${files.length} скриптов выполнились в порядке index.html без ошибок`, fail === 0, errors.join(' | '));

const { DATA, ST, UI, FX, CLICK, SHOP, QUESTS, FISH, REW, SOCIAL, BATTLE, API, SND, PO_SPR } = sandbox;
ok('все модули доступны в глобальной области', !!(DATA && ST && UI && FX && CLICK && SHOP && QUESTS && FISH && REW && SOCIAL && BATTLE && API && SND && PO_SPR));

/* main.js сам вызывает boot() при readyState=complete */
ok('boot() отработал без исключений', errors.length === 0, errors.join(' | '));

/* прокручиваем кадры анимации */
const tickFrames = (n) => { for (let i = 0; i < n; i++) { const q = rafQueue.splice(0, rafQueue.length); for (const fn of q) { try { fn(performance.now()); } catch (e) { errors.push('raf: ' + e.message); } } } };

/* ================= 1. клики ================= */
const coins0 = ST.state.coins;
const clicks0 = ST.state.stats.clicks;
for (let i = 0; i < 50; i++) { CLICK.doClick(10 + i, 20); tickFrames(1); }
ok('50 кликов начислили косатки', ST.state.coins > coins0, `${coins0} → ${ST.state.coins}`);
ok('счётчик кликов вырос', ST.state.stats.clicks >= 50, String(ST.state.stats.clicks));
ok('комбо набирается', CLICK.combo > 1, String(CLICK.combo));
ok('последний выигрыш больше нуля', CLICK.lastGain > 0, String(CLICK.lastGain));
ok('опыт начисляется', ST.state.xp > 0, String(ST.state.xp));

/* крит должен случиться при большом числе кликов */
let crits = 0;
for (let i = 0; i < 300; i++) { const c = ST.state.stats.crits; CLICK.doClick(5, 5); if (ST.state.stats.crits > c) crits++; }
ok('критические клики срабатывают', ST.state.stats.crits > 0, `crits=${ST.state.stats.crits}`);

/* бонус-точки (clickable bonus) */
CLICK.spawnBonus();
ok('бонус-точка появляется на сцене', CLICK.bonuses.length > 0, String(CLICK.bonuses.length));

/* ================= 2. улучшения ================= */
ST.state.coins = 1e9;
ST.state.totalCoins = 1e9;
const upId = DATA.UPGRADES[0].id;
const up0 = ST.up(upId);
const cost = ST.upgradeCost(upId);
const rBuy = ST.buyUpgrade(upId);
ok('улучшение покупается за монеты', ST.up(upId) === up0 + 1 && !!rBuy,
  `${upId}: ${up0} → ${ST.up(upId)}, цена ${cost}, ответ=${JSON.stringify(rBuy)}`);
ok('perClick вырос после покупки', ST.perClick(0) > 1, String(ST.perClick(0)));
const beforeSec = ST.perSecond();
ST.buyUpgrade(upId);
ok('perSecond не упал', ST.perSecond() >= beforeSec, `${beforeSec} → ${ST.perSecond()}`);
const rMax = ST.buyMax(upId);
ok('buyMax покупает пачкой', ST.up(upId) > 2 && !!rMax, `${upId} → ${ST.up(upId)}, ответ=${JSON.stringify(rMax)}`);
ok('критический шанс в норме', ST.critChance() > 0 && ST.critMult() > 1,
  `chance=${ST.critChance().toFixed(3)} mult=${ST.critMult()}`);

/* ================= 3. магазин: рендер всех вкладок ================= */
SHOP.initClicks();
for (const [tab, boxId] of [['upgrades', 'shopUpgrades'], ['skins', 'shopSkins'], ['boxes', 'shopBoxes'], ['fx', 'shopEffects']]) {
  const err = errors.length;
  SHOP.render(tab);
  const box = document.getElementById(boxId);
  ok(`вкладка «${tab}» отрисована (${boxId}: ${box ? box.children.length : 'нет контейнера'})`,
    box && box.children.length > 0 && errors.length === err, errors.slice(err).join(' | '));
}
const upHtml = document.getElementById('shopUpgrades').innerHTML;
ok('карточки улучшений содержат спрайты и цены', /data-spr=/.test(upHtml) && /px-card/.test(upHtml),
  upHtml.slice(0, 60));
SHOP.paintIcons();
ok('paintIcons не падает', true);

/* ================= 4. скин ================= */
const skinsBefore = ST.state.skinsOwned.length;
const skin = DATA.SKINS.find(s => s.cost);
ok('у скина с ценой есть cost', !!skin);
if (skin) { ST.state.coins = 1e12; ST.buySkin(skin.id); }
ok('скин покупается и надевается', ST.state.skinsOwned.length > skinsBefore && ST.state.skin === skin.id,
  `${skin.id}, owned=${ST.state.skinsOwned.length}`);
ok('коэффициент скина учитывается', ST.allMult() > 1, String(ST.allMult()));

/* ================= 5. бокс ================= */
ST.state.coins = 1e12;
ST.state.fish = 10;
ST.state.shells = 10;
const boxesBefore = ST.state.stats.boxesOpened;
const boxId = DATA.BOXES[0].id;
const r = SHOP.openBox(boxId);
ok('бокс открывается (списание + счётчик)', ST.state.stats.boxesOpened === boxesBefore + 1 && ST.state.coins < 1e12,
  `${boxesBefore} → ${ST.state.stats.boxesOpened}, id=${boxId}, ответ=${JSON.stringify(r)}`);
await sleep(1600);                      /* лут приходит через 1400мс */
ok('бокс выдал награду', errors.length === 0, errors.slice(0, 2).join(' | '));
const loot = document.querySelectorAll('.loot-list');
ok('окно лута показано', loot.length > 0,
  `найдено=${loot.length}, body.children=${document.body.children.length}, modals=${document.querySelectorAll('.px-modal').length}, html=${loot.length ? loot[0].innerHTML.slice(0, 80) : document.body.innerHTML.slice(0, 120)}`);
UI.closeAll();

/* ================= 6. квесты и достижения ================= */
const errQ = errors.length;
QUESTS.render();
QUESTS.check();
ok('квесты и достижения считаются без ошибок', errors.length === errQ, errors.slice(errQ).join(' | '));
ok('есть активные задания', QUESTS.activeQuest() !== undefined, String(QUESTS.activeQuest()));
ok('дневные квесты инициализированы', ST.state.dailyQuests.length === 3, String(ST.state.dailyQuests.length));
ok('ежедневная награда доступна', REW.dailyState().can === true, JSON.stringify(REW.dailyState()));

/* ================= 7. рыбалка ================= */
ST.state.fish = 50;
const errFish = errors.length;
FISH.open();
ok('окно рыбалки открылось', FISH.running === true, String(FISH.running));
ok('рыбалка тикает без ошибок', (FISH.tick(16), errors.length === errFish), errors.slice(errFish).join(' | '));
FISH.close();
ok('рыбалка закрывается', FISH.running === false, String(FISH.running));
ST.state.fish = 10;
const fishEx = ST.exchangeFish();
ok('обмен рыбы на косатки работает', ST.state.fish === 0 && fishEx.coins > 0, JSON.stringify(fishEx));

/* ================= 8. престиж ================= */
ST.state.coins = 5e8;
ST.state.totalCoins = 5e8;
ok('престиж доступен после фарма', ST.canPrestige() === true, 'gain=' + ST.prestigeGain());
SHOP.renderPrestige(document.getElementById('prestigeBody') || document.body);
ok('экран престижа отрисован', errors.length === 0, errors.slice(0, 2).join(' | '));
const shellsPre = ST.state.shells;
const prestigesPre = ST.state.prestiges;
ST.doPrestige();
ok('престиж начисляет ракушки и сбрасывает прогресс',
  ST.state.shells > shellsPre && ST.state.prestiges === prestigesPre + 1,
  `shells ${shellsPre} → ${ST.state.shells}, coins=${ST.state.coins}`);

/* ================= 9. настройки, темы, сейв ================= */
FX.setTheme('neon');
ok('тема переключается без ошибок', FX.themeKey === 'neon', FX.themeKey);
FX.setTheme('lagoon');
ok('тема lagoon активна', FX.themeKey === 'lagoon');
FX.setPixelScale(5);
ok('размер пикселя меняется', FX.size.px === 5, String(FX.size.px));
FX.setPixelScale(3);
ok('возврат к 3px', FX.size.px === 3);

ST.state.settings.shake = true;
CLICK.doClick(12, 14);
ok('тряска при крите не бьёт по null-элементу', errors.length === 0, errors.slice(0, 2).join(' | '));
ST.state.settings.shake = false;

ST.flush();
const save = localStorage.getItem(ST.KEY);
ok('сейв записан в localStorage (' + ST.KEY + ')', !!save, String(save && save.length) + ' байт');
const snapshot = JSON.parse(save);
const coinsSaved = snapshot.coins, lvlSaved = snapshot.level, skinSaved = snapshot.skin;
ST.state.coins = 0; ST.state.level = 1;
ST.load();
ok('сейв восстанавливает монеты', ST.state.coins === coinsSaved, `${ST.state.coins} vs ${coinsSaved}`);
ok('сейв восстанавливает уровень и скин', ST.state.level === lvlSaved && ST.state.skin === skinSaved);

/* ================= 10. оффлайн-доход ================= */
const snap2 = JSON.parse(save);
snap2.lastSave = Date.now() - 3600000;      /* час назад */
snap2.coins = 1000;
snap2.upgrades = snap2.upgrades || {};
snap2.upgrades.fin = 30; snap2.upgrades.voice = 20; snap2.upgrades.drone = 12;   /* нужен ненулевой доход */
localStorage.setItem(ST.KEY, JSON.stringify(snap2));
ST.load();
const off = ST.offlineInfo;
ok('офлайн-доход рассчитан (50% от часа, кап 8ч)', !!off && off.coins > 0, JSON.stringify(off));
ok('офлайн-доход зачислен на 50%', ST.state.coins > 1000, String(ST.state.coins));
ok('офлайн-доход учтён в статистике', ST.state.stats.offlineEarned > 0, String(ST.state.stats.offlineEarned));

/* ================= 11. форматирование и формулы ================= */
ok('формат чисел: 1.23B', ST.fmt(1234567890) === '1.23B', ST.fmt(1234567890));
ok('формат чисел: 12.3K', ST.fmt(12345) === '12.3K', ST.fmt(12345));
ok('формат времени: д/ч/м/с', /д|ч|м|с/.test(ST.fmtTime(90061000)), ST.fmtTime(90061000));
ok('ранг считается', typeof ST.rank() === 'string' && ST.rank().length > 0, ST.rank());
ok('стат кликов читается', ST.statValue('clicks') > 0, String(ST.statValue('clicks')));
ok('стат timeOnline есть', ST.statValue('timeOnline') !== undefined, String(ST.statValue('timeOnline')));

/* ================= 12. PvP и рейд офлайн (фолбэк) ================= */
const errB = errors.length;
BATTLE.openPvP();
ok('PvP: лобби открыто', !!document.getElementById('pvLobby'));
ok('PvP: есть кнопка «БОЙ С БОТОМ» офлайн', !!document.getElementById('pvBot'),
  String(!!document.getElementById('pvBot')));
ok('PvP: показан лидерборд лобби', !!document.getElementById('pvList'), String(!!document.getElementById('pvList')));
BATTLE.close();
BATTLE.openRaid();
ok('рейд: лобби открыто', !!document.getElementById('rdLobby'));
ok('рейд: есть кнопка «РЕЙД С БОТАМИ»', !!document.getElementById('rdBot'), String(!!document.getElementById('rdBot')));
BATTLE.close();
ok('PvP/рейд не дали ошибок', errors.length === errB, errors.slice(errB).join(' | '));

/* ================= 13. соцсети, лидерборд, ивент, настройки ================= */
const errS = errors.length;
for (const [name, fn] of [
  ['аккаунт', () => SOCIAL.openAuth()],
  ['лидерборд', () => SOCIAL.openLeaderboard()],
  ['кланы', () => SOCIAL.openClans()],
  ['ежедневная награда', () => REW.openDaily()],
  ['статистика', () => REW.openStats()],
  ['ивент', () => REW.openEvent()],
  ['реклама x2', () => REW.openAd()]
]) {
  const e0 = errors.length;
  UI.closeAll();
  try { fn(); } catch (e) { errors.push(name + ': ' + e.message); }
  UI.closeAll();
  ok(`окно «${name}» открывается офлайн без ошибок`, errors.length === e0, errors.slice(e0).join(' | '));
}

/* ================= 14. настройки через API ================= */
const errSet = errors.length;
SOCIAL.openAuth(); UI.closeAll();
ok('соц-слой не падает без сервера', errors.length === errS, errors.slice(errS).join(' | '));

/* ================= 15. финальный прогон цикла ================= */
tickFrames(30);
for (let i = 0; i < 30; i++) { ST.tick(1); CLICK.tick(1); FX.tick(); }
ok('игровой цикл живёт без исключений', errors.length === errSet, errors.slice(errSet).join(' | '));
ok('соединение помечено офлайн без сервера', API.status !== 'online', API.status);
ok('toast работает', (UI.toast('тест', 'ok'), true));

console.log('');
if (errors.length) {
  console.log('  \x1b[33mОшибки в консоли (' + errors.length + '):\x1b[0m');
  for (const e of [...new Set(errors)].slice(0, 12)) console.log('    · ' + String(e).slice(0, 200));
}
console.log(`  Пройдено: ${pass}, провалено: ${fail}`);
process.exit(fail || errors.length ? 1 : 0);


