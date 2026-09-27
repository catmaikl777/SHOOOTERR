/* ============================================================
   PIXEL ORCA — магазин: улучшения, скины, боксы, престиж
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, SPR = root.PO_SPR;
  var rolling = false;

  function init() { }

  /* ---------- вкладки ---------- */
  function showTab(name) {
    var map = { upgrades: 'shopUpgrades', skins: 'shopSkins', boxes: 'shopBoxes', fx: 'shopEffects' };
    for (var k in map) {
      var e = document.getElementById(map[k]);
      if (e) e.style.display = k === name ? '' : 'none';
    }
    render(name);
  }

  function render(tab) {
    var s = ST.state;
    var coinsEl = document.getElementById('shopCoins');
    if (coinsEl) coinsEl.textContent = ST.fmt(s.coins);
    var tabName = tab || (document.querySelector('#shop .px-tab.active') || {}).dataset?.tab || 'upgrades';
    if (tabName === 'upgrades') renderUpgrades();
    else if (tabName === 'skins') renderSkins();
    else if (tabName === 'boxes') renderBoxes();
    else if (tabName === 'fx') renderEffects();
  }

  /* ---------- улучшения ---------- */
  function renderUpgrades() {
    var box = document.getElementById('shopUpgrades');
    if (!box) return;
    var html = '';
    for (var i = 0; i < D.UPGRADES.length; i++) {
      var u = D.UPGRADES[i];
      var lvl = ST.up(u.id);
      var cost = ST.upgradeCost(u.id);
      var afford = ST.state.coins >= cost;
      html += '<div class="px-card up-card' + (afford ? ' afford' : '') + '" data-up="' + u.id + '">' +
        '<div class="up-ic">' + SPRHTML(u.icon, 2) + '</div>' +
        '<div class="up-info">' +
        '<div class="up-name">' + u.name + '<span class="up-lvl">ур. ' + lvl + '</span></div>' +
        '<div class="up-desc">' + u.desc + '</div>' +
        '<div class="up-eff">сейчас: ' + currentEffect(u) + '</div>' +
        '</div>' +
        '<div class="up-buy">' +
        '<button class="px-btn px-btn-small" data-act="buy1" data-id="' + u.id + '"' + (afford ? '' : ' disabled') + '>' + ST.fmt(cost) + '</button>' +
        '<button class="px-btn px-btn-small px-btn-alt" data-act="buy10" data-id="' + u.id + '"' + (afford ? '' : ' disabled') + '>x10</button>' +
        '<button class="px-btn px-btn-small px-btn-alt" data-act="buymax" data-id="' + u.id + '"' + (afford ? '' : ' disabled') + '>MAX</button>' +
        '</div></div>';
    }
    box.innerHTML = html;
  }

  function currentEffect(u) {
    var lvl = ST.up(u.id);
    switch (u.kind) {
      case 'clickFlat': return '+' + (lvl * u.val) + ' к клику';
      case 'clickMult': return '×' + Math.pow(u.val, lvl).toFixed(2);
      case 'cpsAdd': return '+' + ST.fmt(lvl * u.val) + '/сек';
      case 'critAdd': return (5 + lvl * u.val).toFixed(0) + '% крит';
      case 'critDmg': return '×' + (3 + lvl * u.val).toFixed(2) + ' крит';
      case 'comboAdd': return 'x' + (1 + lvl * u.val * 0.5).toFixed(1) + ' комбо';
      case 'luckAdd': return '+' + (lvl * u.val * 100).toFixed(0) + '% лут';
      case 'allMult': return '×' + Math.pow(u.val, lvl).toFixed(2);
      case 'fishMult': return '×' + (1 + lvl * u.val).toFixed(2) + ' рыба';
      case 'ticketDiv': return lvl ? 'билет/' + u.val + ' кликов' : 'билет/100 кликов';
      default: return 'lvl ' + lvl;
    }
  }

  function buy(id, mode) {
    var ok, res = null;
    if (mode === '1') ok = ST.buyUpgrade(id);
    else res = ST.buyMax(id, mode === '10' ? 10 : 1000);
    if (ok || (res && res.bought)) {
      root.SND.play('buy');
      if (res && res.bought > 1) UI.toast('Куплено x' + res.bought, 'good', 'i_coin');
      render();
      if (root.QUESTS) root.QUESTS.check();
    } else {
      root.SND.play('deny');
      UI.toast('Не хватает косаток', 'bad', 'i_coin');
    }
  }

  /* ---------- скины ---------- */
  function renderSkins() {
    var box = document.getElementById('shopSkins');
    if (!box) return;
    var html = '';
    for (var i = 0; i < D.SKINS.length; i++) {
      var s = D.SKINS[i];
      var owned = ST.state.skinsOwned.indexOf(s.id) >= 0;
      var eq = ST.state.skin === s.id;
      var locked = !owned && !s.cost;
      var label = owned ? (eq ? 'НАДЕТ' : 'НАДЕТЬ') : locked ? lockLabel(s) : ST.fmt(s.cost);
      html += '<div class="px-card skin-card' + (eq ? ' equipped' : '') + (locked ? ' locked' : '') + '">' +
        '<div class="skin-art">' + orcaHTML(s.pal, 4) + '</div>' +
        '<div class="skin-meta">' +
        '<div class="skin-name">' + s.name + ' ' + UI.rarityBadge(s.rar) + '</div>' +
        '<div class="skin-desc">' + s.desc + '</div>' +
        '<div class="skin-bonus">+' + (s.bonus * 100).toFixed(0) + '% к доходу</div>' +
        '<button class="px-btn px-btn-small" data-act="skin" data-id="' + s.id + '"' + (((!owned && (!s.cost || ST.state.coins < s.cost)) || (owned && eq)) ? ' disabled' : '') + '>' + label + '</button>' +
        '</div></div>';
    }
    box.innerHTML = html;
  }
  function lockLabel(s) {
    if (s.box) return 'Из бокса: ' + D.BOXES.filter(function (b) { return b.id === s.box; }).map(function (b) { return b.name; })[0];
    if (s.event) return 'Награда за ивент';
    if (s.raid) return s.raid + ' побед в рейде';
    if (s.prestige) return 'Первый сброс в океан';
    return 'Недоступно';
  }
  function skinClick(id) {
    var owned = ST.state.skinsOwned.indexOf(id) >= 0;
    if (owned) {
      ST.equipSkin(id);
      root.SND.play('ui');
      UI.toast('Скин надет', 'good', 'i_crown');
    } else {
      var s = ST.skin(id);
      if (!s || !s.cost) { UI.toast('Этот скин ещё не открыт', 'bad', 'i_lock'); return; }
      if (ST.buySkin(id)) {
        root.SND.play('levelUp');
        UI.banner('НОВЫЙ ОБЛИК!', 'banner-good', 1200);
        UI.toast('Куплен скин: ' + s.name, 'good', 'i_crown');
      } else {
        root.SND.play('deny');
        UI.toast('Не хватает косаток', 'bad', 'i_coin');
      }
    }
    render();
  }

  /* ---------- боксы ---------- */
  function renderBoxes() {
    var box = document.getElementById('shopBoxes');
    if (!box) return;
    var html = '';
    for (var i = 0; i < D.BOXES.length; i++) {
      var b = D.BOXES[i];
      var afford = ST.state.coins >= b.cost;
      html += '<div class="px-card box-card">' +
        '<div class="box-art">' + SPRHTML(b.sprite, 3) + '</div>' +
        '<div class="box-meta">' +
        '<div class="box-name">' + b.name + ' ' + UI.rarityBadge(b.rar) + '</div>' +
        '<div class="box-desc">' + b.desc + '</div>' +
        '<button class="px-btn px-btn-primary" data-act="box" data-id="' + b.id + '"' + (afford ? '' : ' disabled') + '>' +
        (afford ? 'ОТКРЫТЬ · ' + ST.fmt(b.cost) : ST.fmt(b.cost) + ' ❤') + '</button>' +
        '</div></div>';
    }
    box.innerHTML = html;
  }

  function rollLoot(b) {
    var luck = ST.luck();
    var total = 0, i;
    for (i = 0; i < b.loot.length; i++) total += b.loot[i].w;
    var r = Math.random() * total * (1 / Math.min(1.6, luck));
    var acc = 0, pick = b.loot[b.loot.length - 1];
    for (i = 0; i < b.loot.length; i++) {
      acc += b.loot[i].w;
      if (r <= acc) { pick = b.loot[i]; break; }
    }
    var min = pick.min == null ? 0 : pick.min;
    var max = pick.max == null ? 0 : pick.max;
    var amount = min + Math.floor(Math.random() * (max - min + 1));
    var rewards = [];
    if (pick.t === 'coins') {
      var c = Math.floor(b.cost * (min + Math.random() * (max - min)) * 0.5);
      rewards.push({ t: 'coins', v: c, label: ST.fmt(c) + ' косаток' });
      ST.addCoins(c);
    } else if (pick.t === 'fish') {
      ST.addFish(amount);
      rewards.push({ t: 'fish', v: amount, label: amount + ' рыб' });
    } else if (pick.t === 'shells') {
      ST.addShells(amount);
      rewards.push({ t: 'shells', v: amount, label: amount + ' ракушек' });
    } else if (pick.t === 'xp') {
      ST.addXp(amount);
      rewards.push({ t: 'xp', v: amount, label: '+' + amount + ' опыта' });
    } else if (pick.t === 'ticket') {
      ST.addTickets(amount);
      rewards.push({ t: 'ticket', v: amount, label: amount + ' билет(ов) ивента' });
    } else if (pick.t === 'effect') {
      var pool = D.EFFECTS.filter(function (e) { return !ST.hasEffect(e.id); });
      if (pool.length) {
        var e = pool[Math.floor(Math.random() * pool.length)];
        ST.unlockEffect(e.id);
        rewards.push({ t: 'effect', v: e.name, label: 'Эффект: ' + e.name, big: true });
      } else {
        var c2 = Math.floor(b.cost * 0.4);
        ST.addCoins(c2);
        rewards.push({ t: 'coins', v: c2, label: ST.fmt(c2) + ' косаток (все эффекты есть)' });
      }
    } else if (pick.t === 'skin') {
      var pool2 = pick.pool.filter(function (id) { return ST.state.skinsOwned.indexOf(id) < 0; });
      if (pool2.length) {
        var sid = pool2[Math.floor(Math.random() * pool2.length)];
        ST.unlockSkin(sid);
        rewards.push({ t: 'skin', v: ST.skin(sid).name, label: 'Скин: ' + ST.skin(sid).name, big: true });
      } else {
        var c3 = Math.floor(b.cost * 0.3);
        ST.addCoins(c3);
        rewards.push({ t: 'coins', v: c3, label: ST.fmt(c3) + ' косаток (скины уже есть)' });
      }
    }
    return rewards;
  }

  function openBox(id) {
    if (rolling) return;
    var b = null;
    for (var i = 0; i < D.BOXES.length; i++) if (D.BOXES[i].id === id) b = D.BOXES[i];
    if (!b) return;
    if (ST.state.coins < b.cost) { root.SND.play('deny'); UI.toast('Не хватает косаток', 'bad', 'i_coin'); return; }
    ST.spend(b.cost);
    rolling = true;
    root.SND.play('box');
    ST.state.stats.boxesOpened++;
    ST.bump('boxesOpened');
    ST.bump('boxesOpenedDaily');

    var m = UI.modalShell('ОТКРЫВАЕМ...', '<div class="box-open-stage" id="boxStage">' +
      '<div class="box-shake">' + SPRHTML(b.sprite, 5) + '</div>' +
      '<div class="box-shine"></div></div>');
    setTimeout(function () {
      var rewards = rollLoot(b);
      var big = rewards.some(function (r) { return r.big; });
      if (big) root.SND.play('rare');
      var html = '<div class="loot-list' + (big ? ' big-loot' : '') + '">';
      for (var j = 0; j < rewards.length; j++) {
        html += lootRow(rewards[j]);
      }
      html += '</div>';
      m.querySelector('.px-modal-body').innerHTML =
        '<div class="loot-box">' + SPRHTML(b.sprite, 3) + '</div>' + html;
      rolling = false;
      if (big) {
        UI.banner('РЕДКИЙ ДРОП!', 'banner-rare', 1400);
        FXcelebrate();
      }
      render();
      if (root.QUESTS) root.QUESTS.check();
    }, 1400);
  }

  function FXcelebrate() {
    var fx = root.FX;
    for (var i = 0; i < 40; i++) {
      var a = Math.random() * 6.28;
      root.FX.clickFx(fx.size.w / 2, fx.size.h * 0.4, 0, true, 0);
    }
  }

  function lootRow(r) {
    var icon = { coins: 'coin', fish: 'fish', shells: 'shell', xp: 'i_star', ticket: 'ticket', effect: 'i_star', skin: 'orca' }[r.t] || 'coin';
    return '<div class="loot-row' + (r.big ? ' loot-big' : '') + '">' +
      '<span class="loot-ic">' + SPRHTML(icon, 2) + '</span>' +
      '<span class="loot-label">' + r.label + '</span></div>';
  }

  /* ---------- эффекты ---------- */
  function renderEffects() {
    var box = document.getElementById('shopEffects');
    if (!box) return;
    var html = '';
    for (var i = 0; i < D.EFFECTS.length; i++) {
      var e = D.EFFECTS[i];
      var owned = ST.hasEffect(e.id);
      html += '<div class="px-card fx-card' + (owned ? '' : ' locked') + '">' +
        '<div class="fx-ic">' + SPRHTML(e.icon, 2) + '</div>' +
        '<div><div class="fx-name">' + e.name + ' ' + UI.rarityBadge(e.rar) + '</div>' +
        '<div class="fx-desc">' + e.desc + '</div>' +
        '<div class="fx-state">' + (owned ? (ST.state.effectsOn[e.id] ? 'ВКЛ' : 'ВЫКЛ') : 'нет в коллекции') + '</div></div></div>';
    }
    box.innerHTML = html;
  }

  /* ---------- престиж ---------- */
  function renderPrestige(box) {
    if (!box) return;
    var gain = ST.prestigeGain();
    var shells = ST.state.shells;
    box.innerHTML =
      '<div class="prestige-top">' +
      '<div class="pr-cell"><span>Ракушек</span><b>' + SPRHTML('shell', 2) + ' ' + shells + '</b></div>' +
      '<div class="pr-cell"><span>Бонус за ракушку</span><b>+' + (D.PRESTIGE.perShell * 100).toFixed(0) + '%</b></div>' +
      '<div class="pr-cell"><span>Всего бонус</span><b>×' + ST.shellMult().toFixed(2) + '</b></div>' +
      '</div>' +
      '<p class="dialog-text">Сброс обнуляет косаток, рыбу, улучшения, уровень и опыт, но оставляет ракушки, скины, эффекты, достижения и статистику. Каждая ракушка навсегда +' + (D.PRESTIGE.perShell * 100).toFixed(0) + '% ко всему доходу.</p>' +
      '<div class="pr-gain">За сброс сейчас: <b>' + gain + ' ' + SPRHTML('shell', 2) + '</b></div>' +
      '<button class="px-btn px-btn-danger" id="prestigeBtn"' + (gain > 0 ? '' : ' disabled') + '>СБРОСИТЬ В ОКЕАН</button>';
    var btn = document.getElementById('prestigeBtn');
    if (btn) {
      btn.addEventListener('click', function () {
        UI.confirm('Сбросить прогресс?', 'Ты получишь ' + gain + ' ракушек. Косатки, рыба и улучшения сбросятся.', 'Сбросить').then(function (yes) {
          if (!yes) return;
          var got = ST.doPrestige();
          root.SND.play('prestige');
          UI.banner('+' + got + ' РАКУШЕК', 'banner-rare', 1800);
          root.FX.setPixelScale(ST.state.settings.pixelScale);
          renderPrestige(box);
        });
      });
    }
  }

  /* ---------- хелперы для DOM ---------- */
  function SPRHTML(name, sc) {
    var c = SPR.get(name);
    return '<canvas class="px-icon" width="' + (c.width * sc) + '" height="' + (c.height * sc) +
      '" style="width:' + (c.width * sc) + 'px;height:' + (c.height * sc) + 'px" data-spr="' + name + '" data-sc="' + sc + '"></canvas>';
  }
  function orcaHTML(pal, sc) {
    var c = SPR.get('orca', pal);
    return '<canvas class="px-icon orca-icon" width="' + (c.width * sc) + '" height="' + (c.height * sc) +
      '" style="width:' + (c.width * sc) + 'px;height:' + (c.height * sc) + 'px" data-spr="orca" data-pal="' + pal + '" data-sc="' + sc + '"></canvas>';
  }
  /* рисует все <canvas data-spr> внутри контейнера */
  function paintIcons(ctx) {
    UI.$$('canvas[data-spr]', ctx || document).forEach(function (c) {
      if (c.dataset.painted) return;
      var g = c.getContext('2d');
      g.imageSmoothingEnabled = false;
      SPR.draw(g, c.dataset.spr, 0, 0, parseInt(c.dataset.sc || '2', 10), { pal: c.dataset.pal || null, outline: true });
      c.dataset.painted = '1';
    });
  }

  function initClicks() {
    var shop = document.getElementById('shop');
    if (!shop) return;
    shop.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.dataset.act;
      if (act === 'buy1') buy(b.dataset.id, '1');
      else if (act === 'buy10') buy(b.dataset.id, '10');
      else if (act === 'buymax') buy(b.dataset.id, 'max');
      else if (act === 'skin') skinClick(b.dataset.id);
      else if (act === 'box') openBox(b.dataset.id);
    });
    shop.addEventListener('click', function (e) {
      var t = e.target.closest('[data-tab]');
      if (t) showTab(t.dataset.tab);
    });
  }

  function tick() {
    /* мягкое обновление цен, пока магазин открыт */
    if (!UI.isOpen('shop')) return;
    var box = document.getElementById('shopUpgrades');
    var coinsEl = document.getElementById('shopCoins');
    if (coinsEl) coinsEl.textContent = ST.fmt(ST.state.coins);
    if (!box || !box.style.display === false) return;
    for (var i = 0; i < D.UPGRADES.length; i++) {
      var u = D.UPGRADES[i];
      var el = box.querySelector('[data-up="' + u.id + '"]');
      if (!el) continue;
      var cost = ST.upgradeCost(u.id);
      var lvl = ST.up(u.id);
      if (el.dataset.cost !== String(cost)) {
        el.dataset.cost = String(cost);
        var b = el.querySelector('[data-act="buy1"]');
        if (b) b.textContent = ST.fmt(cost);
        var l = el.querySelector('.up-lvl');
        if (l) l.textContent = 'ур. ' + lvl;
      }
      var aff = ST.state.coins >= cost;
      if (el.dataset.aff !== String(aff)) {
        el.dataset.aff = String(aff);
        el.classList.toggle('afford', aff);
        el.querySelectorAll('button').forEach(function (x) { x.disabled = !aff; });
      }
    }
  }

  root.SHOP = {
    init: init, initClicks: initClicks, showTab: showTab, render: render,
    openBox: openBox, rollLoot: rollLoot, renderPrestige: renderPrestige,
    paintIcons: paintIcons, tick: tick, SPRHTML: SPRHTML, orcaHTML: orcaHTML
  };
})(typeof window !== 'undefined' ? window : globalThis);
