/* ============================================================
   PIXEL ORCA — клиент мультиплеера (WebSocket)
   Работает и без сервера: переключается в «соло» режим.
   ============================================================ */
(function (root) {
  'use strict';

  var ws = null, connected = false, retries = 0, handshake = false;
  var handlers = {};
  var pending = {};
  var msgId = 1;
  var status = 'offline';   /* offline | connecting | online */
  var me = null;            /* {id,name,clanId,clanName} */
  var clanState = null;
  var lastError = '';

  /* Адрес сервера: js/config.js → внешний хук PO_SERVER → /ws текущего хоста.
     config.js подключается первым, поэтому деплой меняет только его. */
  function serverUrl() {
    var cfg = root.PO_CONFIG || {};
    var url = String(cfg.server || '').trim();
    if (url) return url;
    if (root.PO_SERVER) return root.PO_SERVER;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var host = location.host || 'localhost:8787';
    return proto + '//' + host + '/ws';
  }

  /* Диагностика: что клиент реально использует (в HUD/консоль при PO_CONFIG.debug) */
  function serverInfo() {
    return { url: serverUrl(), source: (root.PO_CONFIG && root.PO_CONFIG.server) ? 'config' : (root.PO_SERVER ? 'hook' : 'same-origin') };
  }

  function emit(ev, data) {
    var list = handlers[ev];
    if (!list) return;
    for (var i = 0; i < list.length; i++) {
      try { list[i](data); } catch (e) { console.error('[api]', ev, e); }
    }
  }
  function on(ev, fn) {
    (handlers[ev] = handlers[ev] || []).push(fn);
  }
  function setStatus(s, err) {
    status = s;
    if (err) lastError = err;
    emit('status', { status: s, error: lastError });
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setStatus('connecting');
    try {
      ws = new WebSocket(serverUrl());
    } catch (e) {
      setStatus('offline', 'Не удалось подключиться: ' + e.message);
      return;
    }
    ws.onopen = function () {
      connected = true; retries = 0; handshake = false;
      setStatus('online');
      /* автоматический вход по сохранённому токену */
      var acc = root.ST && root.ST.state.account;
      if (acc && acc.token) send('resume', { token: acc.token });
    };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (!msg || !msg.t) return;
      if (msg.rid && pending[msg.rid]) {
        var p = pending[msg.rid];
        delete pending[msg.rid];
        if (msg.t.indexOf(':err') >= 0 || msg.err) p.rej(new Error(msg.msg || 'ошибка'));
        else p.res(msg);
      }
      if (msg.t === 'auth:ok') {
        me = msg.account;
        if (root.ST) {
          root.ST.state.account.name = me.name;
          root.ST.state.account.token = msg.token;
          root.ST.state.account.id = me.id;
          root.ST.save();
        }
        emit('account', me);
      }
      if (msg.t === 'auth:err') {
        if (root.ST) { root.ST.state.account.token = null; root.ST.save(); }
        emit('authError', msg.msg);
      }
      if (msg.t === 'clan:state') {
        clanState = msg.clan;
        if (root.ST) {
          root.ST.state.clan.id = clanState ? clanState.id : null;
          root.ST.state.clan.name = clanState ? clanState.name : null;
          root.ST.state.clan.role = clanState ? clanState.role : null;
          root.ST.save();
        }
        emit('clan', clanState);
      }
      emit(msg.t, msg);
      emit('*', msg);
    };
    ws.onclose = function () {
      connected = false;
      setStatus('offline', 'Сервер недоступен');
      if (retries < 60) {
        retries++;
        setTimeout(connect, Math.min(10000, 800 * retries));
      }
    };
    ws.onerror = function () { /* onclose справится */ };
  }

  function send(t, data, timeout) {
    return new Promise(function (res, rej) {
      if (!ws || ws.readyState !== 1) return rej(new Error('нет соединения'));
      var id = msgId++;
      /* rid — идентификатор запроса; данные не должны его затирать,
         поэтому собираем сообщение наоборот: сначала data, затем t/rid */
      var msg = Object.assign({}, data || {});
      msg.t = t;
      msg.rid = id;
      pending[id] = { res: res, rej: rej };
      ws.send(JSON.stringify(msg));
      if (timeout) {
        setTimeout(function () {
          if (pending[id]) { delete pending[id]; rej(new Error('таймаут')); }
        }, timeout);
      }
    });
  }

  /* ---------- аккаунт ---------- */
  function register(name, pass) {
    return send('auth:register', { name: name, pass: pass }, 8000);
  }
  function login(name, pass) {
    return send('auth:login', { name: name, pass: pass }, 8000);
  }
  function logout() {
    var tok = root.ST && root.ST.state.account.token;
    return send('auth:logout', { token: tok }).catch(function () {}).then(function () {
      if (root.ST) {
        root.ST.state.account = { name: null, token: null, id: null };
        root.ST.state.clan = { id: null, name: null, role: null, joined: 0 };
        root.ST.save();
      }
      me = null; clanState = null;
      emit('account', null);
      emit('clan', null);
    });
  }
  function pushSave(state) {
    if (!connected || !me) return Promise.resolve(false);
    return send('save', { state: state }).then(function () { return true; }).catch(function () { return false; });
  }
  function pullSave() {
    if (!connected || !me) return Promise.resolve(null);
    return send('load', {}, 8000).then(function (m) { return m.state || null; }).catch(function () { return null; });
  }

  /* ---------- лидерборд ---------- */
  function leaderboard(sort) {
    if (!connected) return Promise.resolve([]);
    return send('lb', { sort: sort || 'coins' }, 6000).then(function (m) { return m.rows || []; }).catch(function () { return []; });
  }

  /* ---------- кланы ---------- */
  function clanList() {
    if (!connected) return Promise.resolve([]);
    return send('clans', {}, 6000).then(function (m) { return m.rows || []; }).catch(function () { return []; });
  }
  function clanCreate(name) { return send('clan:create', { name: name }, 8000); }
  function clanJoin(code) { return send('clan:join', { code: code }, 8000); }
  function clanLeave() { return send('clan:leave', {}, 8000); }
  function clanDelete() { return send('clan:delete', {}, 8000); }
  function clanDonate(coins) { return send('clan:donate', { coins: coins }, 8000); }
  function clanBonus() {
    if (!clanState) return 0;
    var b = (clanState.bonus || 0) + (clanState.treasury >= 1e6 ? Math.min(0.25, Math.floor(clanState.treasury / 1e6) * 0.01) : 0);
    return b;
  }

  /* ---------- PvP ---------- */
  function pvpLobbies() { return sendSafe('pvp:lobbies').then(pickList); }
  function pvpCreate(type) { return send('pvp:create', { type: type || 'open' }, 8000); }
  function pvpJoin(id) { return send('pvp:join', { id: id }, 8000); }
  function pvpJoinCode(code) { return send('pvp:joinCode', { code: code }, 8000); }
  function pvpLeave() { return send('pvp:leave', {}, 8000).catch(function () {}); }
  function pvpReady(v) { return send('pvp:ready', { ready: !!v }).catch(function () {}); }
  function pvpClicks(n) { return send('pvp:clicks', { n: n }).catch(function () {}); }

  /* ---------- Рейд 3x3 ---------- */
  function raidTeams() { return sendSafe('raid:teams').then(pickList); }
  function raidCreate(open) { return send('raid:create', { open: open !== false }, 8000); }
  function raidJoin(id) { return send('raid:join', { id: id }, 8000); }
  function raidLeave() { return send('raid:leave', {}, 8000).catch(function () {}); }
  function raidSearch() { return send('raid:search', {}, 8000); }
  function raidClicks(n) { return send('raid:clicks', { n: n }).catch(function () {}); }

  function sendSafe(t) {
    if (!connected) return Promise.reject(new Error('нет соединения'));
    return send(t, {}, 6000);
  }
  function pickList(m) { return (m && m.rows) || []; }

  root.API = {
    connect: connect, on: on, send: send,
    register: register, login: login, logout: logout,
    pushSave: pushSave, pullSave: pullSave,
    leaderboard: leaderboard,
    clanList: clanList, clanCreate: clanCreate, clanJoin: clanJoin,
    clanLeave: clanLeave, clanDelete: clanDelete, clanDonate: clanDonate,
    clanBonus: clanBonus,
    pvpLobbies: pvpLobbies, pvpCreate: pvpCreate, pvpJoin: pvpJoin,
    pvpJoinCode: pvpJoinCode, pvpLeave: pvpLeave, pvpReady: pvpReady, pvpClicks: pvpClicks,
    raidTeams: raidTeams, raidCreate: raidCreate, raidJoin: raidJoin,
    raidLeave: raidLeave, raidSearch: raidSearch, raidClicks: raidClicks,
    get status() { return status; },
    get online() { return connected; },
    get account() { return me; },
    get clan() { return clanState; },
    get error() { return lastError; },
    get serverUrl() { return serverUrl(); },
    get serverInfo() { return serverInfo(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
