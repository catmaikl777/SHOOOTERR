/* ============================================================
   PIXEL ORCA — ежедневная награда, реклама, ивент, статистика
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, API = root.API;

  /* ================= ЕЖЕДНЕВНАЯ НАГРАДА ================= */
  function dailyState() {
    var now = Date.now();
    var last = ST.state.lastDaily || 0;
    var todayKey = new Date().setHours(0, 0, 0, 0);
    if (last >= todayKey) return { can: false, streak: ST.state.dailyStreak };
    var yKey = todayKey - 86400000;
    var streak = (last >= yKey) ? ST.state.dailyStreak : 0;
    return { can: true, streak: streak, next: streak % D.DAILY_REWARD.length };
  }

  function openDaily() {
    var st = dailyState();
    var html = '<div class="daily-grid">';
    for (var i = 0; i < D.DAILY_REWARD.length; i++) {
      var r = D.DAILY_REWARD[i];
      var idx = st.next;
      var cls = '';
      if (!st.can) cls = 'dim';
      else if (i < idx) cls = 'got';
      else if (i === idx) cls = 'now';
      var ic = r.coins ? 'coin' : r.fish ? 'fish' : r.shells ? 'shell' : 'starX2';
      html += '<div class="daily-cell ' + cls + '">' +
        '<div class="dc-day">День ' + (i + 1) + '</div>' +
        '<div class="dc-ic">' + root.SHOP.SPRHTML(ic, 2) + '</div>' +
        '<div class="dc-label">' + r.label + '</div></div>';
    }
    html += '</div>';
    html += '<div class="daily-streak">Серия: <b>' + ST.state.dailyStreak + '</b> дн.</div>';
    html += '<button class="px-btn px-btn-primary px-btn-wide" id="dailyClaim"' + (st.can ? '' : ' disabled') + '>' +
      (st.can ? 'ЗАБРАТЬ НАГРАДУ' : 'УЖЕ ПОЛУЧЕНО') + '</button>';
    var m = UI.modalShell('ЕЖЕДНЕВНАЯ НАГРАДА', html);
    root.SHOP.paintIcons(m);
    var btn = m.querySelector('#dailyClaim');
    btn.addEventListener('click', function () {
      var r = D.DAILY_REWARD[dailyState().next];
      if (r.coins) ST.addCoins(r.coins, true);
      if (r.fish) ST.addFish(r.fish);
      if (r.shells) ST.addShells(r.shells);
      if (r.boost) ST.state.boostUntil = Date.now() + 3600000;
      ST.state.lastDaily = Date.now();
      ST.state.dailyStreak = dailyState().streak + 1;
      ST.save();
      root.SND.play('levelUp');
      UI.banner('НАГРАДА ПОЛУЧЕНА!', 'banner-good', 1300);
      UI.closeEl(m);
    });
  }

  /* ================= РЕКЛАМА ================= */
  function adCooldown() {
    return Math.max(0, (ST.state.adReady || 0) - Date.now());
  }
  function openAd() {
    var left = adCooldown();
    if (left > 0) {
      UI.toast('Реклама доступна через ' + ST.fmtTime(left), 'bad', 'i_book');
      return;
    }
    var reward = 1000 * ST.state.level;
    var m = UI.modalShell('📺 РЕКЛАМА', '<div class="ad-mock">' +
      '<div class="ad-screen">' +
      '<div class="ad-pixels"></div>' +
      '<div class="ad-text">ПИКСЕЛЬНЫЙ<br>МИР РЕКЛАМЫ</div>' +
      '<div class="ad-sub">Ваша награда уже готовится…</div>' +
      '</div>' +
      '<div class="ad-progress"><i id="adBar"></i></div>' +
      '<div class="ad-timer" id="adTimer">' + (D.AD.viewMs / 1000) + '</div>' +
      '<button class="px-btn px-btn-primary px-btn-wide" id="adSkip">ПРОПУСТИТЬ</button>' +
      '</div>');
    var t0 = Date.now();
    var done = false;
    var bar = m.querySelector('#adBar');
    var tm = m.querySelector('#adTimer');
    var timer = setInterval(function () {
      var el = Date.now() - t0;
      var p = Math.min(1, el / D.AD.viewMs);
      bar.style.width = (p * 100) + '%';
      tm.textContent = Math.max(0, Math.ceil((D.AD.viewMs - el) / 1000));
      if (p >= 1 || el >= D.AD.viewMs) {
        clearInterval(timer);
        if (!done) grant();
      }
    }, 100);
    m.querySelector('#adSkip').addEventListener('click', function () {
      clearInterval(timer);
      grant();
    });
    function grant() {
      if (done) return;
      done = true;
      ST.addCoins(reward, true);
      ST.state.adReady = Date.now() + D.AD.cooldownMs;
      ST.save();
      root.SND.play('levelUp');
      UI.banner('+' + ST.fmt(reward) + ' КОСАТОК', 'banner-good', 1500);
      UI.closeEl(m);
    }
  }

  /* ================= ИВЕНТ ================= */
  var eventInfo = null;
  function loadEvent() {
    if (!API.online) {
      eventInfo = { offline: true };
      return Promise.resolve(eventInfo);
    }
    return API.send('event:info', {}, 6000).then(function (m) {
      eventInfo = m;
      return m;
    }).catch(function () { eventInfo = { offline: true }; return eventInfo; });
  }
  function openEvent() {
    loadEvent().then(function (info) {
      var html = '';
      if (info.offline) {
        html = '<div class="ev-off">Сервер недоступен — ивент и билеты пока офлайн. Билеты капают локально и уйдут в облако при входе.</div>';
      } else {
        html += '<div class="ev-top">' +
          '<div class="ev-cell"><span>До конца сезона</span><b>' + ST.fmtTime(info.left || 0) + '</b></div>' +
          '<div class="ev-cell"><span>Ваши билеты</span><b>' + (ST.state.eventTickets || 0) + '</b></div>' +
          '<div class="ev-cell"><span>Очки сезона</span><b>' + ST.fmt(info.topScore || 0) + '</b></div>' +
          '</div>';
      }
      html += '<p class="dialog-text">Билеты обмениваются в клане на очки сезона. Чем больше очков у клана, тем выше его место в наградах.</p>' +
        '<div class="clan-evt">' +
        '<button class="px-btn px-btn-small px-btn-primary" id="evExchange">🎫 ОБМЕНЯТЬ 10 БИЛЕТОВ → 100 ОЧКОВ</button>' +
        (api.clan ? '' : '<span class="dim">нужен клан</span>') +
        '</div>';
      html += '<div class="ev-rewards"><h4>Топ игроков</h4>' +
        '<div class="ev-line ev-1">🥇 1 место: ' + ST.fmt(D.EVENT.playerRewards[0]) + '</div>' +
        '<div class="ev-line ev-2">🥈 2 место: ' + ST.fmt(D.EVENT.playerRewards[1]) + '</div>' +
        '<div class="ev-line ev-3">🥉 3 место: ' + ST.fmt(D.EVENT.playerRewards[2]) + '</div></div>';
      html += '<div class="ev-rewards"><h4>Топ кланов (каждому участнику)</h4>' +
        '<div class="ev-line ev-1">🥇 ' + ST.fmt(D.EVENT.clanRewards[0]) + '</div>' +
        '<div class="ev-line ev-2">🥈 ' + ST.fmt(D.EVENT.clanRewards[1]) + '</div>' +
        '<div class="ev-line ev-3">🥉 ' + ST.fmt(D.EVENT.clanRewards[2]) + '</div></div>';
      html += '<h4>Топ игроков сезона</h4><div class="ev-lb" id="evLb">загрузка…</div>';
      html += '<h4>Топ кланов сезона</h4><div class="ev-lb" id="evClanLb">загрузка…</div>';
      html += '<div class="ev-how">' + root.SHOP.SPRHTML('ticket', 2) +
        ' Билеты: 1 за ' + (ST.up('ticket') > 0 ? ST.up('ticket') : D.EVENT.clickDiv) + ' кликов и 1 за ' + D.EVENT.pvpClickDiv + ' кликов в PvP.</div>';
      var m = UI.modalShell('СЕЗОННЫЙ ИВЕНТ', html);
      root.SHOP.paintIcons(m);
      var ex = m.querySelector('#evExchange');
      if (ex) ex.addEventListener('click', function () {
        API.send('event:exchange', { n: 10 }, 8000).then(function (r) {
          ST.state.eventTickets = r.tickets || 0;
          ST.state.eventSeasonScore = r.seasonScore || 0;
          ST.save();
          root.SND.play('levelUp');
          UI.banner('+' + r.points + ' ОЧКОВ СЕЗОНА', 'banner-good', 1400);
          ex.disabled = true;
        }).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
      if (!info.offline) {
        API.leaderboard('event').then(function (rows) {
          var box = m.querySelector('#evLb');
          if (!box) return;
          box.innerHTML = rows.length ? lbTable(rows, 'season') : '<div class="dim">пока пусто</div>';
        });
        API.clanList().then(function (rows) {
          var box = m.querySelector('#evClanLb');
          if (!box) return;
          box.innerHTML = rows.length ? clanTable(rows) : '<div class="dim">кланов пока нет</div>';
        });
      }
    });
  }
  function lbTable(rows, mode) {
    var h = '<table class="px-table"><tr><th>#</th><th>Игрок</th><th>' + (mode === 'season' ? 'Очки' : 'Косатки') + '</th></tr>';
    for (var i = 0; i < rows.length; i++) {
      h += '<tr class="' + (i < 3 ? 'top' + (i + 1) : '') + '"><td>' + (i + 1) + '</td><td>' + escapeHtml(rows[i].name) + '</td><td>' +
        ST.fmt(mode === 'season' ? rows[i].seasonScore : rows[i].coins) + '</td></tr>';
    }
    return h + '</table>';
  }
  function clanTable(rows) {
    var h = '<table class="px-table"><tr><th>#</th><th>Клан</th><th>Участники</th><th>Сумма</th></tr>';
    for (var i = 0; i < rows.length; i++) {
      h += '<tr class="' + (i < 3 ? 'top' + (i + 1) : '') + '"><td>' + (i + 1) + '</td><td>' + escapeHtml(rows[i].name) + '</td><td>' +
        (rows[i].members || 0) + '</td><td>' + ST.fmt(rows[i].coins || 0) + '</td></tr>';
    }
    return h + '</table>';
  }
  function escapeHtml(s) { return UI.escapeHtml(s); }

  /* ================= СТАТИСТИКА ================= */
  function openStats() {
    var s = ST.state.stats;
    var rows = [
      ['Всего кликов', ST.fmt(s.clicks)],
      ['Всего косаток', ST.fmt(ST.state.totalCoins)],
      ['Критических кликов', ST.fmt(s.crits)],
      ['Лучший комбо', 'x' + s.bestCombo],
      ['Макс. кликов/сек', ST.fmt(s.bestCps)],
      ['Лучший клик', ST.fmt(s.bestPerClick)],
      ['Косаток/сек сейчас', ST.fmt(ST.perSecond())],
      ['Улучшений куплено', ST.fmt(s.upgradesBought)],
      ['Боксов открыто', ST.fmt(s.boxesOpened)],
      ['Рыб поймано', ST.fmt(s.fishCaught)],
      ['Рыбы обменяно раз', s.exchanges],
      ['Скинов куплено', s.skinsBought + ' / ' + D.SKINS.length],
      ['Эффектов открыто', ST.state.effectsOwned.length + ' / ' + D.EFFECTS.length],
      ['Достижений', Object.keys(ST.state.achievementsClaimed).length + ' / ' + D.ACHIEVEMENTS.length],
      ['Квестов пройдено', ST.state.questIndex + ' / ' + D.QUESTS.length],
      ['Ракушек собрано', s.shellsTotal],
      ['Сбросов в океан', ST.state.prestiges],
      ['PvP: побед/игр', s.pvpWins + ' / ' + s.pvpPlayed],
      ['Рейды: побед/игр', s.raidWins + ' / ' + s.raidPlayed],
      ['Билетов ивента', s.ticketsTotal],
      ['Доход офлайн', ST.fmt(s.offlineEarned)],
      ['Время в игре', ST.fmtFullTime(ST.state.playTime)],
      ['Последний сброс', ST.state.lastSave ? new Date(ST.state.lastSave).toLocaleString('ru-RU') : '—']
    ];
    var html = '<div class="stats-grid">';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="stat-cell"><span>' + rows[i][0] + '</span><b>' + rows[i][1] + '</b></div>';
    }
    html += '</div>';
    var m = UI.modalShell('СТАТИСТИКА', html);
  }

  root.REW = {
    openDaily: openDaily, openAd: openAd, openEvent: openEvent, openStats: openStats,
    adCooldown: adCooldown, dailyState: dailyState,
    lbTable: lbTable, clanTable: clanTable, escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
