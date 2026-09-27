import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const SPR = require('../js/sprites.js');

const errs = SPR.validate();
const names = Object.keys(SPR.SPRITES);
if (errs.length) {
  console.log('ОШИБКИ (' + errs.length + '):');
  for (const e of errs) console.log('  - ' + e);
  process.exit(1);
}
console.log('OK: ' + names.length + ' спрайтов валидны');
for (const n of names) {
  const rows = SPR.SPRITES[n];
  console.log('  ' + n.padEnd(12) + rows[0].length + 'x' + rows.length);
}
