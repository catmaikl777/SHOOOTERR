/* ============================================================
   Локальный просмотр собранного сайта — «как на GitHub Pages»
   ----------------------------------------------------------------
     node tools/prepare-pages.mjs wss://localhost:8787/ws
     node tools/serve-pages.mjs            # http://localhost:4173

   Отдаёт только dist/ (то, что реально уедет на Pages):
   index.html, css/, js/, img/, sw.js, manifest.webmanifest, .nojekyll
   ============================================================ */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.resolve(ROOT, process.env.PO_DIR || 'dist');
const PORT = +(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];
  let rel = decodeURIComponent(url);
  if (rel === '/') rel = '/index.html';
  const file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end('403'); }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('не файл');
    const body = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — нет ' + rel + '\nСначала собери сайт: node tools/prepare-pages.mjs');
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  🐋  Раздача собранного сайта: http://' + HOST + ':' + PORT);
  console.log('      папка: ' + DIST);
  console.log('      Ctrl+C — остановить');
  console.log('');
});
