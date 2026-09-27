/* ============================================================
   PIXEL ORCA — кликер: комбо, криты, бонусы на поле
   ============================================================ */
(function (root) {
  'use strict';

  var ST = root.ST, D = root.DATA, UI = root.UI;
  var canvas = null;

  var combo = 0, comboTimer = 0, comboMax = 0;
  var clickTimes = [];
  var buffX2 = 0, buffRain = 0, buffStorm = 0;
  var bonusList = [], bonusTimer = 15000;
  var battleMode = false, battleCallback = null;
  var lastGain = 0, lastCrit = false;

  var COMBO_WINDOW = 1600;
  var BONUS_FIRST = 12000, BONUS_MIN = 22000, BONUS_MAX = 48000;

  function init(cv) {
    canvas = cv;
    cv.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      handleClick(e);
    });
    /* клавиатура: пробел = клик (для ПК) */
    document.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      if (document.body.classList.contains('modal-open')) return;
      if (/input|textarea/i.test((e.target.tagName || ''))) return;
      e.preventDefault();
      doClick(0, 0);
    });
  }

  function handleClick(e) {
    var r = canvas.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * canvas.width;
    var y = (e.clientY - r.top) / r.height * canvas.height;
    /* бонус в радиусе? */
    for (var i = bonusList.length - 1; i >= 0; i--) {
      var b = bonusList[i];
      if (Math.abs(b.x - x) < b.r && Math.abs(b.y - y) < b.r) {
        collectBonus(b, x, y);
        return;
      }
    }
    doClick(x, y);
  }

  function doClick(x, y) {
    if (battleMode) {
      if (battleCallback) battleCallback();
      return;
    }
    ST.resume && ST.resume();
    root.SND.play('click');
    root.SND.resume();

    var now = Date.now();
    if (now - comboTimer < COMBO_WINDOW) combo++;
    else combo = 1;
    comboTimer = now;
    comboMax = Math.max(comboMax, combo);
    ST.state.stats.bestCombo = Math.max(ST.state.stats.bestCombo, comboMax);

    clickTimes.push(now);
    var s = ST.state.stats;
    s.clicks++;
    ST.bump('clicks');
    ST.bump('clicksDaily');

    var isCrit = Math.random() < ST.critChance();
    var gain = ST.perClick(combo);
    if (isCrit) {
      gain *= ST.critMult();
      s.crits++;
      ST.bump('crits');
      root.SND.play('crit');
    }
    var n = ST.addCoins(gain);
    if (n > s.bestPerClick) s.bestPerClick = n;
    lastGain = n; lastCrit = isCrit;

    root.FX.clickFx(x, y, n, isCrit, combo);
    if (ST.state.settings.shake && (isCrit || combo % 25 === 0)) UI.shake(canvas, isCrit ? 8 : 4);

    if (ST.clickTickets()) ST.addTickets(1);

    /* крит-дроп: редко косатка роняет рыбу */
    if (isCrit && Math.random() < 0.12) {
      ST.addFish(1);
      root.FX.fishDrop();
    }
    if (combo % 50 === 0) {
      UI.banner('КОМБО x' + combo, 'banner-combo', 900);
    }
    if (root.QUESTS) root.QUESTS.check();
  }

  /* ---------- бонусы на поле ---------- */
  function spawnBonus() {
    var pool = D.FIELD_BONUSES.slice();
    var type = pool[Math.floor(Math.random() * pool.length)];
    var w = canvas.width, h = canvas.height;
    bonusList.push({
      type: type,
      x: 60 + Math.random() * (w - 120),
      y: h * 0.18 + Math.random() * (h * 0.5),
      r: 30,
      born: Date.now(),
      life: 9000,
      ph: Math.random() * 6.28
    });
    root.FX.pulseBonus();
  }

  function collectBonus(b, x, y) {
    var i = bonusList.indexOf(b);
    if (i >= 0) bonusList.splice(i, 1);
    var s = ST.state.stats;
    var gained = 0;
    if (b.type.id === 'x2') {
      buffX2 = Date.now() + b.type.dur;
      ST.state.boostUntil = Math.max(ST.state.boostUntil, buffX2);
      UI.banner('x2 ДОХОД 30 СЕК', 'banner-good', 1200);
    } else if (b.type.id === 'rain') {
      buffRain = Date.now() + b.type.dur;
      UI.banner('ДОЖДЬ x3 15 СЕК', 'banner-good', 1200);
    } else if (b.type.id === 'storm') {
      buffStorm = Date.now() + b.type.dur;
      UI.banner('ШТОРМ КРИТОВ', 'banner-good', 1200);
    } else if (b.type.id === 'school') {
      ST.addFish(5);
      UI.banner('+5 РЫБ', 'banner-good', 900);
    } else if (b.type.id === 'shell') {
      ST.addShells(1);
      UI.banner('+1 РАКУШКА', 'banner-good', 900);
    }
    root.SND.play('bonus');
    root.FX.bonusFx(b.type.color, x || b.x, y || b.y);
    ST.save();
  }

  function tick(dt) {
    var now = Date.now();
    if (comboTimer && now - comboTimer > COMBO_WINDOW) combo = 0;

    clickTimes = clickTimes.filter(function (t) { return now - t < 1000; });
    var cps = clickTimes.length;
    if (cps > ST.state.stats.bestCps) {
      ST.state.stats.bestCps = cps;
      ST.bump('bestCps');
    }
    if (now > buffX2) buffX2 = 0;
    if (now > buffRain) buffRain = 0;
    if (now > buffStorm) buffStorm = 0;

    if (!battleMode) {
      bonusTimer -= dt;
      if (bonusTimer <= 0) {
        spawnBonus();
        bonusTimer = BONUS_MIN + Math.random() * (BONUS_MAX - BONUS_MIN);
      }
    }
    for (var i = bonusList.length - 1; i >= 0; i--) {
      if (now - bonusList[i].born > bonusList[i].life) {
        bonusList.splice(i, 1);
      }
    }
  }

  root.CLICK = {
    init: init,
    tick: tick,
    spawnBonus: spawnBonus,
    get combo() { return combo; },
    get comboMax() { return comboMax; },
    get cps() { return clickTimes.length; },
    get bonuses() { return bonusList; },
    get buffX2() { return buffX2; },
    get buffRain() { return buffRain; },
    get buffStorm() { return buffStorm; },
    get lastGain() { return lastGain; },
    get battleMode() { return battleMode; },
    set battleMode(v) { battleMode = !!v; },
    set battleCallback(v) { battleCallback = v; },
    doClick: doClick,
    resetCombo: function () { combo = 0; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
