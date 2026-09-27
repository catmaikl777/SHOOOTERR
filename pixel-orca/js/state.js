/* ============================================================
   PIXEL ORCA — состояние, формулы, сохранение
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA;
  var KEY = 'pixel-orca-save-v3';
  var state = D.freshState();
  var listeners = [];
  var lastTick = Date.now();
  var offlineInfo = null;

  /* ---------- форматирование ---------- */
  var SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  function fmt(n) {
    n = Number(n) || 0;
    if (n < 0) return '-' + fmt(-n);
    if (n < 1000) return n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
    var tier = Math.floor(Math.log10(n) / 3);
    if (tier >= SUFFIX.length) tier = SUFFIX.length - 1;
    var v = n / Math.pow(1000, tier);
    var d = v < 10 ? 2 : v < 100 ? 1 : 0;
    return v.toFixed(d).replace(/\.?0+$/, '') + SUFFIX[tier];
  }
  function fmtTime(ms) {
    if (ms <= 0) return '0с';
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    if (d > 0) return d + 'д ' + h + 'ч';
    if (h > 0) return h + 'ч ' + m + 'м';
    if (m > 0) return m + 'м ' + ss + 'с';
    return ss + 'с';
  }
  function fmtFullTime(ms) {
    var s = Math.floor(ms / 1000);
    return Math.floor(s / 3600) + 'ч ' + Math.floor(s % 3600 / 60) + 'м';
  }

  /* ---------- загрузка / сохранение ---------- */
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        state = merge(D.freshState(), parsed);
      } catch (e) { state = D.freshState(); }
    }
    calcOffline();
    return state;
  }
  function merge(base, over) {
    for (var k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      var v = over[k];
      if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
        base[k] = merge(base[k], v);
      } else {
        base[k] = v;
      }
    }
    return base;
  }
  var saveDirty = false, saveTimer = null;
  function save(force) {
    state.lastSave = Date.now();
    saveDirty = true;
    if (force) flush();
    else if (!saveTimer) saveTimer = setTimeout(flush, 1500);
  }
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      saveDirty = false;
      return true;
    } catch (e) { return false; }
  }
  function reset() {
    state = D.freshState();
    try { localStorage.removeItem(KEY); } catch (e) {}
    emit('reset');
    save(true);
  }

  /* ---------- формулы ---------- */
  function up(id) { return state.upgrades[id] || 0; }
  function totalUpgrades() { var t = 0; for (var k in state.upgrades) t += state.upgrades[k]; return t; }

  function skinBonus() {
    for (var i = 0; i < D.SKINS.length; i++) if (D.SKINS[i].id === state.skin) return D.SKINS[i].bonus;
    return 0;
  }
  function levelMult() { return 1 + 0.02 * (state.level - 1); }
  function shellMult() { return 1 + D.PRESTIGE.perShell * state.shells; }
  function clanMult() {
    var b = root.API && root.API.clanBonus ? root.API.clanBonus() : 0;
    return 1 + b;
  }
  function boostMult() {
    var m = 1;
    if (state.boostUntil > Date.now()) m *= 2;
    if (state.rainUntil > Date.now()) m *= 1.5;   /* дождевой бафф (ивент) */
    return m;
  }
  function allMult() {
    return levelMult() * shellMult() * clanMult() * Math.pow(1.03, up('tide'));
  }

  function perClick(combo) {
    var flat = 1 + up('fin') * 1 + up('voice') * 2 + up('echo') * 5;
    var mult = Math.pow(1.4, up('power')) * Math.pow(1.35, up('claw'));
    var v = flat * mult * allMult() * (1 + skinBonus());
    v *= comboMult(combo);
    v *= boostMult();
    return v;
  }
  function perSecond() {
    var cps = up('mini') * 0.5 + up('hunter') * 2 + up('drone') * 8 + up('fleet') * 30;
    return cps * allMult() * (1 + skinBonus()) * boostMult();
  }
  function comboMult(combo) {
    if (!combo) combo = root.CLICK ? root.CLICK.combo : 0;
    var lvl = up('combo');
    return 1 + Math.min(combo, 50) * 0.01 * (1 + lvl * 0.5);
  }
  function critChance() {
    var c = 0.05 + up('crit') * 0.02;
    if (root.CLICK && root.CLICK.buffStorm) c = 1;
    return Math.min(1, c);
  }
  function critMult() {
    return (3 + up('rage') * 0.25) * (1 + 0.25 * (state.level - 1) * 0.1);
  }
  function fishValue() {
    return 100 * state.level * (1 + up('magnet')) * shellMult();
  }
  function luck() {
    return 1 + up('luck') * 0.05;
  }

  function xpNeed(level) {
    return Math.floor(60 * Math.pow(level, 1.55));
  }
  function rank() {
    var r = D.RANKS[0].name;
    for (var i = 0; i < D.RANKS.length; i++) if (state.level >= D.RANKS[i].lvl) r = D.RANKS[i].name;
    return r;
  }

  function upgradeCost(id) {
    var u = null;
    for (var i = 0; i < D.UPGRADES.length; i++) if (D.UPGRADES[i].id === id) u = D.UPGRADES[i];
    if (!u) return Infinity;
    return Math.ceil(u.cost * Math.pow(u.growth, up(id)));
  }
  function buyUpgrade(id) {
    var cost = upgradeCost(id);
    if (state.coins < cost) return false;
    state.coins -= cost;
    state.upgrades[id] = up(id) + 1;
    state.stats.upgradesBought++;
    bump('upgradesBought');
    bump('upgradesBoughtDaily');
    save();
    emit('upgrade', id);
    return true;
  }
  function buyMax(id, count) {
    var bought = 0, spent = 0;
    for (var i = 0; i < (count || 1000); i++) {
      var c = upgradeCost(id);
      if (state.coins < c) break;
      state.coins -= c; spent += c; bought++;
      state.upgrades[id] = up(id) + 1;
    }
    if (bought) {
      state.stats.upgradesBought += bought;
      bump('upgradesBought', bought);
      bump('upgradesBoughtDaily', bought);
      save();
      emit('upgrade', id);
      return { bought: bought, spent: spent };
    }
    return { bought: 0, spent: 0 };
  }

  function buySkin(id) {
    var s = skin(id);
    if (!s || state.skinsOwned.indexOf(id) >= 0) return false;
    if (s.box || s.event || s.raid || s.prestige) return false;
    if (state.coins < s.cost) return false;
    state.coins -= s.cost;
    state.skinsOwned.push(id);
    state.stats.skinsBought++;
    bump('skinsBought');
    state.skin = id;
    save();
    emit('skin', id);
    return true;
  }
  function equipSkin(id) {
    if (state.skinsOwned.indexOf(id) < 0) return false;
    state.skin = id;
    save();
    emit('skin', id);
    return true;
  }
  function unlockSkin(id) {
    if (state.skinsOwned.indexOf(id) >= 0) return false;
    state.skinsOwned.push(id);
    bump('skinsUnlocked');
    save();
    emit('unlock', 'skin:' + id);
    return true;
  }
  function skin(id) {
    for (var i = 0; i < D.SKINS.length; i++) if (D.SKINS[i].id === id) return D.SKINS[i];
    return null;
  }
  function unlockEffect(id) {
    if (state.effectsOwned.indexOf(id) >= 0) return false;
    state.effectsOwned.push(id);
    bump('effectsUnlocked');
    save();
    emit('unlock', 'effect:' + id);
    return true;
  }
  function hasEffect(id) { return state.effectsOwned.indexOf(id) >= 0; }
  function effectOn(id) {
    return state.settings.effectsAll && state.effectsOn[id] && hasEffect(id);
  }

  function addCoins(n, xpskip) {
    if (n <= 0) return 0;
    state.coins += n;
    state.totalCoins += n;
    if (!xpskip) addXp(n * 0.06);
    save();
    return n;
  }
  function spend(n) {
    if (state.coins < n) return false;
    state.coins -= n;
    save();
    return true;
  }
  function addXp(n) {
    state.xp += n;
    var leveled = 0;
    while (state.xp >= xpNeed(state.level)) {
      state.xp -= xpNeed(state.level);
      state.level++;
      leveled++;
      bump('level');
    }
    if (leveled) {
      save();
      emit('levelup', state.level);
    }
    return leveled;
  }
  function addFish(n) {
    state.fish += n;
    if (n > 0) { bump('fishCaught', n); bump('fishCaughtDaily', n); }
    save();
  }
  function addShells(n) {
    state.shells += n;
    state.stats.shellsTotal += n;
    bump('shellsTotal');
    save();
    emit('unlock', 'shells:' + n);
  }
  function exchangeFish() {
    if (state.fish <= 0) return 0;
    var val = Math.floor(state.fish * fishValue());
    var n = state.fish;
    state.fish = 0;
    bump('exchanges', 1);
    bump('exchangesDaily', 1);
    addCoins(val);
    save();
    return { fish: n, coins: val };
  }

  function clickTickets() {
    var div = up('ticket') > 0 ? up('ticket') : D.EVENT.clickDiv;
    return state.stats.clicks % div === 0 && state.stats.clicks > 0;
  }
  function addTickets(n) {
    state.eventTickets += n;
    state.stats.ticketsTotal += n;
    bump('ticketsTotal');
    save();
    emit('tickets', n);
  }

  /* ---------- престиж ---------- */
  function prestigeGain() {
    if (state.totalCoins < 1e5) return 0;
    return Math.floor(Math.pow(state.totalCoins / 1e6, D.PRESTIGE.exp) * D.PRESTIGE.base);
  }
  function canPrestige() { return prestigeGain() > 0; }
  function doPrestige() {
    var gain = prestigeGain();
    if (gain <= 0) return 0;
    state.prestiges++;
    state.coins = 0;
    state.totalCoins = 0;
    state.fish = 0;
    state.xp = 0;
    state.level = 1;
    state.upgrades = {};
    addShells(gain);
    if (D.SKINS.some(function (s) { return s.prestige; })) unlockSkin('ancient');
    state.questIndex = Math.min(state.questIndex, D.QUESTS.length - 1);
    save();
    emit('prestige', gain);
    return gain;
  }

  /* ---------- оффлайн-доход ---------- */
  function calcOffline() {
    var away = Date.now() - (state.lastSave || Date.now());
    offlineInfo = null;
    if (away < 60000 || state.coins < 0) return 0;
    var rate = perSecond();
    if (rate <= 0) return 0;
    var capped = Math.min(away, 8 * 3600 * 1000);
    var gain = Math.floor(rate * capped / 1000);
    if (gain <= 0) return 0;
    offlineInfo = { ms: away, capped: capped, coins: gain };
    addCoins(gain * 0.5, true);
    state.stats.offlineEarned += gain * 0.5;
    return gain;
  }

  /* ---------- трекер для квестов/достижений ---------- */
  function bump(stat, by) {
    if (root.QUESTS) root.QUESTS.onStat(stat, by || 1);
  }
  function statValue(name) {
    switch (name) {
      case 'level': return state.level;
      case 'totalCoins': return state.totalCoins;
      case 'bestCps': return state.stats.bestCps;
      case 'bestPerClick': return state.stats.bestPerClick;
      case 'clicksDaily': return state.dailyProgress.clicksDaily || 0;
      default: return state.stats[name] || 0;
    }
  }

  /* ---------- события ---------- */
  function on(fn) { listeners.push(fn); }
  function emit(type, data) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](type, data); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- тик (пассивный доход) ---------- */
  function tick() {
    var now = Date.now();
    var dt = Math.min(5000, now - lastTick);
    lastTick = now;
    state.playTime += dt;
    var rate = perSecond();
    if (rate > 0) {
      addCoins(rate * dt / 1000, true);
      state.stats.bestPerSec = Math.max(state.stats.bestPerSec, rate);
    }
    if (state.boostUntil && state.boostUntil < now) {
      state.boostUntil = 0;
      emit('boost-end');
    }
    if (state.rainUntil && state.rainUntil < now) {
      state.rainUntil = 0;
      emit('boost-end');
    }
    if (root.CLICK) root.CLICK.tick(dt);
    if (root.FISH) root.FISH.tick(dt);
    if (root.FX) root.FX.tick(dt);
    return dt;
  }

  root.ST = {
    KEY: KEY,
    get state() { return state; },
    load: load, save: save, flush: flush, reset: reset,
    fmt: fmt, fmtTime: fmtTime, fmtFullTime: fmtFullTime,
    up: up, totalUpgrades: totalUpgrades,
    perClick: perClick, perSecond: perSecond, critChance: critChance, critMult: critMult,
    comboMult: comboMult, fishValue: fishValue, luck: luck, xpNeed: xpNeed,
    rank: rank, levelMult: levelMult, shellMult: shellMult, allMult: allMult,
    upgradeCost: upgradeCost, buyUpgrade: buyUpgrade, buyMax: buyMax,
    skin: skin, buySkin: buySkin, equipSkin: equipSkin, unlockSkin: unlockSkin,
    unlockEffect: unlockEffect, hasEffect: hasEffect, effectOn: effectOn,
    addCoins: addCoins, spend: spend, addXp: addXp, addFish: addFish, addShells: addShells,
    exchangeFish: exchangeFish, addTickets: addTickets, clickTickets: clickTickets,
    prestigeGain: prestigeGain, canPrestige: canPrestige, doPrestige: doPrestige,
    calcOffline: calcOffline, get offlineInfo() { return offlineInfo; },
    statValue: statValue, bump: bump,
    on: on, emit: emit, tick: tick,
    get dirty() { return saveDirty; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
