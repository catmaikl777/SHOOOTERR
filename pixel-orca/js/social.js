/* ============================================================
   PIXEL ORCA — аккаунт, таблица лидеров, кланы
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI, API = root.API;
  var esc = function (s) { return root.REW.escapeHtml(s); };

  /* ================= АККАУНТ ================= */
  function openAuth() {
    var acc = ST.state.account;
    var isIn = !!acc.name;
    var html = isIn ?
      '<div class="auth-box"><div class="auth-name">' + root.SHOP.SPRHTML('orca', 3) + '</div>' +
      '<div class="auth-hello">Ты вошёл как <b>' + esc(acc.name) + '</b></div>' +
      '<p class="dialog-text">Прогресс синхронизируется с облаком. Гостевой прогресс остался на этом устройстве.</p>' +
      '<button class="px-btn px-btn-danger px-btn-wide" id="authOut">ВЫЙТИ ИЗ АККАУНТА</button></div>'
      :
      '<div class="auth-box">' +
      '<p class="dialog-text">Аккаунт нужен для PvP, кланов и облачного сохранения. Гостевой режим работает без регистрации.</p>' +
      '<div class="auth-tabs"><button class="px-btn px-btn-small active" data-at="login">Вход</button>' +
      '<button class="px-btn px-btn-small" data-at="reg">Регистрация</button></div>' +
      '<label class="px-label">Имя (3–16 символов)</label>' +
      '<input class="px-input" id="authName" maxlength="16" placeholder="Например: OrcaMaster">' +
      '<label class="px-label">Пароль (4–32 символа)</label>' +
      '<input class="px-input" id="authPass" type="password" maxlength="32" placeholder="••••••">' +
      '<div class="auth-err" id="authErr"></div>' +
      '<button class="px-btn px-btn-primary px-btn-wide" id="authGo">ВОЙТИ</button>' +
      '<button class="px-btn px-btn-wide" id="authGuest">ПРОДОЛЖИТЬ КАК ГОСТЬ</button>' +
      '<div class="auth-status">Сервер: <b id="authSrv">—</b></div></div>';

    var m = UI.modalShell(isIn ? 'АККАУНТ' : 'ВХОД В АККАУНТ', html);
    root.SHOP.paintIcons(m);
    var mode = 'login';
    m.querySelectorAll('[data-at]').forEach(function (b) {
      b.addEventListener('click', function () {
        m.querySelectorAll('[data-at]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        mode = b.dataset.at;
      });
    });
    var srv = m.querySelector('#authSrv');
    function setSrv() {
      if (srv) srv.textContent = API.status === 'online' ? 'подключён' : (API.status === 'connecting' ? 'подключение…' : 'недоступен (гостевой режим)');
    }
    setSrv();
    API.on('status', setSrv);

    var out = m.querySelector('#authOut');
    if (out) out.addEventListener('click', function () {
      API.logout();
      UI.closeEl(m);
      UI.toast('Вышел из аккаунта', 'info', 'i_lock');
    });
    var guest = m.querySelector('#authGuest');
    if (guest) guest.addEventListener('click', function () { UI.closeEl(m); });
    var go = m.querySelector('#authGo');
    if (go) {
      function submit() {
        var name = m.querySelector('#authName').value.trim();
        var pass = m.querySelector('#authPass').value;
        var err = m.querySelector('#authErr');
        if (name.length < 3 || name.length > 16) { err.textContent = 'Имя: 3–16 символов'; return; }
        if (pass.length < 4) { err.textContent = 'Пароль: минимум 4 символа'; return; }
        if (API.status !== 'online') { err.textContent = 'Сервер недоступен. Запусти: node server/server.js'; return; }
        go.disabled = true;
        err.textContent = 'Подождите…';
        var p = mode === 'login' ? API.login(name, pass) : API.register(name, pass);
        p.then(function () {
          err.textContent = '';
          UI.closeEl(m);
          root.SND.play('levelUp');
          UI.banner('ДОБРО ПОЖАЛОВАТЬ!', 'banner-good', 1400);
          API.pushSave(ST.state).then(function () {});
        }).catch(function (e2) {
          err.textContent = e2.message || 'Ошибка входа';
          go.disabled = false;
        });
      }
      go.addEventListener('click', submit);
      m.querySelector('#authPass').addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    }
  }

  /* ================= ЛИДЕРЫ ================= */
  var lbSort = 'coins';
  function openLeaderboard() {
    var m = UI.modalShell('ТАБЛИЦА ЛИДЕРОВ',
      '<div class="lb-tabs">' +
      '<button class="px-btn px-btn-small active" data-s="coins">Косатки</button>' +
      '<button class="px-btn px-btn-small" data-s="level">Уровень</button>' +
      '<button class="px-btn px-btn-small" data-s="event">Сезон</button>' +
      '</div><div id="lbBox" class="lb-box">загрузка…</div>' +
      '<button class="px-btn px-btn-small px-btn-wide" id="lbRefresh">ОБНОВИТЬ</button>');
    function load() {
      var box = m.querySelector('#lbBox');
      if (!API.online) { box.innerHTML = '<div class="dim">Сервер недоступен. Таблица появится при подключении.</div>'; return; }
      box.innerHTML = 'загрузка…';
      API.leaderboard(lbSort).then(function (rows) {
        if (!rows.length) { box.innerHTML = '<div class="dim">Пока пусто — сыграй первым!</div>'; return; }
        var meName = ST.state.account.name;
        var h = '<table class="px-table"><tr><th>#</th><th>Игрок</th><th>Ур.</th><th>Косатки</th></tr>';
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          h += '<tr class="' + (i < 3 ? 'top' + (i + 1) : '') + (r.name === meName ? ' me' : '') + '"><td>' + (i + 1) + '</td><td>' +
            esc(r.name) + (r.clan ? ' <i>[' + esc(r.clan) + ']</i>' : '') + '</td><td>' + r.level + '</td><td>' +
            ST.fmt(r.coins) + '</td></tr>';
        }
        box.innerHTML = h + '</table>';
      });
    }
    m.querySelectorAll('[data-s]').forEach(function (b) {
      b.addEventListener('click', function () {
        m.querySelectorAll('[data-s]').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
        lbSort = b.dataset.s;
        load();
      });
    });
    m.querySelector('#lbRefresh').addEventListener('click', load);
    load();
  }

  /* ================= КЛАНЫ ================= */
  function openClans() {
    var m = UI.modalShell('КЛАНЫ',
      '<div id="clanMy"></div>' +
      '<div class="clan-actions">' +
      '<button class="px-btn px-btn-small" id="clanCreate">СОЗДАТЬ</button>' +
      '<button class="px-btn px-btn-small" id="clanJoin">ВСТУПИТЬ</button>' +
      '<button class="px-btn px-btn-small" id="clanRefresh">ОБНОВИТЬ</button>' +
      '<button class="px-btn px-btn-small" id="clanLeave">ВЫЙТИ</button>' +
      '<button class="px-btn px-btn-small px-btn-danger" id="clanDelete">УДАЛИТЬ</button>' +
      '</div>' +
      '<h4 class="sec-h">Твой клан</h4><div id="clanDetail" class="clan-detail"></div>' +
      '<h4 class="sec-h">Участники</h4><div id="clanMembers" class="clan-members"></div>' +
      '<h4 class="sec-h">Все кланы</h4><div id="clanList" class="clan-list">—</div>');
    refreshClans(m);
    m.querySelector('#clanRefresh').addEventListener('click', function () { refreshClans(m); });
    m.querySelector('#clanCreate').addEventListener('click', function () {
      UI.prompt('Создать клан', 'Название клана (3–18 символов)').then(function (v) {
        if (!v) return;
        if (ST.state.level < D.CLAN.minLevel) { UI.toast('Нужен ' + D.CLAN.minLevel + ' уровень', 'bad', 'i_lock'); return; }
        API.clanCreate(v).then(function () {
          root.SND.play('levelUp');
          UI.toast('Клан создан!', 'good', 'i_team');
          ST.bump('clanJoined');
          refreshClans(m);
        }).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
    m.querySelector('#clanJoin').addEventListener('click', function () {
      UI.prompt('Вступить в клан', 'Код клана').then(function (v) {
        if (!v) return;
        API.clanJoin(v.toUpperCase()).then(function () {
          root.SND.play('levelUp');
          UI.toast('Ты в клане!', 'good', 'i_team');
          ST.bump('clanJoined');
          refreshClans(m);
        }).catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
    m.querySelector('#clanLeave').addEventListener('click', function () {
      UI.confirm('Выйти из клана?', 'Теряешь бонусы клана.').then(function (y) {
        if (!y) return;
        API.clanLeave().then(function () { UI.toast('Ты вышел из клана', 'info', 'i_lock'); refreshClans(m); })
          .catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
    m.querySelector('#clanDelete').addEventListener('click', function () {
      UI.confirm('Удалить клан?', 'Клан исчезнет для всех участников.', 'Удалить').then(function (y) {
        if (!y) return;
        API.clanDelete().then(function () { UI.toast('Клан удалён', 'info', 'i_skull'); refreshClans(m); })
          .catch(function (e) { UI.toast(e.message, 'bad', 'i_lock'); });
      });
    });
  }

  function refreshClans(m) {
    var d = m.querySelector('#clanDetail');
    var mem = m.querySelector('#clanMembers');
    var list = m.querySelector('#clanList');
    var c = API.clan;
    if (c) {
      d.innerHTML = '<div class="clan-my"><b>' + esc(c.name) + '</b> <i>(' + esc(c.role) + ')</i>' +
        '<div>Код: <b class="clan-code">' + esc(c.code) + '</b></div>' +
        '<div>Сумма клана: ' + ST.fmt(c.coins) + ' · Казна: ' + ST.fmt(c.treasury || 0) + '</div>' +
        '<div>Бонус участников: +' + ((c.bonus || 0) * 100).toFixed(0) + '%' +
        ' <button class="px-btn px-btn-small" id="clanDonate">ВЗНОС ' + ST.fmt(D.CLAN.donateStep) + '</button></div>' +
        '<div class="clan-evt">Билеты ивента: ' + (ST.state.eventTickets || 0) +
        ' <button class="px-btn px-btn-small" id="clanGive10">ОТДАТЬ 10 БИЛЕТОВ</button></div></div>';
      var dn = d.querySelector('#clanDonate');
      dn.addEventListener('click', function () {
        if (ST.state.coins < D.CLAN.donateStep) { UI.toast('Не хватает косаток', 'bad', 'i_coin'); return; }
        API.clanDonate(D.CLAN.donateStep).then(function (r) {
          if (r && r.need) { UI.toast('Не хватает косаток', 'bad', 'i_coin'); return; }
          ST.spend(D.CLAN.donateStep);
          root.SND.play('buy');
          UI.toast('Взнос внесён!', 'good', 'i_coin');
          refreshClans(m);
        }).catch(function (e) { UI.toast(e.message, 'bad', 'i_coin'); });
      });
      var gv = d.querySelector('#clanGive10');
      gv.addEventListener('click', function () {
        if ((ST.state.eventTickets || 0) < 10) { UI.toast('Мало билетов', 'bad', 'ticket'); return; }
        API.send('clan:tickets', { n: 10 }).then(function () {
          ST.state.eventTickets -= 10;
          ST.save();
          root.SND.play('buy');
          UI.toast('10 билетов → очки клана', 'good', 'ticket');
          refreshClans(m);
        }).catch(function (e) { UI.toast(e.message, 'bad', 'ticket'); });
      });
      if (c.members && c.members.length) {
        var h = '<table class="px-table"><tr><th>Игрок</th><th>Вклад</th></tr>';
        for (var i = 0; i < c.members.length; i++) {
          h += '<tr><td>' + esc(c.members[i].name) + (c.members[i].role === 'owner' ? ' 👑' : '') + '</td><td>' +
            ST.fmt(c.members[i].contribution) + '</td></tr>';
        }
        mem.innerHTML = h + '</table>';
      } else mem.innerHTML = '<div class="dim">—</div>';
    } else {
      d.innerHTML = '<div class="dim">Ты не в клане. Клан даёт общий бонус и очки в ивенте.</div>';
      mem.innerHTML = '<div class="dim">—</div>';
    }
    if (!API.online) { list.innerHTML = '<div class="dim">Сервер недоступен</div>'; return; }
    API.clanList().then(function (rows) {
      list.innerHTML = rows.length ? root.REW.clanTable(rows) : '<div class="dim">кланов пока нет</div>';
    });
  }

  root.SOCIAL = { openAuth: openAuth, openLeaderboard: openLeaderboard, openClans: openClans, refreshClans: refreshClans };
})(typeof window !== 'undefined' ? window : globalThis);
