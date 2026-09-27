/* ============================================================
   PIXEL ORCA — мини-игра «Рыбалка»
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, SPR = root.PO_SPR;
  var modal = null, canvas = null, ctx = null;
  var fish = [], bubbles = [], running = false;
  var timeLeft = 15000, last = 0, spawnT = 0;
  var caught = {}, W = 320, H = 180;
  var PX = 3;
  var onClose = null;

  function open() {
    if (running) return;
    running = true;
    timeLeft = 15000;
    fish = []; bubbles = []; caught = {};
    for (var i = 0; i < 16; i++) bubbles.push({ x: Math.random(), y: Math.random(), r: 1, sp: 0.2 + Math.random() * 0.4 });
    modal = UI.modalShell('🎣 РЫБАЛКА', '<div class="fish-stage"><canvas id="fishCv"></canvas>' +
      '<div class="fish-timer"><i id="fishTimerBar"></i><span id="fishTimerTxt">15</span></div>' +
      '<div class="fish-hint">Кликай по рыбам! Поймано: <b id="fishCaughtCnt">0</b></div></div>' +
      '<div class="fish-loot" id="fishLoot"></div>');
    modal.classList.add('fish-modal');
    canvas = modal.querySelector('#fishCv');
    ctx = canvas.getContext('2d');
    resize();
    canvas.addEventListener('pointerdown', onTap);
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target === modal) stop();
    });
    last = 0;
    requestAnimationFrame(loop);
  }

  function resize() {
    PX = 3;
    var rect = modal.querySelector('.fish-stage').getBoundingClientRect();
    W = Math.max(180, Math.floor((rect.width || 320) / PX));
    H = Math.max(120, Math.floor(240 / PX));
    canvas.width = W; canvas.height = H;
    canvas.style.width = (W * PX) + 'px';
    canvas.style.height = (H * PX) + 'px';
    ctx.imageSmoothingEnabled = false;
  }

  function spawn() {
    var t = D.FISH_TYPES[0], r = Math.random() * 100, acc = 0;
    for (var i = 0; i < D.FISH_TYPES.length; i++) {
      acc += D.FISH_TYPES[i].w;
      if (r <= acc) { t = D.FISH_TYPES[i]; break; }
    }
    var fromLeft = Math.random() < 0.5;
    fish.push({
      type: t,
      x: fromLeft ? -20 : W + 20,
      y: 20 + Math.random() * (H - 40),
      dir: fromLeft ? 1 : -1,
      sp: (10 + Math.random() * 16) * t.speed,
      ph: Math.random() * 6.28,
      sc: t.id === 'fish' ? 3 : t.id === 'crab' ? 2 : 2,
      caught: false
    });
  }

  function onTap(e) {
    var r = canvas.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * W;
    var y = (e.clientY - r.top) / r.height * H;
    for (var i = fish.length - 1; i >= 0; i--) {
      var f = fish[i];
      var sz = SPR.size(f.type.sprite).w * f.sc;
      if (Math.abs(f.x - x) < sz / 2 + 3 && Math.abs(f.y - y) < sz / 2 + 3) {
        catchFish(i);
        return;
      }
    }
    root.SND.play('ui');
  }

  function catchFish(i) {
    var f = fish[i];
    fish.splice(i, 1);
    ST.addFish(f.type.val);
    caught[f.type.id] = (caught[f.type.id] || 0) + 1;
    root.SND.play('catchFish');
    var cnt = modal.querySelector('#fishCaughtCnt');
    if (cnt) {
      var total = 0;
      for (var k in caught) total += caught[k];
      cnt.textContent = total;
    }
    var loot = modal.querySelector('#fishLoot');
    if (loot) {
      var s = document.createElement('div');
      s.className = 'fish-pick fish-pick-' + f.type.id;
      s.innerHTML = root.SHOP.SPRHTML(f.type.sprite, 2) + '<span>+' + f.type.val + '</span>';
      loot.appendChild(s);
      root.SHOP.paintIcons(loot);
    }
    for (var j = 0; j < 8; j++) {
      bubbles.push({ x: f.x / W, y: f.y / H, r: 1, sp: 0.5 + Math.random(), pop: true, c: '#9fd8ff' });
    }
    if (f.type.rar) { /* космо-рыба и краб — редкость */ }
  }

  function loop(ts) {
    if (!running) return;
    if (!last) last = ts;
    var dt = Math.min(60, ts - last);
    last = ts;
    timeLeft -= dt;
    if (timeLeft <= 0) { timeLeft = 0; stop(true); }
    update(ts);
    draw();
    requestAnimationFrame(loop);
  }

  function update(ts) {
    spawnT -= dt / 1000 * 1000;
    if (spawnT <= 0) {
      spawn();
      spawnT = 420 + Math.random() * 520;
    }
    var t = ts / 1000;
    for (var i = 0; i < fish.length; i++) {
      var f = fish[i];
      f.x += f.dir * f.sp / 60;
      f.y += Math.sin(t * 2 + f.ph) * 0.35;
      if (f.x < -40 || f.x > W + 40) fish.splice(i--, 1);
    }
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b];
      if (bb.pop) {
        bb.r -= 0.06;
        if (bb.r <= 0) bubbles.splice(b--, 1);
      } else {
        bb.y -= bb.sp / 240;
        if (bb.y < 0) { bb.y = 1; bb.x = Math.random(); }
      }
    }
    var bar = modal.querySelector('#fishTimerBar');
    var txt = modal.querySelector('#fishTimerTxt');
    if (bar) bar.style.width = (timeLeft / 150) + '%';
    if (txt) txt.textContent = Math.ceil(timeLeft / 1000);
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    /* вода */
    for (var y = 0; y < H; y += 2) {
      var d = y / H;
      ctx.fillStyle = d < 0.5 ? '#1e6a9a' : (d < 0.75 ? '#155a86' : '#0d3a5a');
      ctx.fillRect(0, y, W, 2);
    }
    /* пузыри */
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b];
      ctx.fillStyle = bb.c || 'rgba(200,235,255,0.5)';
      var r = Math.max(1, Math.round(bb.r));
      ctx.fillRect(Math.round(bb.x * W), Math.round(bb.y * H), r, r);
    }
    /* рыбы */
    for (var i = 0; i < fish.length; i++) {
      var f = fish[i];
      SPR.draw(ctx, f.type.sprite, f.x, f.y, f.sc, { flip: f.dir < 0, outline: true });
    }
    /* интерфейс */
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 8);
    ctx.globalAlpha = 1;
  }

  function stop(finished) {
    if (!running) return;
    running = false;
    var total = 0;
    for (var k in caught) total += caught[k];
    var m = modal;
    modal = null;
    if (m) {
      UI.closeEl(m);
      m = null;
    }
    if (finished) {
      root.SND.play(total > 0 ? 'bonus' : 'deny');
      UI.banner(total > 0 ? 'УЛОВ: ' + total : 'ПУСТО!', total > 0 ? 'banner-good' : 'banner-bad', 1300);
      if (total > 0) UI.toast('Поймано рыб: ' + total, 'good', 'fish');
    }
    if (onClose) { onClose(); onClose = null; }
  }

  function exchange() {
    var r = ST.exchangeFish();
    if (!r || !r.fish) {
      root.SND.play('deny');
      UI.toast('Сначала поймай рыбу!', 'bad', 'i_fish');
      return;
    }
    root.SND.play('levelUp');
    UI.toast(r.fish + ' рыб → ' + ST.fmt(r.coins) + ' косаток', 'good', 'coin');
  }

  root.FISH = {
    open: open, close: stop, exchange: exchange,
    get running() { return running; },
    tick: function () {}
  };
})(typeof window !== 'undefined' ? window : globalThis);
