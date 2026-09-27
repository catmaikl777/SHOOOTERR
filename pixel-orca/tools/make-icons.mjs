/* ============================================================
   Генератор иконок PWA: img/icon-192.png, img/icon-512.png, img/icon.svg
   Без зависимостей: PNG собираем вручную (zlib из Node).
   Запуск:  node tools/make-icons.mjs
   ============================================================ */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'img');

/* Рисунок кита 16x16. B — тело, W — брюхо, D — глаз, . — фон */
const GRID = [
  '................',
  '................',
  '................',
  '.......BB.......',
  '......BBBB......',
  '....BBWWWWBB....',
  '..BBBBWDDWBBBB..',
  '.BBBBBWWWWWBBBBB',
  '.BBBBBWWWWWWBB..',
  '..BBBBBWWWWBB...',
  '...BBBBWWBBB....',
  '.....BBBBB......',
  '......BBB.......',
  '.......B........',
  '................',
  '................'
];
const COLORS = {
  B: [47, 74, 122, 255],     /* #2f4a7a — тело */
  W: [242, 246, 255, 255],   /* #f2f6ff — брюхо */
  D: [10, 14, 30, 255],      /* #0a0e1e — глаз */
  '.': [10, 14, 30, 255]     /* #0a0e1e — фон */
};

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/* size — сторона квадрата; inset — отступ в пикселях итогового холста (для maskable) */
function png(size, inset) {
  const grid = 16;
  const cell = (size - inset * 2) / grid;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;                                  /* фильтр строки: none */
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - inset) / cell);
      const gy = Math.floor((y - inset) / cell);
      const ch = (gx >= 0 && gy >= 0 && gx < grid && gy < grid) ? (GRID[gy][gx] || '.') : '.';
      const [r, g, b, a] = COLORS[ch];
      const p = rowStart + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    /* bit depth */
  ihdr[9] = 6;    /* color type RGBA */
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* SVG строим из тех же строк сетки: каждый непрерывный горизонтальный
   отрезок одного цвета — один <rect> */
function svg() {
  const out = [];
  for (let y = 0; y < GRID.length; y++) {
    let x = 0;
    while (x < GRID[y].length) {
      const ch = GRID[y][x];
      let x2 = x;
      while (x2 + 1 < GRID[y].length && GRID[y][x2 + 1] === ch) x2++;
      if (ch !== '.') out.push(`  <rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${hex(COLORS[ch])}"/>`);
      x = x2 + 1;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">
  <rect width="16" height="16" fill="${hex(COLORS['.'])}"/>
${out.join('\n')}
</svg>
`;
}

function hex([r, g, b]) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', png(192, 0)],
  ['icon-512.png', png(512, Math.round(512 * 0.08))],   /* maskable: рисунок в безопасной зоне */
  ['icon.svg', Buffer.from(svg(), 'utf8')]
];
for (const [name, buf] of files) {
  writeFileSync(path.join(OUT, name), buf);
  console.log(`  ✓ img/${name}  ${buf.length} байт`);
}
console.log('  иконки PWA готовы');
