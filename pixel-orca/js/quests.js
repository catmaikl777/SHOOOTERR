/* ============================================================
   PIXEL ORCA — квесты и достижения
   ============================================================ */
(function (root) {
  'use strict';

  var D = root.DATA, ST = root.ST, UI = root.UI;
  var pendingToasts = [];

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayIndex() {
    var d = new Date();
    return Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
  }

  function init() {
    rollover();
    ST.on(function (type) {
      if (type === 'levelup') check();
      if (type === 'reset') rollover();
    });
  }

  function rollover() {
    var t = today();
    if (ST.state.dailyDate !== t) {
      ST.state.dailyDate = t;
      ST.state.dailyProgress = {};
      ST.state.dailyClaimed = {};
      /* выбираем 3 дневных квеста по дню */
      var d = dayIndex() % D.DAILY.length;
      var pick = [];
      for (var i = 0; i < 3; i++) pick.push(D.DAILY[(d + i) % D.DAILY.length].id);
      ST.state.dailyQuests = pick;
      ST.save();
    }
    if (!ST.state.dailyQuests || !ST.state.dailyQuests.length) {
      var dd = dayIndex() % D.DAILY.length;
      ST.state.dailyQuests = [D.DAILY[dd].id, D.DAILY[(dd + 1) % D.DAILY.length].id, D.DAILY[(dd + 2) % D.DAILY.length].id];
    }
  }

  function onStat(stat, by) {
    if (/Daily$/.test(stat)) {
      ST.state.dailyProgress[stat] = (ST.state.dailyProgress[stat] || 0) + by;
    }
  }

  function progressOf(q) {
    if (/Daily$/.test(q.stat)) return ST.state.dailyProgress[q.stat] || 0;
    return ST.statValue(q.stat) || 0;
  }

  /* ---------- основные квесты ---------- */
  function activeQuest() {
    var i = ST.state.questIndex;
    if (i >= D.QUESTS.length) return null;
    return D.QUESTS[i];
  }
  function questDone(q) { return progressOf(q) >= q.goal; }

  function claimQuest(id) {
    var i = -1;
    for (var k = 0; k < D.QUESTS.length; k++) if (D.QUESTS[k].id === id) i = k;
    if (i < 0 || i !== ST.state.questIndex) return false;
    var q = D.QUESTS[i];
    if (!questDone(q) || ST.state.questsClaimed[id]) return false;
    ST.state.questsClaimed[id] = 1;
    ST.state.questIndex = i + 1;
    giveReward(q);
    root.SND.play('levelUp');
    UI.banner('ЗАДАНИЕ ВЫПОЛНЕНО', 'banner-good', 1200);
    render();
    return true;
  }
  function claimDaily(id) {
    var q = null;
    for (var k = 0; k < D.DAILY.length; k++) if (D.DAILY[k].id === id) q = D.DAILY[k];
    if (!q) return false;
    if (ST.state.dailyClaimed[id] || progressOf(q) < q.goal) return false;
    ST.state.dailyClaimed[id] = 1;
    giveReward(q);
    root.SND.play('buy');
    UI.toast('Награда за квест получена!', 'good', 'i_star');
    render();
    return true;
  }

  function giveReward(q) {
    if (q.reward) ST.addCoins(q.reward, true);
    if (q.fish) ST.addFish(q.fish);
    if (q.shells) ST.addShells(q.shells);
    if (q.xp) ST.addXp(q.xp);
    ST.save();
  }

  /* ---------- достижения ---------- */
  function achValue(a) { return ST.statValue(a.stat) || 0; }
  function achDone(a) { return !!ST.state.achievementsClaimed[a.id]; }

  function unlockAchievement(a) {
    if (ST.state.achievementsClaimed[a.id]) return;
    ST.state.achievementsClaimed[a.id] = 1;
    if (a.reward) ST.addCoins(a.reward, true);
    if (a.shells) ST.addShells(a.shells);
    if (a.xp) ST.addXp(a.xp);
    root.SND.play('rare');
    UI.banner('ДОСТИЖЕНИЕ!', 'banner-rare', 1500);
    UI.toast(a.name + ' — ' + a.desc, 'good', 'i_crown');
    ST.save();
  }

  /* ---------- проверка ---------- */
  function check() {
    rollover();
    var q = activeQuest();
    if (q && questDone(q) && !ST.state.questsClaimed[q.id]) {
      UI.toast('Задание готово: ' + q.name + '!', 'good', 'i_book');
    }
    for (var i = 0; i < D.DAILY.length; i++) {
      var d = D.DAILY[i];
      if (ST.state.dailyQuests.indexOf(d.id) >= 0 && progressOf(d) >= d.goal && !ST.state.dailyClaimed[d.id]) {
        UI.toast('Дневной квест готов: ' + d.name, 'good', 'i_book');
        break;
      }
    }
    var n = 0;
    for (var a = 0; a < D.ACHIEVEMENTS.length; a++) {
      var ach = D.ACHIEVEMENTS[a];
      if (!achDone(ach) && achValue(ach) >= ach.goal) {
        unlockAchievement(ach);
        n++;
        if (n >= 2) break;
      }
    }
    if (UI.isOpen('quests') || UI.isOpen('achievements')) render();
  }

  /* ---------- отрисовка ---------- */
  function render() {
    renderQuests();
    renderAch();
  }

  function renderQuests() {
    var box = document.getElementById('questList');
    if (!box) return;
    var q = activeQuest();
    var html = '<div class="quest-section"><h4>Основные</h4>';
    if (!q) {
      html += '<div class="px-card done-card">Все основные задания выполнены! 🏆</div>';
    } else {
      var p = Math.min(1, progressOf(q) / q.goal);
      var ready = questDone(q) && !ST.state.questsClaimed[q.id];
      html += questRow(q, p, ready, 'claimQuest');
      /* следующие за серым */
      for (var i = ST.state.questIndex + 1; i < Math.min(D.QUESTS.length, ST.state.questIndex + 3); i++) {
        var nq = D.QUESTS[i];
        html += questRow(nq, 0, false, null, true);
      }
    }
    html += '</div><div class="quest-section"><h4>Ежедневные</h4>';
    for (var j = 0; j < ST.state.dailyQuests.length; j++) {
      var dq = dailyById(ST.state.dailyQuests[j]);
      if (!dq) continue;
      var dp = Math.min(1, progressOf(dq) / dq.goal);
      var dReady = dp >= 1 && !ST.state.dailyClaimed[dq.id];
      html += questRow(dq, dp, dReady, 'claimDaily');
    }
    var allDone = ST.state.dailyQuests.every(function (id) { return ST.state.dailyClaimed[id]; });
    html += '<div class="quest-reset">Обновление завтра · наград получено: ' +
      (allDone ? 'все' : ST.state.dailyQuests.filter(function (id) { return ST.state.dailyClaimed[id]; }).length + '/3') + '</div>';
    html += '</div>';
    box.innerHTML = html;
  }

  function dailyById(id) {
    for (var i = 0; i < D.DAILY.length; i++) if (D.DAILY[i].id === id) return D.DAILY[i];
    return null;
  }

  function questRow(q, p, ready, act, locked) {
    return '<div class="px-card quest-card' + (ready ? ' ready' : '') + (locked ? ' locked' : '') + '">' +
      '<div class="q-top"><span class="q-name">' + q.name + '</span>' +
      '<span class="q-prog">' + Math.min(progressOf(q), q.goal) + '/' + q.goal + '</span></div>' +
      '<div class="q-desc">' + q.desc + '</div>' +
      UI.bar(p, ready ? 'bar-gold' : '') +
      '<div class="q-bot"><span class="q-reward">' + rewardText(q) + '</span>' +
      (act ? '<button class="px-btn px-btn-small px-btn-primary" data-quest-act="' + act + '" data-id="' + q.id + '"' + (ready ? '' : ' disabled') + '>ЗАБРАТЬ</button>' : '<span class="q-lock">ЗАКРЫТО</span>') +
      '</div></div>';
  }

  function rewardText(q) {
    var parts = [];
    if (q.reward) parts.push(ST.fmt(q.reward) + ' косаток');
    if (q.fish) parts.push(q.fish + ' рыб');
    if (q.shells) parts.push(q.shells + ' ракушек');
    if (q.xp) parts.push(q.xp + ' опыта');
    return parts.join(' · ');
  }

  function renderAch() {
    var box = document.getElementById('achievementList');
    if (!box) return;
    var done = 0, html = '';
    for (var i = 0; i < D.ACHIEVEMENTS.length; i++) {
      var a = D.ACHIEVEMENTS[i];
      var v = achValue(a);
      var got = achDone(a);
      if (got) done++;
      var p = Math.min(1, v / a.goal);
      html += '<div class="px-card ach-card' + (got ? ' got' : '') + '">' +
        '<div class="ach-medal">' + (got ? '★' : '☆') + '</div>' +
        '<div class="ach-info"><div class="ach-name">' + a.name + '</div>' +
        '<div class="ach-desc">' + a.desc + '</div>' + UI.bar(p, got ? 'bar-gold' : '') +
        '<div class="ach-prog">' + Math.min(v, a.goal) + '/' + a.goal + (a.reward ? ' · ' + ST.fmt(a.reward) + ' 🐋' : '') + (a.shells ? ' · ' + a.shells + ' 🐚' : '') + '</div>' +
        '</div></div>';
    }
    box.innerHTML = '<div class="ach-head">Получено: <b>' + done + '/' + D.ACHIEVEMENTS.length + '</b></div>' + html;
  }

  function initClicks() {
    var qb = document.getElementById('quests');
    if (qb) qb.addEventListener('click', function (e) {
      var b = e.target.closest('[data-quest-act]');
      if (!b) return;
      if (b.dataset.questAct === 'claimQuest') claimQuest(b.dataset.id);
      else if (b.dataset.questAct === 'claimDaily') claimDaily(b.dataset.id);
    });
  }

  root.QUESTS = {
    init: init, initClicks: initClicks, check: check, onStat: onStat, render: render,
    claimQuest: claimQuest, claimDaily: claimDaily, activeQuest: activeQuest,
    achDone: achDone
  };
})(typeof window !== 'undefined' ? window : globalThis);
