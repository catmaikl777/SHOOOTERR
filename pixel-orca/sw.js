/* ============================================================
   PIXEL ORCA — service worker
   Кэширует оболочку игры, чтобы она открывалась и работала без сети.
   Игра и так офлайн-первая (весь геймплей локальный), сервер нужен
   только для аккаунтов, кланов и PvP — он в кэш не попадает.

   Список файлов перегенерируется командой:
     node tools/prepare-pages.mjs
   ============================================================ */
'use strict';

const VERSION = 'kosatka-v3.0.0';
const CACHE = VERSION + '-shell';

/* PRECACHE:BEGIN — заполняется tools/prepare-pages.mjs */
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/pixel.css',
  './js/config.js',
  './js/sprites.js',
  './js/data.js',
  './js/audio.js',
  './js/state.js',
  './js/api.js',
  './js/ui.js',
  './js/fx.js',
  './js/clicker.js',
  './js/shop.js',
  './js/quests.js',
  './js/fishing.js',
  './js/rewards.js',
  './js/social.js',
  './js/battle.js',
  './js/main.js',
  './img/icon.svg',
  './img/icon-192.png',
  './img/icon-512.png'
];
/* PRECACHE:END */

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* кладём по одному: одна отсутствующая картинка не должна ломать install */
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res && (res.ok || res.type === 'opaque')) await cache.put(url, res);
      } catch (err) { /* ресурс недоступен — игра всё равно работает */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => (n !== CACHE && n.indexOf('kosatka-') === 0 ? caches.delete(n) : null)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  /* навигация: сначала сеть (чтобы подхватить деплой), при отсутствии сети — кэш */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', res.clone()).catch(() => {});
        return res;
      } catch (err) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  /* сторонние ресурсы (шрифты Google и т.п.) не трогаем */
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/ws')) return;

  /* свой статический ассет: сначала кэш, параллельно обновляем (stale-while-revalidate) */
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
