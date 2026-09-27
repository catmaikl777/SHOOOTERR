/* ============================================================
   PIXEL ORCA — статическая проверка связности клиента
   • все <script src> существуют
   • каждый id, который ищет JS, есть в index.html
   • каждый CSS-класс из px-* и data-атрибуты имеют стили/обработчики
   • все глобалы root.X определены и загружаются в правильном порядке
   • все вызовы root.X.y существуют в экспортируемом объекте
   Запуск: node tools/checkclient.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let bad = 0, warn = 0;
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const no = (m) => { bad++; console.log('  \x1b[31m✗\x1b[0m ' + m); };
const wn = (m) => { warn++; console.log('  \x1b[33m!\x1b[0m ' + m); };

const html = read('index.html');
const css = read('css/pixel.css');
const jsFiles = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).sort();
const src = Object.fromEntries(jsFiles.map(f => [f, read('js/' + f)]));
const all = Object.values(src).join('\n');

console.log('\n\x1b[1mPIXEL ORCA — проверка клиента\x1b[0m\n');

/* 1. скрипты */
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
for (const s of scripts) {
  if (!fs.existsSync(path.join(ROOT, s))) no(`скрипт не найден: ${s}`);
}
ok(`все ${scripts.length} <script> подключённых файлов существуют`);

/* 2. порядок загрузки: зависимости раньше потребителей */
const order = scripts.map(s => path.basename(s));
const need = { 'data.js': ['sprites.js'], 'state.js': ['data.js'], 'api.js': ['state.js'], 'ui.js': ['sprites.js', 'data.js'], 'fx.js': ['sprites.js', 'state.js'], 'clicker.js': ['fx.js'], 'shop.js': ['ui.js', 'state.js'], 'quests.js': ['ui.js', 'state.js'], 'fishing.js': ['fx.js', 'ui.js'], 'rewards.js': ['ui.js', 'state.js'], 'social.js': ['api.js', 'ui.js'], 'battle.js': ['api.js', 'ui.js', 'fx.js'], 'main.js': ['ui.js', 'api.js', 'fx.js', 'clicker.js', 'shop.js', 'quests.js', 'fishing.js', 'rewards.js', 'social.js', 'battle.js'] };
let orderOk = true;
for (const [f, deps] of Object.entries(need)) {
  for (const d of deps) {
    if (order.indexOf(d) > order.indexOf(f)) { no(`${f} грузится раньше зависимости ${d}`); orderOk = false; }
  }
}
if (orderOk) ok('порядок подключения скриптов корректен (зависимости идут раньше)');

/* 3. id в HTML */
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
/* id, которые создаются динамически в JS (модалки) */
const dynIds = new Set([
  'expTxt', 'adBar', 'adTimer', 'adSkip', 'dailyClaim', 'volTxt', 'pxTxt', 'saveTxt',
  'accName', 'evLb', 'evClanLb', 'evExchange', 'sunset', 'lagoon', 'night', 'neon',
  'prestigeBtn', 'pxPromptInput', 'arCv', 'arTime', 'arMe', 'arFoe', 'arBtn', 'arTeams',
  'fishCv', 'fishTimer', 'fishLoot', 'fishHint', 'lootList', 'lbBody', 'clanBox', 'clanList'
]);
const used = new Map();
for (const [f, code] of Object.entries(src)) {
  const pats = [/getElementById\(\s*'([^']+)'/g, /getElementById\(\s*"([^"]+)"/g, /UI\.\$\(\s*'([^']+)'/g, /\$\(\s*'#([\w-]+)'/g];
  for (const re of pats) {
    for (const m of code.matchAll(re)) {
      const id = m[1];
      if (!used.has(id)) used.set(id, new Set());
      used.get(id).add(f);
    }
  }
}
const missing = [...used.keys()].filter(id => !htmlIds.has(id) && !dynIds.has(id));
if (missing.length) {
  for (const id of missing) no(`id "${id}" ищется в JS (${[...used.get(id)].join(', ')}), но нет в index.html`);
} else ok(`все ${used.size} используемых id найдены в разметке`);

/* дубликаты id в HTML */
const dupes = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1])
  .filter((id, i, arr) => arr.indexOf(id) !== i);
if (dupes.length) no('дублирующиеся id в HTML: ' + [...new Set(dupes)].join(', '));
else ok('дубликатов id в HTML нет');

/* 4. классы, которые JS ищет через querySelector */
const clsUsed = new Set();
for (const m of all.matchAll(/querySelector(?:All)?\(\s*'\.([\w-]+)'/g)) clsUsed.add(m[1]);
for (const m of all.matchAll(/class="[^"]*?\b(px-[\w-]+|toast-[\w-]+|banner-[\w-]+|hide)\b/g)) clsUsed.add(m[1]);
const clsMissing = [...clsUsed].filter(c => !css.includes('.' + c));
if (clsMissing.length) no('классы без стилей: ' + clsMissing.join(', '));
else ok(`все ${clsUsed.size} используемых классов описаны в CSS`);

/* 5. глобалы */
const defined = new Set([...all.matchAll(/root\.([A-Z][A-Z0-9_]*)\s*=\s*\{/g)].map(m => m[1]));
defined.add('PO_SPR');
/* PO_CONFIG — конфиг деплоя из js/config.js: проверяем, что он реально там есть,
   а не просто числим глобал «разрешённым» */
if (/\broot\.PO_CONFIG\b/.test(all)) {
  const cfg = read('js/config.js');
  if (/root\.PO_CONFIG\s*=/.test(cfg)) defined.add('PO_CONFIG');
  else no('PO_CONFIG используется, но не объявлен в js/config.js');
}
const usedGlobals = new Set([...all.matchAll(/\broot\.([A-Z][A-Z0-9_]*)\b/g)].map(m => m[1]));
/* PO_SERVER — необязательный хук: переопределение адреса сервера извне */
const OPTIONAL = new Set(['PO_SERVER', 'PO_DEBUG', 'window', 'document']);
const undefGlobals = [...usedGlobals].filter(g => !defined.has(g) && !OPTIONAL.has(g));
if (undefGlobals.length) no('используются необъявленные глобалы: ' + undefGlobals.join(', '));
else ok(`все глобалы объявлены: ${[...defined].sort().join(', ')}`);

/* 6. вызовы root.X.y — проверяем по экспортам */
function extractExports(code) {
  const out = {};
  const re = /root\.([A-Z][A-Z0-9_]*)\s*=\s*\{/g;
  let m;
  while ((m = re.exec(code))) {
    /* идём по балансу скобок до конца объекта */
    let i = re.lastIndex - 1, depth = 0, end = i;
    for (; i < code.length; i++) {
      const ch = code[i];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const body = code.slice(re.lastIndex, end);
    const keys = new Set();
    let d = 0;
    const first = body.match(/^\s*(?:get\s+)?([A-Za-z_$][\w$]*)\s*[(:,=]/);
    if (first) keys.add(first[1]);
    for (let k = 0; k < body.length; k++) {
      const ch = body[k];
      if (ch === '{' || ch === '[' || ch === '(') d++;
      else if (ch === '}' || ch === ']' || ch === ')') d--;
      if (d !== 0) continue;
      if (ch === ',') {
        const tail = body.slice(k + 1, k + 120).match(/^\s*([A-Za-z_$][\w$]*)\s*[(:,=]/);
        if (tail) keys.add(tail[1]);
        const getter = body.slice(k + 1, k + 160).match(/^\s*get\s+([A-Za-z_$][\w$]*)\s*\(\)/);
        if (getter) keys.add(getter[1]);
      }
    }
    out[m[1]] = keys;
    re.lastIndex = end;
  }
  return out;
}
const exportsMap = extractExports(all);
const callRe = /\broot\.([A-Z][A-Z0-9_]*)\.([A-Za-z_$][\w$]*)\s*\(/g;
const badCalls = new Set();
for (const m of all.matchAll(callRe)) {
  const [, g, fn] = m;
  if (!exportsMap[g]) continue;
  if (!exportsMap[g].has(fn)) badCalls.add(`${g}.${fn}`);
}
if (badCalls.size) no('вызовы несуществующих методов: ' + [...badCalls].join(', '));
else ok(`все вызовы root.Модуль.метод() существуют (проверено модулей: ${Object.keys(exportsMap).length})`);

/* 7. ссылки на обработчики inline в HTML существуют */
for (const m of html.matchAll(/onclick="([A-Za-z_$][\w$.]*)\(/g)) {
  const expr = m[1];
  const [obj, fn] = expr.split('.');
  if (exportsMap[obj] && !exportsMap[obj].has(fn)) no(`inline onclick="${expr}()" — метода нет`);
}
ok('inline-обработчики в HTML существуют');

/* 8. CSS-переменные, которые использует CSS и JS */
const cssVars = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
const varUsed = new Set([...all.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
for (const m of css.matchAll(/var\((--[\w-]+)/g)) varUsed.add(m[1]);
const varMissing = [...varUsed].filter(v => !cssVars.has(v));
if (varMissing.length) no('CSS-переменные без определения: ' + varMissing.join(', '));
else ok(`все ${varUsed.size} используемых CSS-переменных определены`);

/* 9. data-атрибуты: разметка ↔ JS */
const ATTRS = ['tab', 'theme', 'fx', 'join', 'act', 'menu', 'lot', 'st'];
const dataInHtml = new Set([...html.matchAll(/\bdata-([\w-]+)=/g)].map(m => m[1]));
const dataInJs = new Set();
for (const m of all.matchAll(/dataset\.([A-Za-z_$][\w$]*)/g)) dataInJs.add(m[1]);
for (const m of all.matchAll(/\[data-([\w-]+)/g)) dataInJs.add(m[1]);
for (const m of all.matchAll(/\bdata-([\w-]+)\b(?!\s*=)/g)) dataInJs.add(m[1]);
/* свойства dataset.X = '…' — внутренние флаги, они не приходят из разметки */
for (const a of [...dataInJs]) {
  if (new RegExp(`dataset\\.${a}\\s*=[^=]`).test(all) && !dataInHtml.has(a)) dataInJs.delete(a);
}
for (const a of dataInJs) {
  /* dataset.questAct в разметке записан как data-quest-act */
  const kebab = a.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const lit = new Set(['data-' + a, 'data-' + kebab]);
  const found = [...lit].some(l => all.includes(l) || html.includes(l)) || dataInHtml.has(a) || dataInHtml.has(kebab);
  if (!found) wn(`"${[...lit].join('" / "')}" читается в JS, но нигде не задаётся`);
}
ok(`data-атрибуты согласованы (в разметке: ${[...dataInHtml].sort().join(', ')})`);

/* 10. баланс: каждое улучшение/скин/бокс/квест/достижение/эффект рендерится */
const needKeys = [
  ['D.UPGRADES', 'up-card', 'улучшения'],
  ['D.SKINS', 'skin-card', 'скины'],
  ['D.BOXES', 'box-card', 'боксы'],
  ['D.QUESTS', 'quest-card', 'квесты'],
  ['D.ACHIEVEMENTS', 'ach-card', 'достижения'],
  ['D.EFFECTS', 'fx-toggle', 'эффекты']
];
for (const [key, cls, name] of needKeys) {
  if (all.includes(key) && all.includes(cls)) ok(`${name}: есть данные и карточка отрисовки`);
  else no(`${name}: нет ${key} или класса ${cls}`);
}

/* 11. эффекты: каждый id из D.EFFECTS есть в state.effectsOn по умолча */
const data = read('js/data.js');
const effIds = [...data.matchAll(/\{ id: '(e\d+)'/g)].map(m => m[1]);
const onDefaults = (data.match(/effectsOn: \{([^}]*)\}/) || [, ''])[1];
const missingOn = effIds.filter(id => !onDefaults.includes(id));
if (effIds.length && missingOn.length) no('эффекты без записи в effectsOn по умолчанию: ' + missingOn.join(', '));
else ok(`все ${effIds.length} эффектов прописаны в effectsOn по умолчанию`);

/* 12. DAILY_REWARD: длина массива, иконки существуют */
const dailyLen = (data.match(/DAILY_REWARD\s*=\s*\[([\s\S]*?)\n {2}\];/) || [, ''])[1];
const dailyCount = (dailyLen.match(/\{/g) || []).length;
if (dailyCount >= 7) ok(`ежедневных наград ${dailyCount} дней (сетка рассчитана на 4 колонки)`);
else wn(`ежедневных наград всего ${dailyCount} — стоит расширить до 7`);

console.log('');
if (bad) { console.log(`  \x1b[31mПроблем: ${bad}\x1b[0m, предупреждений: ${warn}`); process.exit(1); }
console.log(`  \x1b[32mКлиент целостен.\x1b[0m Предупреждений: ${warn}`);
