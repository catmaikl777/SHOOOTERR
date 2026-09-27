/* ============================================================
   Сборка статики для GitHub Pages
   ----------------------------------------------------------------
   Копирует только то, что нужно браузеру, подставляет адрес
   WebSocket-сервера в js/config.js и пересобирает список precache
   в sw.js, затем проверяет результат.

   Запуск:
     node tools/prepare-pages.mjs                       # в dist/
     node tools/prepare-pages.mjs --out build          # в build/
     PO_SERVER_URL=wss://my-app.onrender.com/ws node tools/prepare-pages.mjs
     node tools/prepare-pages.mjs wss://my-app.fly.dev/ws
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2);
    flags[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true';
  } else positional.push(args[i]);
}

/* что уезжает на Pages: только браузерные файлы, без сервера и тестов */
const INCLUDE_FILES = ['index.html', 'sw.js', 'manifest.webmanifest', '.nojekyll', 'CNAME', 'robots.txt'];
const INCLUDE_DIRS = ['css', 'js', 'img'];

const OUT = path.resolve(ROOT, flags.out || positional[1] || 'dist');
const SERVER_URL = String(
  positional[0] || flags.server || process.env.PO_SERVER_URL || process.env.PO_WS_URL || ''
).trim();

let pass = 0, fail = 0;
const ok = (m, good, extra = '') => {
  if (good) { pass++; console.log('  \x1b[32m✓\x1b[0m ' + m); }
  else { fail++; console.log('  \x1b[31m✗\x1b[0m ' + m + (extra ? '  ' + extra : '')); }
};
const info = (m) => console.log('  \x1b[36m·\x1b[0m ' + m);

console.log('\nPIXEL ORCA — сборка для GitHub Pages\n');

/* ---------- 1. чистим и копируем ---------- */
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const copied = [];
for (const f of INCLUDE_FILES) {
  const src = path.join(ROOT, f);
  if (!existsSync(src)) { info('нет ' + f + ' — пропускаю'); continue; }
  cpSync(src, path.join(OUT, f));
  copied.push(f);
}
for (const d of INCLUDE_DIRS) {
  const src = path.join(ROOT, d);
  if (!existsSync(src)) { info('нет папки ' + d + ' — пропускаю'); continue; }
  cpSync(src, path.join(OUT, d), { recursive: true });
  copied.push(d + '/');
}
/* .nojekyll нужен всегда: без него Jekyll выкинет файлы, начинающиеся с _ */
if (!copied.includes('.nojekyll')) {
  writeFileSync(path.join(OUT, '.nojekyll'), '');
  copied.push('.nojekyll');
}
ok(`скопировано в ${path.relative(ROOT, OUT) || OUT}/ (${copied.join(', ')})`, true);

/* ---------- 2. адрес сервера в js/config.js ---------- */
const cfgPath = path.join(OUT, 'js', 'config.js');
if (!existsSync(cfgPath)) {
  ok('js/config.js есть в сборке', false);
} else {
  let cfg = readFileSync(cfgPath, 'utf8');
  const url = SERVER_URL.replace(/\/+$/, '');
  if (url) {
    /* аккуратно меняем только поле server: */
     cfg = cfg.replace(/(\n\s*server:\s*)'[^']*'/, (m, p1) => `${p1}'${url}'`);
    if (!/(\n\s*server:\s*)'[^']*'/.test(cfg)) {
      cfg = cfg.replace(/(\{[^{}]*)(\})/, (m, body, close) => `${body}\n    server: '${url}'${close}`);
    }
  }
  writeFileSync(cfgPath, cfg);
  const got = (cfg.match(/server:\s*'([^']*)'/) || [])[1] || '';
  if (!url) {
    ok(`config.js: сервер не задан (${got || 'пусто'}) — клиент возьмёт /ws своего хоста`, true);
  } else {
    ok(`config.js: сервер = ${got}`, got === url, `ожидали ${url}`);
  }
  if (url && !/^wss?:\/\//.test(url)) {
    ok('адрес сервера начинается с ws:// или wss://', false, 'получено: ' + url);
  } else {
    ok('адрес сервера корректный (ws/wss)', true);
  }
  if (/^ws:\/\//.test(url)) {
    info('внимание: ws:// (без шифрования). Для публичного HTTPS-сайта нужен wss://');
  }
}

/* ---------- 3. список файлов для precache в sw.js ---------- */
function walk(dir, base = '') {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const rel = base ? base + '/' + name : name;
    if (name === 'node_modules' || name.startsWith('.')) continue;
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel));
    else out.push(rel);
  }
  return out;
}
const swPath = path.join(OUT, 'sw.js');
if (existsSync(swPath)) {
  const files = walk(OUT).filter((f) => f !== 'sw.js').sort();
  const list = ['./', './index.html', ...files.map((f) => './' + f)];
  const sw = readFileSync(swPath, 'utf8');
  const replaced = sw.replace(
    /(\/\* PRECACHE:BEGIN[^*]*\*\/)([\s\S]*?)(\/\* PRECACHE:END \*\/)/,
    (_, begin, _old, end) => begin + '\nconst PRECACHE = [\n' +
      list.map((f) => `  '${f}'`).join(',\n') + '\n];\n' + end
  );
  writeFileSync(swPath, replaced);
  ok(`sw.js: precache пересобран (${list.length} файлов)`, replaced !== sw);
  /* сверяем, что в precache нет несуществующих файлов */
  const miss = list.filter((f) => f !== './' && !existsSync(path.join(OUT, f.slice(2))));
  ok('все файлы precache существуют', miss.length === 0, miss.join(', '));
} else {
  ok('sw.js есть в сборке', false);
}

/* ---------- 4. проверяем, что index.html не ссылается на пустое ---------- */
const html = readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|#|mailto:|\/\/)/.test(u));
const broken = refs.filter((u) => !existsSync(path.join(OUT, u.split('?')[0].split('#')[0])));
ok(`все локальные ссылки из index.html на месте (${refs.length})`, broken.length === 0, broken.join(', '));

const absolute = refs.filter((u) => u.startsWith('/'));
ok('нет абсолютных путей (иначе сломается подпапка /SHOOOTERR/)', absolute.length === 0, absolute.join(', '));

/* каждый <script src> должен реально существовать в сборке */
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
const noScript = scripts.filter((s) => !existsSync(path.join(OUT, s)));
ok(`все ${scripts.length} скриптов из index.html есть в сборке`, noScript.length === 0, noScript.join(', '));
ok('js/config.js подключается первым', scripts[0] === 'js/config.js', 'первый: ' + scripts[0]);

/* service worker должен регистрироваться только на защищённом контексте */
if (existsSync(path.join(OUT, 'js', 'main.js'))) {
  const main = readFileSync(path.join(OUT, 'js', 'main.js'), 'utf8');
  ok('регистрация service worker есть в main.js', /serviceWorker/.test(main));
}

/* ---------- 5. итог ---------- */
let bytes = 0, count = 0;
for (const f of walk(OUT)) { bytes += statSync(path.join(OUT, f)).size; count++; }
console.log('');
console.log(`  файлов: ${count}, вес: ${(bytes / 1024).toFixed(1)} КБ`);
console.log(`  папка:  ${OUT}`);
if (SERVER_URL) console.log(`  бэкенд: ${SERVER_URL}`);
else console.log('  бэкенд: не задан → укажи PO_SERVER_URL или передай адрес аргументом');
console.log(`  \x1b[1mПроверено: ${pass}, провалено: ${fail}\x1b[0m`);
console.log('');
process.exit(fail ? 1 : 0);
