/* ============================================================
   PIXEL ORCA — рендер сцены + 10 визуальных эффектов
   Внутреннее разрешение = экран / pixelScale, nearest-neighbour
   ============================================================ */
(function (root) {
  'use strict';

  var SPR = root.PO_SPR, ST = root.ST, D = root.DATA;
  var cv = null, ctx = null;
  var W = 320, H = 240, PX = 3;
  var t = 0, raf = 0, last = 0;
  var particles = [], numbers = [], rings = [];
  var drops = [], rainOn = false, rainAcc = 0;

  /* брызги от дождя (переиспользуем частицы) */
  function splashAt(x, y) {
    for (var i = 0; i < 3; i++) {
      particles.push({
        x: x, y: y, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30,
        g: 160, s: 1, c: theme.foam, life: 300, max: 300
      });
    }
  }
  function rain(on) {
    rainOn = !!on;
    if (rainOn) rainAcc = 0;
  }
  var orca = { x: 0, y: 0, scale: 4, bob: 0, squash: 0, flip: false };
  var theme = null, themeKey = 'sunset';
  var enabled = {};
  var stars = [], clouds = [], bubbles = [], flashes = [];
  var orcaGlow = 0, ghostTimer = 0, ghosts = [];
  var boltTimer = 3, bolt = null;
  var vortex = [];
  var caughtFish = null;

  /* ---------- 3x5 пиксельный шрифт ---------- */
  var FONT = {
    '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
    '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001',
    '8': '111101111101111', '9': '111101111001111',
    'x': '000101010101000', 'X': '101111010111101', '+': '000010111010000', '-': '000000111000000',
    '.': '000000000000010', ',': '000000000010100', 'K': '101110100110101', 'M': '101111111101101',
    'B': '110101110101110', 'T': '111010010010010', 'Q': '111101101110011', 'N': '101111111111101',
    'S': '011100010001110', 'R': '110101110101101', 'A': '111101111101101', 'E': '111100111100111',
    'I': '111010010010111', 'L': '100100100100111', 'O': '111101101101111', 'U': '101101101101111',
    'P': '111101111100100', 'C': '111100100100111', 'D': '110101101101110', 'H': '101101111101101',
    'V': '101101101101010', 'W': '101101111111101', 'G': '111100101101111', 'Y': '101101010010010',
    '!': '010010000000010', '%': '101001010100101', '/': '001001010100100', ' ': '000000000000000',
    ':': '000010000010000', '?': '111001011000010', '=': '000111000111000', '#': '101111101111101',
    '*': '000101010101000', '(': '001010010010001', ')': '100010010010100', "'": '010010000000000',
    'a': '111101111101111', 'o': '010101111101010', 'e': '011100111101011', 'c': '011100100100011',
    'r': '010100110100010', 'i': '010000110010000', 's': '011100010001110', 'n': '010111101101101',
    't': '010111010010010', 'l': '110010010010111', 'u': '101101101101011', 'd': '001101111101101',
    'g': '011101101011010', 'm': '110111111101101', 'h': '101111101101101', 'p': '111101111100100'
  };
  function drawText(g, str, x, y, color, sc) {
    sc = sc || 1;
    g.fillStyle = color;
    var cx = x;
    for (var i = 0; i < str.length; i++) {
      var f = FONT[str.charAt(i)] || FONT['?'];
      if (str.charAt(i) !== ' ') {
        for (var r = 0; r < 5; r++) {
          for (var c = 0; c < 3; c++) {
            if (f.charAt(r * 3 + c) === '1') g.fillRect(cx + c * sc, y + r * sc, sc, sc);
          }
        }
      }
      cx += 4 * sc;
    }
    return cx - x;
  }
  function textW(str, sc) { return str.length * 4 * (sc || 1); }
  function drawTextC(g, str, cx, y, color, sc) {
    drawText(g, str, Math.round(cx - textW(str, sc) / 2), y, color, sc || 1);
  }

  /* ---------- темы ---------- */
  var THEMES = {
    sunset: {
      label: 'Закат',
      sky: ['#ff9a5c', '#ff7a6b', '#e05a8a', '#8a4a9e', '#4a2a6a'],
      sun: '#ffd447', sunGlow: '#ff8a5c',
      seaTop: '#3a5a9a', seaBot: '#141b3a',
      wave: ['#4a74b0', '#3a5a9a', '#2a4478', '#1b2a50'],
      foam: '#c3cfe8', cloud: '#ffb08a', cloud2: '#e0709a',
      star: 0, caustics: '#ffd9a0', island: '#2a1f4a', amb: '#ff8a6a'
    },
    lagoon: {
      label: 'Лагуна',
      sky: ['#9ff0ff', '#6fd8f0', '#5ab8e8', '#3f9ad8', '#2f7cc0'],
      sun: '#fff2a0', sunGlow: '#ffe070',
      seaTop: '#2ac0c8', seaBot: '#0d4a6a',
      wave: ['#5ae0e0', '#2ac0c8', '#1a94b0', '#0e6c94'],
      foam: '#e8ffff', cloud: '#ffffff', cloud2: '#dff6ff',
      star: 0, caustics: '#dffcff', island: '#1e6a5a', amb: '#bff6ff'
    },
    night: {
      label: 'Ночь',
      sky: ['#1b2a5a', '#16224a', '#101a3a', '#0b1228', '#070c1a'],
      sun: '#e8e8ff', sunGlow: '#8a9ae0',
      seaTop: '#152a4a', seaBot: '#050a18',
      wave: ['#22385e', '#182a4a', '#101e38', '#0a1428'],
      foam: '#7f9ac0', cloud: '#2a3a66', cloud2: '#1b2748',
      star: 1, caustics: '#6fe0ff', island: '#0a1024', amb: '#4a6ac0'
    },
    neon: {
      label: 'Неон',
      sky: ['#2a0a4a', '#3a0a5a', '#1a0a3a', '#0d0622', '#05030f'],
      sun: '#ff4ad0', sunGlow: '#7a2aff',
      seaTop: '#2a1060', seaBot: '#0a0420',
      wave: ['#7a2aff', '#5a1ac0', '#3a1080', '#1a0640'],
      foam: '#ff8ae0', cloud: '#3a1a6a', cloud2: '#5a2a9a',
      star: 1, caustics: '#ff6bd6', island: '#0d0622', amb: '#c04aff'
    }
  };

  function setTheme(key) {
    if (!THEMES[key]) key = 'sunset';
    themeKey = key;
    theme = THEMES[key];
    buildStatic();
    if (root.UI) root.UI.toast('Фон: ' + theme.label, 'info', 'i_star');
  }

  function buildStatic() {
    var i;
    stars = [];
    for (i = 0; i < 60; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H * 0.5, p: Math.random() * 6.28, s: Math.random() < 0.2 ? 2 : 1 });
    }
    clouds = [];
    for (i = 0; i < 6; i++) {
      clouds.push({
        x: Math.random() * W, y: 8 + Math.random() * H * 0.22,
        sp: 2 + Math.random() * 5, sc: 1 + Math.floor(Math.random() * 3),
        c: Math.random() < 0.5 ? 0 : 1
      });
    }
    bubbles = [];
    for (i = 0; i < 26; i++) {
      bubbles.push({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 2, sp: 6 + Math.random() * 18, p: Math.random() * 6.28 });
    }
    vortex = [];
    for (i = 0; i < 40; i++) {
      var a = Math.random() * 6.28, rr = 30 + Math.random() * 90;
      vortex.push({ a: a, rr: rr, sp: (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random()), c: Math.random() < 0.5 ? '#2a1050' : '#0d0622' });
    }
    ghosts = [];
  }

  /* ---------- init ---------- */
  function init(canvas) {
    cv = canvas;
    ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    if (!theme) setTheme(ST.state.settings.theme || 'sunset');
    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', function () { last = 0; });
    raf = requestAnimationFrame(frame);
  }

  function resize() {
    PX = ST.state.settings.pixelScale || 3;
    PX = Math.max(2, Math.min(6, PX));
    var w = Math.max(200, Math.ceil(window.innerWidth / PX));
    var h = Math.max(240, Math.ceil(window.innerHeight / PX));
    W = w; H = h;
    cv.width = w; cv.height = h;
    cv.style.width = '100%';
    cv.style.height = '100%';
    ctx.imageSmoothingEnabled = false;
    buildStatic();
    orca.scale = Math.max(3, Math.min(7, Math.floor(H * 0.10 / 14)));
    orca.x = Math.round(W / 2 - (18 * orca.scale) / 2);
    orca.y = Math.round(H * 0.42);
  }
  function setPixelScale(v) {
    ST.state.settings.pixelScale = v;
    ST.save();
    resize();
  }

  /* ---------- главный цикл ---------- */
  function frame(ts) {
    if (!last) last = ts;
    var dt = Math.min(50, ts - last);
    last = ts;
    t += dt / 1000;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  function update(dt) {
    var s = dt / 1000;
    /* косатка */
    orca.bob += s * 1.6;
    orca.squash = Math.max(0, orca.squash - dt / 90);
    orcaGlow = Math.max(0, orcaGlow - dt / 260);

    /* частицы */
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.vy += (p.g || 0) * s;
      p.vx *= 0.99;
      if (p.swirl) {
        var a = (p.x - orca.x) * 0.02 + t * p.swirl;
        p.x += Math.cos(a) * 8 * s;
        p.y += Math.sin(a) * 8 * s;
      }
    }
    for (var j = numbers.length - 1; j >= 0; j--) {
      var n = numbers[j];
      n.life -= dt;
      n.y -= (n.vy || 26) * s;
      n.vy = (n.vy || 26) * 0.95;
      if (n.life <= 0) numbers.splice(j, 1);
    }
    for (var k = rings.length - 1; k >= 0; k--) {
      var r = rings[k];
      r.life -= dt;
      r.r += r.sp * s;
      if (r.life <= 0) rings.splice(k, 1);
    }
    for (var b = bubbles.length - 1; b >= 0; b--) {
      var bb = bubbles[b];
      bb.y -= bb.sp * s;
      bb.x += Math.sin(t * 1.5 + bb.p) * 4 * s;
      if (bb.y < -4) { bb.y = H + 4; bb.x = Math.random() * W; }
    }
    for (var c = clouds.length - 1; c >= 0; c--) {
      clouds[c].x -= clouds[c].sp * s;
      if (clouds[c].x < -30) { clouds[c].x = W + 20; clouds[c].y = 8 + Math.random() * H * 0.2; }
    }
    if (caughtFish) {
      caughtFish.life -= dt;
      if (caughtFish.life <= 0) caughtFish = null;
    }
    /* морской дождь */
    if (rainOn) {
      rainAcc += dt;
      while (rainAcc > 26) {
        rainAcc -= 26;
        drops.push({ x: Math.random() * W, y: -4, sp: 260 + Math.random() * 200, len: 2 + Math.floor(Math.random() * 3) });
      }
      for (var dI = drops.length - 1; dI >= 0; dI--) {
        var dr = drops[dI];
        dr.y += dr.sp * s;
        dr.x += 40 * s;
        if (dr.y > H + 4) {
          if (Math.random() < 0.35) splashAt(dr.x, H - 2 - Math.random() * 6);
          drops.splice(dI, 1);
        }
      }
    } else if (drops.length) drops.length = 0;
    /* призраки */
    if (enabled.e10) {
      ghostTimer -= dt;
      if (ghostTimer <= 0) {
        ghostTimer = 2600 + Math.random() * 3000;
        ghosts.push({ x: W + 20, y: H * 0.35 + Math.random() * H * 0.4, sp: 14 + Math.random() * 18, fl: 0 });
      }
    }
    for (var gI = ghosts.length - 1; gI >= 0; gI--) {
      ghosts[gI].x -= ghosts[gI].sp * s;
      if (ghosts[gI].x < -40) ghosts.splice(gI, 1);
    }
    /* молния */
    if (enabled.e9) {
      boltTimer -= dt;
      if (boltTimer <= 0) {
        boltTimer = 2200 + Math.random() * 5000;
        bolt = { life: 180, pts: [] };
        var bx = W * (0.2 + Math.random() * 0.6);
        for (var bl = 0; bl < 7; bl++) {
          bolt.pts.push({ x: bx + (Math.random() * 14 - 7), y: bl * 12 });
        }
        root.SND.play('tick');
      }
      if (bolt) {
        bolt.life -= dt;
        if (bolt.life <= 0) bolt = null;
      }
    }
    /* фоновые частицы эффектов */
    if (enabled.e4 && Math.random() < 0.5) {
      particles.push({
        x: Math.random() * W, y: H * 0.55 + Math.random() * H * 0.45, vx: 0, vy: -3, g: 0,
        life: 2600, max: 2600, c: Math.random() < 0.5 ? '#fff2a0' : '#ffffff', s: 1, tw: 1
      });
    }
    if (enabled.e7 && Math.random() < 0.35) {
      particles.push({
        x: Math.random() * W, y: -4, vx: 4, vy: 12, g: 0,
        life: 9000, max: 9000, c: '#dff4ff', s: 1
      });
    }
    if (enabled.e6 && Math.random() < 0.4) {
      particles.push({
        x: orca.x + (Math.random() * 60 - 30), y: orca.y + 24, vx: 6, vy: -18, g: -4,
        life: 900, max: 900, c: pick(['#ffd447', '#ff8a3a', '#ff5a2a']), s: 2
      });
    }
    if (enabled.e8 && Math.random() < 0.3) {
      var v = vortex[Math.floor(Math.random() * vortex.length)];
      var vx = W / 2 + Math.cos(v.a + t * v.sp) * v.rr * 1.6;
      var vy = H * 0.75 + Math.sin(v.a + t * v.sp) * v.rr * 0.7;
      particles.push({ x: vx, y: vy, vx: 0, vy: 0, g: 0, life: 1600, max: 1600, c: v.c, s: 1, swirl: 0.6 });
    }
    if (enabled.e2) orcaGlow = Math.max(orcaGlow, 26);
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* ---------- эффекты клика ---------- */
  function clickFx(x, y, amount, crit, combo) {
    var s = orca.scale;
    var cx = x || (orca.x + 18 * s / 2);
    var cy = y || (orca.y + 6 * s);
    orca.squash = 1;
    orcaGlow = 40;

    numbers.push({
      x: cx + (Math.random() * 10 - 5), y: cy - 6, text: '+' + ST.fmt(amount),
      life: 900, max: 900, vy: 34, c: crit ? '#ffd447' : '#ffffff', sc: crit ? 2 : 1
    });
    if (combo >= 5) {
      numbers.push({
        x: cx, y: cy - 14, text: 'x' + combo, life: 700, max: 700, vy: 22, c: '#4ae0e0', sc: 1
      });
    }
    var n = crit ? 16 : 6;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.28;
      particles.push({
        x: cx, y: cy, vx: Math.cos(a) * (crit ? 60 : 34), vy: Math.sin(a) * (crit ? 60 : 34) - 12,
        g: 90, life: 400 + Math.random() * 300, max: 700,
        c: crit ? pick(['#ffd447', '#fff2a0', '#ff8a3a']) : pick(['#9fd8ff', '#ffffff', '#4ae0e0']),
        s: crit ? 2 : 1
      });
    }
    if (crit && enabled.e1) {
      for (var j = 0; j < 12; j++) {
        var a2 = Math.random() * 6.28;
        particles.push({
          x: cx, y: cy, vx: Math.cos(a2) * 40, vy: Math.sin(a2) * 40 - 20, g: 40,
          life: 900, max: 900, c: pick(['#ffd447', '#ffe890', '#ffffff']), s: 1, tw: 1
        });
      }
    }
    if (enabled.e3) {
      var hues = ['#ff4a4a', '#ffd447', '#4ad07a', '#4ae0e0', '#4a7ff0', '#c05ae0'];
      for (var k = 0; k < 8; k++) {
        particles.push({
          x: cx - k * 3, y: cy + 4, vx: -20 - k * 4, vy: 4 + k, g: 0,
          life: 500, max: 500, c: hues[k % hues.length], s: 1
        });
      }
    }
    if (enabled.e5) {
      rings.push({ x: cx, y: cy, r: 4, sp: 90, life: 500, max: 500, c: '#c3cfe8' });
    }
  }

  function bonusFx(color, x, y) {
    for (var i = 0; i < 22; i++) {
      var a = Math.random() * 6.28;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, g: 60,
        life: 600, max: 600, c: color, s: 2
      });
    }
    rings.push({ x: x, y: y, r: 6, sp: 130, life: 600, max: 600, c: color });
  }
  function pulseBonus() {
    for (var i = 0; i < 8; i++) {
      var a = Math.random() * 6.28;
      particles.push({
        x: W / 2, y: H * 0.1, vx: Math.cos(a) * 30, vy: 20, g: 0,
        life: 800, max: 800, c: theme.foam, s: 1
      });
    }
  }
  function fishDrop() {
    caughtFish = { x: orca.x + 10, y: orca.y + 10, life: 1600, max: 1600, vx: 30, vy: -40 };
  }

  /* ---------- рисование ---------- */
  function dither(x, y, w, h, c1, c2, p) {
    ctx.fillStyle = c1;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = c2;
    for (var yy = y; yy < y + h; yy++) {
      for (var xx = x + ((yy % 2) ? 1 : 0); xx < x + w; xx += 2) {
        if (((xx + yy) % 4) / 4 < p) ctx.fillRect(xx, yy, 1, 1);
      }
    }
  }

  function draw() {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    var seaY = Math.round(H * 0.55);
    drawSky(seaY);
    drawSea(seaY);
    drawEntities(seaY);
    drawParticles();
    drawNumbers();
    drawOverlay();
  }

  function drawSky(seaY) {
    var bands = theme.sky;
    var bh = Math.ceil(seaY / bands.length);
    for (var i = 0; i < bands.length; i++) {
      var y0 = i * bh, h = Math.min(bh, seaY - y0);
      if (h <= 0) continue;
      ctx.fillStyle = bands[i];
      ctx.fillRect(0, y0, W, h);
      if (i < bands.length - 1) dither(0, y0 + h - 2, W, 2, bands[i], bands[i + 1], 0.5);
    }
    /* светило */
    var sunX = W * 0.78, sunY = seaY * 0.42, r = Math.max(5, Math.floor(H * 0.045));
    ctx.fillStyle = theme.sunGlow;
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(sunX, sunY, r * 2.4, 0, 6.3); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.sun;
    ctx.beginPath(); ctx.arc(sunX, sunY, r, 0, 6.3); ctx.fill();
    if (theme.star) {
      ctx.fillStyle = theme.sun;
      ctx.fillRect(Math.round(sunX - r * 1.5), Math.round(sunY - 1), r * 3, 2);
      ctx.fillRect(Math.round(sunX - 1), Math.round(sunY - r * 1.5), 2, r * 3);
    }
    /* звёзды */
    if (theme.star) {
      for (var s = 0; s < stars.length; s++) {
        var st = stars[s];
        var tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.5 + st.p));
        ctx.globalAlpha = tw;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(st.x), Math.round(st.y), st.s, st.s);
      }
      ctx.globalAlpha = 1;
    }
    /* облака */
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      var col = cl.c ? theme.cloud2 : theme.cloud;
      var sc = cl.sc;
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(cl.x), Math.round(cl.y), 6 * sc, 2 * sc);
      ctx.fillRect(Math.round(cl.x + 2 * sc), Math.round(cl.y - 2 * sc), 4 * sc, 2 * sc);
      ctx.fillRect(Math.round(cl.x + 6 * sc), Math.round(cl.y), 3 * sc, 2 * sc);
    }
    /* остров */
    ctx.fillStyle = theme.island;
    var iw = W * 0.3, ix = W * 0.05, iy = seaY - 4;
    ctx.fillRect(Math.round(ix), Math.round(iy - 6), Math.round(iw), 6);
    ctx.fillRect(Math.round(ix + iw * 0.15), Math.round(iy - 10), Math.round(iw * 0.3), 4);
    ctx.fillRect(Math.round(ix + iw * 0.6), Math.round(iy - 8), Math.round(iw * 0.22), 2);
    /* молния */
    if (bolt) {
      ctx.fillStyle = '#dff4ff';
      for (var bl = 0; bl < bolt.pts.length; bl++) {
        ctx.fillRect(Math.round(bolt.pts[bl].x), Math.round(bolt.pts[bl].y), 2, 6);
        ctx.globalAlpha = 0.4;
        ctx.fillRect(Math.round(bolt.pts[bl].x) - 2, Math.round(bolt.pts[bl].y), 6, 2);
    ctx.globalAlpha = 1;
    /* морской дождь */
    if (rainOn) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = theme.foam;
      for (var d = 0; d < drops.length; d++) {
        var dr = drops[d];
        ctx.fillRect(Math.round(dr.x), Math.round(dr.y), 1, dr.len);
      }
      ctx.globalAlpha = 1;
    }
  }
    }
  }

  function drawSea(seaY) {
    /* градиент дном */
    var bands = theme.wave;
    var steps = 10;
    for (var i = 0; i < steps; i++) {
      var y0 = Math.round(seaY + (H - seaY) * i / steps);
      var y1 = Math.round(seaY + (H - seaY) * (i + 1) / steps);
      ctx.fillStyle = bands[Math.min(bands.length - 1, Math.floor(i / 2.5))];
      ctx.fillRect(0, y0, W, y1 - y0);
    }
    /* волны */
    for (var l = 0; l < 4; l++) {
      var base = seaY + l * ((H - seaY) / 5);
      var amp = 2 + l * 1.6;
      var freq = 0.03 - l * 0.005;
      var col = bands[l] || bands[bands.length - 1];
      ctx.fillStyle = col;
      for (var x = 0; x < W; x += 2) {
        var y = base + Math.sin(x * freq + t * (1.2 + l * 0.5)) * amp + Math.sin(x * freq * 2.7 - t * 1.6) * (amp * 0.4);
        ctx.fillRect(x, Math.round(y), 2, 2);
      }
    }
    /* пена */
    ctx.fillStyle = theme.foam;
    for (var fx = 0; fx < W; fx += 3) {
      var fy = seaY + Math.sin(fx * 0.05 + t * 2) * 1.5;
      if ((fx + Math.floor(t * 12)) % 9 < 3) ctx.fillRect(fx, Math.round(fy), 3, 1);
    }
    /* каустика */
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = theme.caustics;
    for (var cs = 0; cs < 18; cs++) {
      var cx = (cs * 137 + Math.floor(t * 20)) % W;
      var cy = seaY + ((cs * 53) % Math.max(1, (H - seaY)));
      ctx.fillRect(cx, cy, 2, 1);
    }
    ctx.globalAlpha = 1;
    /* пузыри */
    ctx.fillStyle = theme.foam;
    for (var b = 0; b < bubbles.length; b++) {
      var bb = bubbles[b];
      ctx.globalAlpha = 0.4;
      ctx.fillRect(Math.round(bb.x), Math.round(bb.y), bb.r, bb.r);
      ctx.globalAlpha = 1;
    }
  }

  function drawEntities(seaY) {
    /* бонусы на поле */
    var bl = root.CLICK ? root.CLICK.bonuses : [];
    for (var i = 0; i < bl.length; i++) {
      var b = bl[i];
      var bob = Math.sin(t * 3 + b.ph) * 2;
      var sc = 3;
      /* подсветка */
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = b.type.color;
      ctx.fillRect(Math.round(b.x - 16), Math.round(b.y - 16 + bob), 32, 32);
      ctx.globalAlpha = 1;
      var spr = SPR.get(b.type.sprite);
      ctx.drawImage(spr, Math.round(b.x - spr.width * sc / 2), Math.round(b.y - spr.height * sc / 2 + bob), spr.width * sc, spr.height * sc);
    }
    /* косатка */
    var sc2 = orca.scale;
    var sq = 1 - orca.squash * 0.18;
    var wAdd = (1 - sq) * 18 * sc2 * 0.5;
    var bobY = Math.sin(orca.bob) * 2;
    var skin = ST.skin(stateSkinPal());
    /* тень */
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000000';
    ctx.fillRect(Math.round(orca.x + wAdd), Math.round(orca.y + 12 * sc2 + 3), Math.round(16 * sc2 * sq), 2);
    ctx.globalAlpha = 1;
    /* неоновое свечение */
    if (enabled.e2) {
      ctx.globalAlpha = 0.18 + 0.08 * Math.sin(t * 4);
      ctx.fillStyle = skin === 'neon' ? '#2ee0d0' : theme.amb;
      var gw = 22 * sc2, gh = 16 * sc2;
      ctx.fillRect(Math.round(orca.x + 8 * sc2 - gw / 2), Math.round(orca.y + 7 * sc2 - gh / 2), Math.round(gw), Math.round(gh));
      ctx.globalAlpha = 1;
    }
    SPR.draw(ctx, 'orca',
      orca.x - wAdd, orca.y + bobY - (1 - sq) * 3,
      sc2, { pal: skin, outline: true, flip: false });
    /* космическая корона */
    if (skin === 'cosmo') {
      ctx.fillStyle = '#c8d0e0';
      ctx.fillRect(Math.round(orca.x + 4 * sc2), Math.round(orca.y + bobY - 2), Math.round(8 * sc2), 2);
      ctx.fillStyle = '#4ae0e0';
      ctx.fillRect(Math.round(orca.x + 5 * sc2), Math.round(orca.y + bobY - 1), Math.round(2 * sc2), 1);
    }
    /* пиратская шляпа */
    if (skin === 'pirate') {
      ctx.fillStyle = '#1a1a2a';
      ctx.fillRect(Math.round(orca.x + 9 * sc2), Math.round(orca.y + bobY - 2), Math.round(6 * sc2), 2);
      ctx.fillStyle = '#e04a5a';
      ctx.fillRect(Math.round(orca.x + 11 * sc2), Math.round(orca.y + bobY), 1, 1);
    }
    /* радужная */
    if (skin === 'rainbow') {
      var hues = ['#ff4a4a', '#ff9a4a', '#ffd447', '#4ad07a', '#4ae0e0', '#4a7ff0', '#c05ae0'];
      ctx.globalAlpha = 0.6;
      for (var q = 0; q < 7; q++) {
        ctx.fillStyle = hues[(q + Math.floor(t * 6)) % 7];
        ctx.fillRect(Math.round(orca.x + q * 3), Math.round(orca.y + 14 * sc2 + bobY), 3, 2);
      }
      ctx.globalAlpha = 1;
    }
    /* древняя — руны */
    if (skin === 'ancient') {
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3);
      ctx.fillStyle = '#5ad0a0';
      for (var rn = 0; rn < 3; rn++) {
        ctx.fillRect(Math.round(orca.x + (4 + rn * 4) * sc2), Math.round(orca.y + (5 + rn) * sc2 + bobY), 2, 1);
      }
      ctx.globalAlpha = 1;
    }
    /* пойманная рыба */
    if (caughtFish) {
      var a = 1 - caughtFish.life / caughtFish.max;
      SPR.draw(ctx, 'fish', caughtFish.x + caughtFish.vx * a * 30, caughtFish.y - caughtFish.vy * a * 30 + a * a * 40, 2, {});
    }
    /* призраки */
    ctx.globalAlpha = 0.28;
    for (var gh = 0; gh < ghosts.length; gh++) {
      SPR.draw(ctx, 'orca', ghosts[gh].x, ghosts[gh].y + Math.sin(t * 2 + gh) * 2, 3, { pal: 'cosmo', outline: false });
    }
    ctx.globalAlpha = 1;
  }

  function stateSkinPal() {
    var s = ST.skin(ST.state.skin);
    return s ? s.pal : 'normal';
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var k = p.life / p.max;
      ctx.globalAlpha = p.tw ? (0.4 + 0.6 * Math.abs(Math.sin(t * 8))) : Math.min(1, k * 1.6);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    ctx.globalAlpha = 1;
    /* кольца волн */
    for (var r = 0; r < rings.length; r++) {
      var rr = rings[r];
      ctx.globalAlpha = Math.max(0, rr.life / rr.max) * 0.7;
      ctx.strokeStyle = rr.c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(Math.round(rr.x), Math.round(rr.y), Math.round(rr.r), 0, 6.3);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawNumbers() {
    for (var i = 0; i < numbers.length; i++) {
      var n = numbers[i];
      var k = n.life / n.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      var tw = 1 + (1 - k) * 0.4;
      var sc = Math.max(1, Math.round((n.sc || 1) * tw));
      drawTextC(ctx, n.text, n.x, n.y, '#0a0c1c', sc + 1);
      drawTextC(ctx, n.text, n.x, n.y, n.c, sc);
    }
    ctx.globalAlpha = 1;
  }

  /* индикаторы баффов */
  function drawOverlay() {
    var now = Date.now();
    var buffs = [];
    if (root.CLICK) {
      if (root.CLICK.buffX2 > now) buffs.push({ t: 'x2', c: '#ffd447' });
      if (root.CLICK.buffStorm > now) buffs.push({ t: 'CRIT', c: '#e04a5a' });
    }
    if (ST.state.boostUntil > now) buffs.push({ t: 'x2', c: '#ffd447' });
    if (ST.state.rainUntil > now) buffs.push({ t: 'x1.5', c: '#7fd0ff' });
    for (var i = 0; i < buffs.length; i++) {
      var bx = 4, by = 4 + i * 9;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(bx - 2, by - 2, textW(buffs[i].t, 1) + 6, 11);
      drawText(ctx, buffs[i].t, bx, by, buffs[i].c, 1);
    }
    /* комбо */
    if (root.CLICK && root.CLICK.combo > 2) {
      var c = root.CLICK.combo;
      drawTextC(ctx, 'x' + c, W / 2, 6, c >= 25 ? '#ff8a3a' : '#4ae0e0', c >= 25 ? 2 : 1);
    }
  }

  function syncEnabled() {
    for (var i = 0; i < D.EFFECTS.length; i++) {
      var e = D.EFFECTS[i];
      enabled[e.id] = ST.effectOn(e.id);
    }
  }

  root.FX = {
    init: init, resize: resize, setTheme: setTheme, setPixelScale: setPixelScale,
    clickFx: clickFx, bonusFx: bonusFx, pulseBonus: pulseBonus, fishDrop: fishDrop,
    rain: rain,
    tick: function () { syncEnabled(); },
    drawText: drawText, drawTextC: drawTextC, textW: textW, FONT: FONT,
    get themes() { return THEMES; },
    get themeKey() { return themeKey; },
    get size() { return { w: W, h: H, px: PX }; },
    get canvas() { return cv; },
    get orca() { return orca; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
