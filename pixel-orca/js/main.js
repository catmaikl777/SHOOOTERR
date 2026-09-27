/* ============================================================
   PIXEL ORCA — точка входа, HUD, настройки, главный цикл
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, FX = root.FX;
  var api = root.API;
  var els = {};
  var lastSaveT = 0;

  function boot() {
    ST.load();
    cacheEls();
    FX.init(els.scene);
    root.CLICK.init(els.scene);
    root.QUESTS.init();
    root.QUESTS.initClicks();
    root.SHOP.initClicks();
    root.BATTLE.initServerEvents();
    applySettings();
    wireMenu();
    wireSettings();
    wireStatus();
    api.connect();
    api.on('status', function (s) { paintStatus(s); });
    paintStatus({ status: api.status });

    /* оффлайн-доход */
    var off = ST.offlineInfo;
    if (off && off.coins > 0) {
      UI.modalShell('С ВОЗВРАЩЕНИЕМ!',
        '<div class="offline-box"><div class="offline-ic">' + root.SHOP.SPRHTML('coin', 3) + '</div>' +
        '<p>Пока тебя не было, стая наловила:</p>' +
        '<div class="offline-num">+' + ST.fmt(off.coins) + ' косаток</div>' +
        '<p class="dim">Офлайн-доход: ' + ST.fmtTime(off.capped) + ' (копится максимум 8 часов)</p></div>');
    }
    /* ежедневная награда */
    if (root.REW.dailyState().can) {
      setTimeout(function () { root.REW.openDaily(); }, 700);
    }
    /* рефреш */
    setInterval(function () { paintHUD(); root.SHOP.tick(); }, 120);
    setInterval(function () {
      if (api.online && api.account) api.pushSave(ST.state);
      else ST.save();
    }, 20000);
    window.addEventListener('beforeunload', function () { ST.flush(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) ST.flush();
    });
    registerSW();

    /* главный цикл */
    var last = Date.now();
    var nextRain = Date.now() + 180000 + Math.random() * 240000;
    setInterval(function () {
      var now = Date.now();
      var dt = now - last;
      last = now;
      ST.tick();
      FX.tick();
      if (ST.state.boostUntil && ST.state.boostUntil < now) {
        UI.toast('Удвоение закончилось', 'info', 'coin');
      }
      /* морской дождь: редкий buff x1.5 на 5 минут */
      if (now > nextRain) {
        nextRain = now + 300000 + Math.random() * 240000;
        if (Math.random() < 0.4 && ST.perSecond() > 0) {
          ST.state.rainUntil = now + 300000;
          ST.save();
          root.SND.play('levelUp');
          UI.banner('МОРСКОЙ ДОЖДЬ! x1.5', 'banner-rare', 2200);
        }
      }
      FX.rain(ST.state.rainUntil > now);
    }, 100);
  }

  function cacheEls() {
    var ids = ['scene', 'hudCoins', 'hudLevel', 'hudClick', 'hudSec', 'hudFish', 'hudRank',
      'xpBar', 'xpTxt', 'connDot', 'connTxt', 'ticketCnt', 'adBtn', 'boostTag', 'comboTag',
      'dailyDot', 'clanTag', 'menuBtns', 'toastRoot'];
    ids.forEach(function (id) { els[id] = document.getElementById(id); });
  }

  /* ---------- HUD ---------- */
  function paintHUD() {
    var s = ST.state;
    set(els.hudCoins, ST.fmt(s.coins));
    set(els.hudLevel, s.level);
    set(els.hudClick, ST.fmt(ST.perClick(root.CLICK.combo)));
    set(els.hudSec, ST.fmt(ST.perSecond()));
    set(els.hudFish, ST.fmt(s.fish));
    set(els.hudRank, ST.rank());
    set(els.ticketCnt, ST.fmt(s.eventTickets || 0));
    if (els.xpBar) {
      var need = ST.xpNeed(s.level);
      els.xpBar.style.width = Math.min(100, s.xp / need * 100).toFixed(2) + '%';
      set(els.xpTxt, ST.fmt(s.xp) + '/' + ST.fmt(need));
    }
    if (els.boostTag) {
      var left = Math.max(s.boostUntil - Date.now(), root.CLICK.buffX2 - Date.now());
      els.boostTag.classList.toggle('hide', left <= 0);
      if (left > 0) set(els.boostTag, 'x2 ' + ST.fmtTime(left));
    }
    if (els.comboTag) {
      var c = root.CLICK.combo;
      els.comboTag.classList.toggle('hide', c < 3);
      if (c >= 3) set(els.comboTag, 'x' + c);
    }
    if (els.clanTag) {
      var c2 = api.clan;
      els.clanTag.classList.toggle('hide', !c2);
      if (c2) set(els.clanTag, c2.name);
    }
    if (els.dailyDot) {
      els.dailyDot.classList.toggle('hide', !root.REW.dailyState().can);
    }
    if (els.adBtn) {
      var cd = root.REW.adCooldown();
      els.adBtn.classList.toggle('dim', cd > 0);
      set(els.adBtn, cd > 0 ? '📺 ' + ST.fmtTime(cd) : '📺 РЕКЛАМА');
    }
  }
  function set(el, v) { if (el && el.textContent !== String(v)) el.textContent = v; }

  /* ---------- статус соединения ---------- */
  function wireStatus() {
    api.on('account', function (a) {
      var el = document.getElementById('accName');
      set(el, a ? '@' + a.name : '👤 ГОСТЬ');
      paintHUD();
      if (a) {
        /* подтягиваем облачное сохранение */
        api.pullSave().then(function (cloud) {
          if (!cloud) { api.pushSave(ST.state); return; }
          var localCoins = ST.state.totalCoins, cloudCoins = (cloud.stats && cloud.coins) || cloud.coins || 0;
          if (cloudCoins > localCoins * 1.2) {
            UI.confirm('Загрузить облачный прогресс?',
              'В облаке: ' + ST.fmt(cloudCoins) + ' всего, на устройстве: ' + ST.fmt(localCoins) + '. Загрузить облако?',
              'Загрузить').then(function (y) {
                if (!y) return;
                location.reload();
              });
            window.__cloudState = cloud;
          } else {
            api.pushSave(ST.state);
          }
        });
      }
    });
    api.on('clan', function () { paintHUD(); });
    api.on('authError', function (m) { UI.toast('Ошибка входа: ' + m, 'bad', 'i_lock'); });
  }
  function paintStatus(s) {
    var dot = els.connDot, txt = els.connTxt;
    if (!dot) return;
    var map = { online: ['#4ad07a', 'СЕРВЕР: ОНЛАЙН'], connecting: ['#ffd447', 'ПОДКЛЮЧЕНИЕ…'], offline: ['#e04a5a', 'СЕРВЕР: ОФЛАЙН'] };
    var v = map[s.status] || map.offline;
    dot.style.background = v[0];
    set(txt, v[1]);
  }

  /* ---------- меню ---------- */
  var MENU = [
    { id: 'shop', ic: 'i_coin', name: 'МАГАЗИН', fn: function () { UI.open('shop'); root.SHOP.showTab('upgrades'); } },
    { id: 'boxes', ic: 'i_gift', name: 'БОКСЫ', fn: function () { UI.open('shop'); root.SHOP.showTab('boxes'); } },
    { id: 'skins', ic: 'i_crown', name: 'СКИНЫ', fn: function () { UI.open('shop'); root.SHOP.showTab('skins'); } },
    { id: 'fish', ic: 'fish', name: 'РЫБАЛКА', fn: function () { root.FISH.open(); } },
    { id: 'quests', ic: 'i_book', name: 'КВЕСТЫ', fn: function () { UI.open('quests'); root.QUESTS.render(); } },
    { id: 'ach', ic: 'i_star', name: 'ДОСТИЖЕНИЯ', fn: function () { UI.open('achievements'); root.QUESTS.render(); } },
    { id: 'pvp', ic: 'i_sword', name: 'PvP', fn: function () { root.BATTLE.openPvP(); } },
    { id: 'raid', ic: 'i_team', name: 'РЕЙД 3x3', fn: function () { root.BATTLE.openRaid(); } },
    { id: 'clans', ic: 'i_team', name: 'КЛАНЫ', fn: function () { root.SOCIAL.openClans(); } },
    { id: 'lb', ic: 'i_ladder', name: 'ЛИДЕРЫ', fn: function () { root.SOCIAL.openLeaderboard(); } },
    { id: 'event', ic: 'ticket', name: 'ИВЕНТ', fn: function () { root.REW.openEvent(); } },
    { id: 'stats', ic: 'i_ladder', name: 'СТАТИСТИКА', fn: function () { root.REW.openStats(); } },
    { id: 'daily', ic: 'i_gift', name: 'НАГРАДА', fn: function () { root.REW.openDaily(); }, dot: 'dailyDot' },
    { id: 'prestige', ic: 'shell', name: 'СБРОС', fn: function () { openPrestige(); } },
    { id: 'auth', ic: 'i_lock', name: 'АККАУНТ', fn: function () { root.SOCIAL.openAuth(); } },
    { id: 'settings', ic: 'i_anvil', name: 'НАСТРОЙКИ', fn: function () { UI.open('settings'); syncSettingsUI(); } }
  ];

  function wireMenu() {
    var box = els.menuBtns;
    if (!box) return;
    var html = '';
    for (var i = 0; i < MENU.length; i++) {
      var m = MENU[i];
      html += '<button class="menu-btn" data-menu="' + m.id + '">' +
        '<span class="mb-ic">' + root.SHOP.SPRHTML(m.ic, 2) + '</span>' +
        '<span class="mb-name">' + m.name + '</span>' +
        (m.dot ? '<span class="mb-dot hide" id="' + m.dot + '"></span>' : '') + '</button>';
    }
    box.innerHTML = html;
    root.SHOP.paintIcons(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-menu]');
      if (!b) return;
      root.SND.resume();
      for (var i = 0; i < MENU.length; i++) if (MENU[i].id === b.dataset.menu) { MENU[i].fn(); break; }
    });
  }

  function openPrestige() {
    UI.open('prestige');
    root.SHOP.renderPrestige(document.getElementById('prestigeBox'));
  }

  /* ---------- настройки ---------- */
  function applySettings() {
    var s = ST.state.settings;
    root.SND.enabled = s.sfx;
    root.SND.music = s.music;
    root.SND.volume = s.volume;
    FX.setTheme(s.theme);
    if (FX.size.px !== s.pixelScale) FX.setPixelScale(s.pixelScale);
  }

  function wireSettings() {
    var bind = function (id, ev, fn) {
      var el = document.getElementById(id);
      if (el) el.addEventListener(ev, fn);
    };
    bind('setMusic', 'change', function () {
      ST.state.settings.music = this.checked;
      root.SND.music = this.checked;
      ST.save();
    });
    bind('setSfx', 'change', function () {
      ST.state.settings.sfx = this.checked;
      root.SND.enabled = this.checked;
      ST.save();
      if (this.checked) root.SND.play('ui');
    });
    bind('setVolume', 'input', function () {
      ST.state.settings.volume = this.value / 100;
      root.SND.volume = this.value / 100;
      set(document.getElementById('volTxt'), this.value);
      ST.save();
    });
    bind('setEffectsAll', 'change', function () {
      ST.state.settings.effectsAll = this.checked;
      ST.save();
    });
    bind('setShake', 'change', function () { ST.state.settings.shake = this.checked; ST.save(); });
    bind('setDamage', 'change', function () { ST.state.settings.showDamage = this.checked; ST.save(); });
    bind('setPixel', 'change', function () {
      FX.setPixelScale(+this.value);
      syncSettingsUI();
    });
    /* темы */
    var themes = document.getElementById('themeRow');
    if (themes) {
      themes.addEventListener('click', function (e) {
        var b = e.target.closest('[data-theme]');
        if (!b) return;
        ST.state.settings.theme = b.dataset.theme;
        ST.save();
        FX.setTheme(b.dataset.theme);
        FX.setPixelScale(+document.getElementById('setPixel').value);
        syncSettingsUI();
      });
    }
    /* эффекты */
    var fxRow = document.getElementById('fxToggleList');
    if (fxRow) {
      fxRow.addEventListener('click', function (e) {
        var b = e.target.closest('[data-fx]');
        if (!b) return;
        var id = b.dataset.fx;
        if (!ST.hasEffect(id)) { root.SND.play('deny'); UI.toast('Эффект ещё не открыт', 'bad', 'i_lock'); return; }
        var v = !ST.state.effectsOn[id];
        ST.state.effectsOn[id] = v ? 1 : 0;
        ST.save();
        root.SND.play('ui');
        syncSettingsUI();
      });
    }
    /* сохранение/сброс */
    bind('btnSave', 'click', function () {
      var ok = ST.flush();
      if (ok) {
        root.SND.play('buy');
        set(document.getElementById('saveTxt'), 'Сохранено: ' + new Date().toLocaleTimeString('ru-RU'));
        UI.toast('Прогресс сохранён', 'good', 'i_star');
      } else UI.toast('Не удалось сохранить', 'bad', 'i_lock');
    });
    bind('btnReset', 'click', function () {
      UI.confirm('Сбросить ВСЁ?', 'Прогресс будет удалён навсегда. Ракушки, скины и достижения тоже слетят.', 'СБРОСИТЬ')
        .then(function (y) {
          if (!y) return;
          ST.reset();
          location.reload();
        });
    });
    bind('btnExport', 'click', function () {
      var data = btoa(unescape(encodeURIComponent(JSON.stringify(ST.state))));
      var m = UI.modalShell('ЭКСПОРТ СЕЙВА', '<p class="dialog-text">Скопируй код и вставь в «Импорт» на другом устройстве.</p>' +
        '<textarea class="px-input code" id="expTxt" readonly></textarea>');
      m.querySelector('#expTxt').value = data;
      m.querySelector('#expTxt').focus();
    });
    bind('btnImport', 'click', function () {
      UI.prompt('Импорт сейва', 'Вставь код сейва', '', 99999).then(function (v) {
        if (!v) return;
        try {
          var obj = JSON.parse(decodeURIComponent(escape(atob(v.trim()))));
          UI.confirm('Импортировать?', 'Текущий прогресс будет заменён.', 'Импортировать').then(function (y) {
            if (!y) return;
            localStorage.setItem(ST.KEY, JSON.stringify(obj));
            location.reload();
          });
        } catch (e) { UI.toast('Код повреждён', 'bad', 'i_lock'); }
      }, 32);
    });
  }

  function syncSettingsUI() {
    var s = ST.state.settings;
    var set = function (id, v) { var e = document.getElementById(id); if (e) e.value = v; };
    var chk = function (id, v) { var e = document.getElementById(id); if (e) e.checked = !!v; };
    chk('setMusic', s.music);
    chk('setSfx', s.sfx);
    set('setVolume', Math.round(s.volume * 100));
    set(document.getElementById('volTxt') ? 'volTxt' : 'setVolume', Math.round(s.volume * 100));
    chk('setEffectsAll', s.effectsAll);
    chk('setShake', s.shake);
    chk('setDamage', s.showDamage);
    set('setPixel', s.pixelScale);
    document.querySelectorAll('#themeRow [data-theme]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.theme === s.theme);
    });
    var fl = document.getElementById('fxToggleList');
    if (fl) {
      if (!fl.dataset.built) {
        var h = '';
        for (var i = 0; i < D.EFFECTS.length; i++) {
          var e = D.EFFECTS[i];
          h += '<div class="fx-toggle" data-fx="' + e.id + '">' +
            '<span class="fx-ic">' + root.SHOP.SPRHTML(e.icon, 2) + '</span>' +
            '<span class="fx-name">' + e.name + '</span>' +
            '<span class="fx-sw" data-sw></span></div>';
        }
        fl.innerHTML = h;
        fl.dataset.built = '1';
        root.SHOP.paintIcons(fl);
      }
      fl.querySelectorAll('[data-fx]').forEach(function (row) {
        var id = row.dataset.fx;
        var owned = ST.hasEffect(id);
        var on = ST.effectOn(id);
        row.classList.toggle('locked', !owned);
        row.classList.toggle('on', owned && on);
        var sw = row.querySelector('[data-sw]');
        if (sw) sw.textContent = !owned ? '🔒' : (on ? 'ВКЛ' : 'ВЫКЛ');
      });
    }
  }

  /* Service worker: офлайн-кэш оболочки. Любая ошибка регистрации не должна
     влиять на игру — поэтому всё под try/catch и только на https/localhost. */
  function registerSW() {
    try {
      if (!root.navigator || !root.navigator.serviceWorker) return;
      var cfg = root.PO_CONFIG || {};
      if (cfg.serviceWorker === false) return;
      var secure = location.protocol === 'https:' ||
        location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (!secure) return;
      var hadController = !!root.navigator.serviceWorker.controller;
      var scope = cfg.swScope || './';
      var swUrl = new URL('sw.js', new URL(scope, location.href)).href;
      root.navigator.serviceWorker.register(swUrl, { scope: scope, updateViaCache: 'none' })
        .then(function (reg) {
          if (cfg.debug) console.log('[sw] зарегистрирован:', reg.scope);
        })
        .catch(function (e) { if (cfg.debug) console.log('[sw] отключён:', e.message); });
      /* новая версия SW перехватила страницу — перезагружаем один раз,
         чтобы игрок не остался на старом коде после деплоя */
      var reloaded = false;
      root.navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
      });
    } catch (e) { /* service worker не обязателен */ }
  }

  root.MAIN = { boot: boot, paintHUD: paintHUD, syncSettingsUI: syncSettingsUI, applySettings: applySettings };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
